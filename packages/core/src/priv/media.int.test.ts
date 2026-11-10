import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { completeSignIn, getAccountState, lockAccount } from "../acc";
import type {
  AiProvider,
  ProviderResult,
  ProviderSettings,
  StructuredInput,
  Transcript,
  TranscriptionInput,
} from "../aip";
import {
  cleanupAccountCards,
  cleanupSessionCards,
  getCard,
  tombstoneAccountCards,
  tombstoneSessionCards,
  tombstoneSourceCards,
} from "../card";
import { createDatabase, type Database } from "../db";
import {
  cleanupAccountKnowledge,
  cleanupSessionKnowledge,
  getVersion,
  tombstoneAccountKnowledge,
  tombstoneKnowledge,
} from "../lkm";
import {
  cleanupAccountMedia,
  cleanupSessionMedia,
  cleanupSourceMedia,
  closeEndedSpeechRunMedia,
  getMediaAsset,
  type MediaDependencies,
  mediaTtsJob,
  readMediaBytes,
  requestTts,
  tombstoneAccountMedia,
  tombstoneSessionMedia,
  tombstoneSourceMedia,
} from "../media";
import {
  cleanupAccountNotes,
  cleanupSessionNotes,
  getNotebookRevision,
  tombstoneAccountNotes,
  tombstoneSessionNotes,
  tombstoneSourceNotes,
} from "../note";
import { appendEncryptedDeletionJournal, readEncryptedDeletionJournals } from "../ops";
import { getSession } from "../org";
import {
  createObject,
  type JobContext,
  MemoryObjectStore,
  runDueJobs,
  sweepJobs,
  writeOwnedObject,
} from "../plt";
import {
  cancelAccountRuns,
  cleanupAccountProcessing,
  cleanupSessionProcessing,
  cleanupSourceProcessing,
  completeAuxiliaryRun,
  ENDED_JOB_RUN_ERROR,
  executeAuxiliaryProviderStep,
  failAuxiliaryRun,
  getRun,
  reconcileEndedJobRuns,
  registerProcessingTemporaryObject,
  scheduleAuxiliaryRun,
} from "../proc";
import {
  allowance,
  amounts,
  beginProviderStep,
  configureCostPolicy,
  grantEntitlement,
} from "../quota";
import {
  cleanupAccountSrs,
  cleanupSessionSrs,
  tombstoneAccountSrs,
  tombstoneSessionSrs,
} from "../srs";
import {
  coordinateSourceDeletion,
  findPrivacyDeletionRequest,
  getPrivacyDeletionRequest,
  type PrivacyDependencies,
  persistDeletionJournal,
  privacyCleanupJob,
  requestAccountDeletion,
  requestSessionDeletion,
} from "./deletion";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
afterAll(() => db.destroy());
const providerSettings: ProviderSettings = {
  version: "synthetic-media",
  llmModel: "synthetic/llm",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 10000,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maximumMicros: 10,
  currency: "USD",
  priceVersion: "synthetic",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
/** ID3 test bytes exercise transport/accounting. No live provider or real learner audio is used. */
class SyntheticSpeech implements AiProvider {
  readonly name = "synthetic-media";
  readonly mode = "mock";
  readonly settings = providerSettings;
  calls = 0;
  speechInputs: Array<{ voice?: string; model?: string }> = [];
  beforeResult?: () => Promise<void>;
  invalidAudio = false;
  async speech(input: {
    voice?: string;
    model?: string;
  }): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    this.calls++;
    this.speechInputs.push(input);
    await this.beforeResult?.();
    return {
      output: {
        bytes: Buffer.from(this.invalidAudio ? "untrusted html body" : "ID3 synthetic test bytes"),
        mimeType: "audio/mpeg",
      },
      requestId: "synthetic-speech",
      model: this.settings.ttsModel,
      provider: this.name,
      usage: { characters: 17 },
      actualMicros: 2,
    };
  }
  async structured<T>(_input: StructuredInput<T>): Promise<ProviderResult<T>> {
    throw new Error("Unused fixture endpoint");
  }
  async transcribe(_input: TranscriptionInput): Promise<ProviderResult<Transcript>> {
    throw new Error("Unused fixture endpoint");
  }
}
function mediaDependencies(
  store: MemoryObjectStore,
  provider = new SyntheticSpeech(),
): MediaDependencies {
  return {
    provider,
    store,
    settings: { maxTtsCharacters: 500, maxTtsBytes: 5000 },
    processor: {
      schedule: scheduleAuxiliaryRun,
      execute: executeAuxiliaryProviderStep,
      complete: completeAuxiliaryRun,
      fail: failAuxiliaryRun,
    },
  };
}
function privacyDependencies(store: MemoryObjectStore, authentication = true): PrivacyDependencies {
  return {
    authentication: authentication
      ? { async revokeSessions() {}, async deleteIdentity() {} }
      : undefined,
    hooks: [
      {
        module: "proc",
        async tombstoneSession() {},
        tombstoneAccount: cancelAccountRuns,
        cleanupSession: (database, ctx, id, now) =>
          cleanupSessionProcessing(database, ctx, id, { store, now }),
        cleanupAccount: (database, ctx, now) =>
          cleanupAccountProcessing(database, ctx, { store, now }),
        cleanupSource: (database, ctx, sourceId, _sessions, now) =>
          cleanupSourceProcessing(database, ctx, sourceId, { store, now }),
      },
      {
        module: "srs",
        tombstoneSession: tombstoneSessionSrs,
        tombstoneAccount: tombstoneAccountSrs,
        cleanupSession: cleanupSessionSrs,
        cleanupAccount: cleanupAccountSrs,
      },
      {
        module: "card",
        tombstoneSession: tombstoneSessionCards,
        tombstoneAccount: tombstoneAccountCards,
        tombstoneSource: (tx, ctx, id, sessions, now) =>
          tombstoneSourceCards(tx, ctx, id, [...sessions], now),
        cleanupSession: cleanupSessionCards,
        cleanupAccount: cleanupAccountCards,
        cleanupSource: async (database, ctx) => cleanupAccountCards(database, ctx),
      },
      {
        module: "note",
        tombstoneSession: tombstoneSessionNotes,
        tombstoneAccount: tombstoneAccountNotes,
        tombstoneSource: (tx, ctx, id, sessions) =>
          tombstoneSourceNotes(tx, ctx, id, [...sessions]),
        cleanupSession: cleanupSessionNotes,
        cleanupAccount: cleanupAccountNotes,
        cleanupSource: async (database, ctx, _id, sessions) => {
          for (const id of sessions) await cleanupSessionNotes(database, ctx, id);
        },
      },
      {
        module: "lkm",
        tombstoneSession: tombstoneKnowledge,
        tombstoneAccount: tombstoneAccountKnowledge,
        cleanupSession: cleanupSessionKnowledge,
        cleanupAccount: cleanupAccountKnowledge,
        cleanupSource: async (database, ctx, _id, sessions) => {
          for (const id of sessions) await cleanupSessionKnowledge(database, ctx, id);
        },
      },
      {
        module: "media",
        tombstoneSession: tombstoneSessionMedia,
        tombstoneAccount: tombstoneAccountMedia,
        tombstoneSource: (tx, ctx, id, sessions, now) =>
          tombstoneSourceMedia(tx, ctx, id, now, sessions),
        cleanupSession: (database, ctx, id, now) =>
          cleanupSessionMedia(database, store, ctx, id, now),
        cleanupAccount: (database, ctx, now) => cleanupAccountMedia(database, store, ctx, now),
        cleanupSource: (database, ctx, id, sessions, now) =>
          cleanupSourceMedia(database, store, ctx, id, now, sessions),
      },
    ],
  };
}
async function fixture() {
  const study = await studyFixture(db);
  const store = new MemoryObjectStore();
  const provider = new SyntheticSpeech();
  const dependencies = mediaDependencies(store, provider);
  await grantEntitlement(db, {
    userId: study.ctx.userId,
    startsAt: new Date(study.now.getTime() - 1000),
    endsAt: new Date(study.now.getTime() + 3600000),
    amounts: amounts({ tts: 10000, storage: 100000 }),
    operationKey: randomUUID(),
    actorId: "synthetic-test",
    reason: "Synthetic media integration fixture",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-media",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-test", reason: "Synthetic media integration fixture" },
  );
  return { ...study, store, provider, dependencies };
}
async function run(
  database: Database,
  definition: ReturnType<typeof mediaTtsJob> | ReturnType<typeof privacyCleanupJob>,
) {
  return runDueJobs(database, [definition], {
    deadline: new Date(Date.now() + 5000),
    kinds: [definition.kind],
  });
}
/** Each retry regression owns its queue kind so old fixture jobs cannot consume its deadline. */
async function isolatedPrivacyJob(
  database: Database,
  requestId: string,
  definition: ReturnType<typeof privacyCleanupJob>,
) {
  const receipt = await database
    .selectFrom("priv.deletion_request")
    .select("job_id")
    .where("id", "=", requestId)
    .executeTakeFirstOrThrow();
  if (!receipt.job_id) throw new Error("Expected queued privacy job");
  const kind = `priv.synthetic_${randomUUID().replaceAll("-", "")}`;
  await database.updateTable("plt.job").set({ kind }).where("id", "=", receipt.job_id).execute();
  return { ...definition, kind };
}
/** The speech checkpoint shape mediaTtsJob reads back; synthetic ID3 bytes only. */
const speechCheckpoint = z.strictObject({
  bytesBase64: z.string().min(1),
  mimeType: z.literal("audio/mpeg"),
});
const SYNTHETIC_SPEECH_BYTES = "ID3 synthetic test bytes";
/** The auxiliary run, its reservation and its queued job behind a requested speech asset. */
async function speechRun(assetId: string) {
  const asset = await db
    .selectFrom("media.asset")
    .select("run_id")
    .where("id", "=", assetId)
    .executeTakeFirstOrThrow();
  if (!asset.run_id) throw new Error("Expected speech run");
  const row = await db
    .selectFrom("proc.processing_run")
    .select(["id", "reservation_id", "job_id"])
    .where("id", "=", asset.run_id)
    .executeTakeFirstOrThrow();
  if (!row.job_id) throw new Error("Expected speech job");
  return { runId: row.id, reservationId: row.reservation_id, jobId: row.job_id };
}
async function providerCosts(userId: string) {
  return db
    .selectFrom("quota.provider_cost")
    .select(["amount_micros", "run_id"])
    .where("user_id", "=", userId)
    .execute();
}
async function speechAttempts(runId: string) {
  return db
    .selectFrom("proc.provider_attempt")
    .select(["state", "hold_id"])
    .where("run_id", "=", runId)
    .where("step", "=", "speech")
    .execute();
}
async function runState(runId: string) {
  return db
    .selectFrom("proc.processing_run")
    .select(["state", "last_error"])
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
}
describe("explicit media and privacy publication", () => {
  it("persists the owned deletion receipt before acknowledgement and permits safe retry after an external append failure", async () => {
    const f = await fixture();
    const entries = new Map<string, unknown>();
    let calls = 0;
    const dependencies: PrivacyDependencies = {
      hooks: [
        {
          module: "synthetic_journal_ack",
          async tombstoneSession() {},
          async cleanupSession() {},
          async cleanupAccount() {},
        },
      ],
      deletionJournal: {
        async record(entry) {
          calls++;
          if (calls === 1) throw new Error("Synthetic durable journal unavailable");
          entries.set(entry.requestId, entry);
        },
      },
    };
    const operationKey = randomUUID();
    const request = await requestSessionDeletion(
      db,
      f.ctx,
      f.session.id,
      operationKey,
      dependencies,
    );
    await expect(persistDeletionJournal(db, f.ctx, request.id, dependencies)).rejects.toThrow(
      "Synthetic durable journal unavailable",
    );
    await expect(getSession(db, f.ctx, f.session.id)).rejects.toMatchObject({ code: "not_found" });
    expect(
      (await requestSessionDeletion(db, f.ctx, f.session.id, operationKey, dependencies)).id,
    ).toBe(request.id);
    expect((await findPrivacyDeletionRequest(db, f.ctx, "session", f.session.id))?.id).toBe(
      request.id,
    );
    expect(
      await findPrivacyDeletionRequest(
        db,
        { ...f.ctx, userId: randomUUID() },
        "session",
        f.session.id,
      ),
    ).toBeNull();
    await expect(
      persistDeletionJournal(db, { ...f.ctx, userId: randomUUID() }, request.id, dependencies),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(calls).toBe(1);
    await expect(
      persistDeletionJournal(db, f.ctx, request.id, { hooks: dependencies.hooks }),
    ).rejects.toMatchObject({ code: "internal", reason: "deletion_journal_adapter_missing" });
    await persistDeletionJournal(db, f.ctx, request.id, dependencies);
    await persistDeletionJournal(db, f.ctx, request.id, dependencies);
    expect(entries.size).toBe(1);
    expect(entries.get(request.id)).toEqual({
      requestId: request.id,
      userId: f.ctx.userId,
      kind: "session",
      subjectId: f.session.id,
      relatedSessions: [],
      requestedAt: request.requestedAt,
    });
    expect((await getPrivacyDeletionRequest(db, f.ctx, request.id)).state).toBe("pending");
  });
  it("runs the encrypted journal adapter with a single connection and retains its checkpoint on cleanup retry", async () => {
    const f = await fixture();
    const singleConnection = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
    const store = new MemoryObjectStore();
    const encryption = { keyId: "synthetic-single-connection", key: randomBytes(32) };
    let journalCalls = 0;
    let cleanupCalls = 0;
    const dependencies: PrivacyDependencies = {
      deletionJournal: {
        async record(entry) {
          journalCalls++;
          await appendEncryptedDeletionJournal(singleConnection, store, encryption, entry);
        },
      },
      hooks: [
        {
          module: "synthetic_single_journal",
          async tombstoneSession() {},
          async cleanupSession() {
            cleanupCalls++;
            if (cleanupCalls === 1) throw new Error("Synthetic module cleanup retry");
          },
          async cleanupAccount() {},
        },
      ],
    };
    try {
      const request = await requestSessionDeletion(
        singleConnection,
        f.ctx,
        f.session.id,
        randomUUID(),
        dependencies,
      );
      const definition = await isolatedPrivacyJob(
        singleConnection,
        request.id,
        privacyCleanupJob(dependencies),
      );
      await run(singleConnection, definition);
      expect((await getPrivacyDeletionRequest(singleConnection, f.ctx, request.id)).state).toBe(
        "needs_operator",
      );
      expect(journalCalls).toBe(1);
      expect(cleanupCalls).toBe(1);
      const journal = await readEncryptedDeletionJournals(
        store,
        new Map([[encryption.keyId, encryption.key]]),
      );
      expect(journal).toEqual([
        {
          requestId: request.id,
          userId: f.ctx.userId,
          kind: "session",
          subjectId: f.session.id,
          relatedSessions: [],
          requestedAt: request.requestedAt,
        },
      ]);
      const retryAt = new Date(Date.now() + 180000);
      await runDueJobs(singleConnection, [definition], {
        kinds: [definition.kind],
        now: () => retryAt,
        deadline: new Date(retryAt.getTime() + 1000),
      });
      expect((await getPrivacyDeletionRequest(singleConnection, f.ctx, request.id)).state).toBe(
        "completed",
      );
      expect(journalCalls).toBe(1);
      expect(cleanupCalls).toBe(2);
    } finally {
      await singleConnection.destroy();
    }
  });
  it("journals deletion before physical cleanup, retries failed appends and reuses the durable journal checkpoint", async () => {
    const f = await fixture();
    let journalCalls = 0;
    let cleanupCalls = 0;
    const journalEntries: unknown[] = [];
    const dependencies: PrivacyDependencies = {
      deletionJournal: {
        async record(entry) {
          journalCalls++;
          journalEntries.push(entry);
          if (journalCalls === 1) throw new Error("Synthetic journal unavailable");
        },
      },
      hooks: [
        {
          module: "synthetic_journal",
          async tombstoneSession() {},
          async cleanupSession() {
            cleanupCalls++;
            if (cleanupCalls === 1) throw new Error("Synthetic module retry");
          },
          async cleanupAccount() {},
        },
      ],
    };
    const request = await requestSessionDeletion(
      db,
      f.ctx,
      f.session.id,
      randomUUID(),
      dependencies,
    );
    const definition = await isolatedPrivacyJob(db, request.id, privacyCleanupJob(dependencies));
    await run(db, definition);
    expect((await getPrivacyDeletionRequest(db, f.ctx, request.id)).state).toBe("needs_operator");
    expect(cleanupCalls).toBe(0);
    const retryAt = new Date(Date.now() + 180000);
    await runDueJobs(db, [definition], {
      kinds: [definition.kind],
      now: () => retryAt,
      deadline: new Date(retryAt.getTime() + 1000),
    });
    expect((await getPrivacyDeletionRequest(db, f.ctx, request.id)).state).toBe("needs_operator");
    expect(journalCalls).toBe(2);
    expect(cleanupCalls).toBe(1);
    const finalAt = new Date(retryAt.getTime() + 180000);
    await runDueJobs(db, [definition], {
      kinds: [definition.kind],
      now: () => finalAt,
      deadline: new Date(finalAt.getTime() + 1000),
    });
    expect((await getPrivacyDeletionRequest(db, f.ctx, request.id)).state).toBe("completed");
    expect(journalCalls).toBe(2);
    expect(cleanupCalls).toBe(2);
    expect(journalEntries[1]).toEqual({
      requestId: request.id,
      userId: f.ctx.userId,
      kind: "session",
      subjectId: f.session.id,
      relatedSessions: [],
      requestedAt: request.requestedAt,
    });
    expect(JSON.stringify(journalEntries)).not.toContain("Synthetic study fixture");
  });
  it("purges captured source runs and TTS while preserving replacement queued runs, temporary objects and later media", async () => {
    const f = await fixture();
    const sourceId = randomUUID();
    const privacy = privacyDependencies(f.store);
    const old = await requestTts(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        text: "A short sentence.",
        operationKey: randomUUID(),
        exportAllowed: false,
      },
      f.dependencies,
    );
    await run(db, mediaTtsJob(f.dependencies));
    const oldReady = await getMediaAsset(db, f.ctx, old.id);
    const receipt = await db.transaction().execute(async (tx) => {
      await lockAccount(tx, f.ctx.userId);
      return coordinateSourceDeletion(tx, f.ctx, sourceId, [f.session.id], privacy);
    });
    await expect(getMediaAsset(db, f.ctx, old.id)).rejects.toMatchObject({ code: "not_found" });
    const replacement = await requestTts(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        text: "A new short sentence.",
        operationKey: randomUUID(),
        exportAllowed: false,
      },
      f.dependencies,
    );
    const replacementRow = await db
      .selectFrom("media.asset")
      .select("run_id")
      .where("id", "=", replacement.id)
      .executeTakeFirstOrThrow();
    if (!replacementRow.run_id) throw new Error("Expected replacement run");
    const replacementRunId = replacementRow.run_id;
    const oldObjectId = oldReady.objectId;
    if (!oldObjectId) throw new Error("Expected old speech object");
    const temporaryId = await writeOwnedObject(db, f.store, f.ctx, {
      module: "proc",
      retention: "temporary",
      contentType: "audio/mpeg",
      bytes: Buffer.from("ID3 replacement chunk"),
      now: new Date(),
      onRegistered: (id) => registerProcessingTemporaryObject(db, f.ctx, replacementRunId, id),
    });
    await run(db, privacyCleanupJob(privacy));
    expect((await getPrivacyDeletionRequest(db, f.ctx, receipt.id)).state).toBe("completed");
    expect((await getRun(db, f.ctx, replacementRow.run_id)).state).toBe("queued");
    expect((await getMediaAsset(db, f.ctx, replacement.id)).state).toBe("queued");
    const object = await db
      .selectFrom("plt.storage_object")
      .select("state")
      .where("id", "=", temporaryId)
      .executeTakeFirstOrThrow();
    expect(object.state).toBe("verified");
    expect(
      (
        await db
          .selectFrom("plt.storage_object")
          .select("state")
          .where("id", "=", oldObjectId)
          .executeTakeFirstOrThrow()
      ).state,
    ).toBe("deleted");
    const replacementInput = await db
      .selectFrom("proc.processing_run")
      .select("input_snapshot")
      .where("id", "=", replacementRow.run_id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(replacementInput.input_snapshot)).toContain("A new short sentence.");
    await run(db, mediaTtsJob(f.dependencies));
    expect((await getMediaAsset(db, f.ctx, replacement.id)).state).toBe("ready");
    await cleanupSourceProcessing(db, f.ctx, sourceId, { store: f.store });
    expect((await getMediaAsset(db, f.ctx, replacement.id)).state).toBe("ready");
  });
  it("reuses cached speech, bills once, and requires explicit export permission", async () => {
    const f = await fixture();
    const input = {
      sessionId: f.session.id,
      text: "A short sentence.",
      operationKey: randomUUID(),
      exportAllowed: false,
    };
    const first = await requestTts(db, f.ctx, input, f.dependencies);
    const replay = await requestTts(db, f.ctx, input, f.dependencies);
    expect(replay.id).toBe(first.id);
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(17);
    await run(db, mediaTtsJob(f.dependencies));
    const ready = await getMediaAsset(db, f.ctx, first.id);
    expect(ready.state).toBe("ready");
    expect(ready.synthetic).toBe(true);
    expect(
      (await requestTts(db, f.ctx, { ...input, operationKey: randomUUID() }, f.dependencies)).id,
    ).toBe(first.id);
    expect(f.provider.calls).toBe(1);
    expect((await allowance(db, f.ctx)).consumed.tts).toBe(17);
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(0);
    expect((await readMediaBytes(db, f.store, f.ctx, first.id)).bytes.length).toBeGreaterThan(0);
    await expect(readMediaBytes(db, f.store, f.ctx, first.id, true)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      getMediaAsset(db, { ...f.ctx, userId: randomUUID() }, first.id),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("AC-D46-02/04 snapshots British pronunciation, executes once and separates voices in cache", async () => {
    const f = await fixture();
    const input = {
      sessionId: f.session.id,
      text: "A short sentence.",
      operationKey: randomUUID(),
      exportAllowed: false,
      purpose: "pronunciation" as const,
    };
    await expect(requestTts(db, f.ctx, input, f.dependencies)).rejects.toMatchObject({
      code: "validation_failed",
    });
    f.dependencies.settings.pronunciationVoice = "bf_emma";
    const first = await requestTts(db, f.ctx, input, f.dependencies);
    const row = await db
      .selectFrom("media.asset")
      .selectAll()
      .where("id", "=", first.id)
      .executeTakeFirstOrThrow();
    const snapshot = await db
      .selectFrom("proc.processing_run")
      .select("settings")
      .where("id", "=", row.run_id as string)
      .executeTakeFirstOrThrow();
    expect(snapshot.settings).toMatchObject({ voice: "bf_emma" });
    await run(db, mediaTtsJob(f.dependencies));
    expect((await getMediaAsset(db, f.ctx, first.id)).state).toBe("ready");
    expect(
      (await requestTts(db, f.ctx, { ...input, operationKey: randomUUID() }, f.dependencies)).id,
    ).toBe(first.id);
    expect(f.provider.calls).toBe(1);
    expect(f.provider.speechInputs).toEqual([expect.objectContaining({ voice: "bf_emma" })]);
    expect(f.provider.settings.voice).toBe("synthetic");
    const ordinary = await requestTts(
      db,
      f.ctx,
      { ...input, purpose: undefined, operationKey: randomUUID() },
      f.dependencies,
    );
    expect(ordinary.id).not.toBe(first.id);
    await run(db, mediaTtsJob(f.dependencies));
    expect(f.provider.speechInputs[1]?.voice).toBe("synthetic");
    f.dependencies.settings.pronunciationVoice = "bf_isabella";
    const changedVoice = await requestTts(
      db,
      f.ctx,
      { ...input, operationKey: randomUUID() },
      f.dependencies,
    );
    expect(changedVoice.id).not.toBe(first.id);
    await run(db, mediaTtsJob(f.dependencies));
    expect(f.provider.speechInputs[2]?.voice).toBe("bf_isabella");
  });
  it("rejects a false audio response while preserving actual cost and refunding unpublished quota", async () => {
    const f = await fixture();
    f.provider.invalidAudio = true;
    const asset = await requestTts(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        text: "A short sentence.",
        operationKey: randomUUID(),
        exportAllowed: false,
      },
      f.dependencies,
    );
    await run(db, mediaTtsJob(f.dependencies));
    expect((await getMediaAsset(db, f.ctx, asset.id)).state).toBe("failed");
    expect((await allowance(db, f.ctx)).consumed.tts).toBe(0);
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(0);
    const cost = await db
      .selectFrom("quota.provider_cost")
      .select("amount_micros")
      .where("user_id", "=", f.ctx.userId)
      .executeTakeFirstOrThrow();
    expect(Number(cost.amount_micros)).toBe(2);
  });
  it("atomically hides a class, cancels speech, and physically purges owned study content", async () => {
    const f = await fixture();
    const privacy = privacyDependencies(f.store);
    const asset = await requestTts(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        text: "A short sentence.",
        operationKey: randomUUID(),
        exportAllowed: false,
      },
      f.dependencies,
    );
    const receipt = await requestSessionDeletion(db, f.ctx, f.session.id, randomUUID(), privacy);
    await expect(getSession(db, f.ctx, f.session.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(getMediaAsset(db, f.ctx, asset.id)).rejects.toMatchObject({ code: "not_found" });
    await run(db, mediaTtsJob(f.dependencies));
    expect(f.provider.calls).toBe(0);
    await run(db, privacyCleanupJob(privacy));
    expect((await getPrivacyDeletionRequest(db, f.ctx, receipt.id)).state).toBe("completed");
    await expect(getVersion(db, f.ctx, f.knowledge.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getNotebookRevision(db, f.ctx, f.notebook.current.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const card = f.cards[0];
    if (!card) throw new Error("Expected fixture card");
    await expect(getCard(db, f.ctx, card.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(0);
  });
  it("records a late provider cost after account tombstone without resurrecting the output", async () => {
    const f = await fixture();
    const privacy = privacyDependencies(f.store);
    let receiptId = "";
    f.provider.beforeResult = async () => {
      receiptId = (await requestAccountDeletion(db, f.ctx, randomUUID(), privacy)).id;
    };
    const asset = await requestTts(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        text: "A short sentence.",
        operationKey: randomUUID(),
        exportAllowed: false,
      },
      f.dependencies,
    );
    await run(db, mediaTtsJob(f.dependencies));
    expect(f.provider.calls).toBe(1);
    expect(await getAccountState(db, f.ctx.userId)).toBeNull();
    await expect(getMediaAsset(db, f.ctx, asset.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await allowance(db, f.ctx)).consumed.tts).toBe(0);
    const cost = await db
      .selectFrom("quota.provider_cost")
      .select("amount_micros")
      .where("user_id", "=", f.ctx.userId)
      .executeTakeFirstOrThrow();
    expect(Number(cost.amount_micros)).toBe(2);
    await run(db, privacyCleanupJob(privacy));
    expect((await getPrivacyDeletionRequest(db, f.ctx, receiptId)).state).toBe("completed");
    expect(
      await completeSignIn(db, { userId: f.ctx.userId, intentId: null, now: new Date() }),
    ).toEqual({ kind: "no_account" });
  });
  it("keeps a durable operator receipt when the auth deletion adapter is missing", async () => {
    const f = await fixture();
    const privacy = privacyDependencies(f.store, false);
    const receipt = await requestAccountDeletion(db, f.ctx, randomUUID(), privacy);
    await run(db, privacyCleanupJob(privacy));
    expect((await getPrivacyDeletionRequest(db, f.ctx, receipt.id)).state).toBe("needs_operator");
    await expect(
      getPrivacyDeletionRequest(db, { ...f.ctx, userId: randomUUID() }, receipt.id),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  // C8-5 (P8-02, F-5): an earlier job committed the paid speech step, then stopped before publishing.
  it("C8-5 replays a speech job after its committed speech checkpoint without a second provider call or cost", async () => {
    const f = await fixture();
    const asset = await requestTts(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        text: "A short sentence.",
        operationKey: randomUUID(),
        exportAllowed: false,
      },
      f.dependencies,
    );
    const { runId } = await speechRun(asset.id);
    // The earlier job's step goes through the production provider step, so its attempt, cost and
    // checkpoint are committed together; the fixture provider itself is never called.
    const interruptedJob: JobContext = {
      db,
      now: () => new Date(),
      job: { id: randomUUID(), attempt: 1 },
      async step() {
        throw new Error("Unused fixture job step");
      },
    };
    await executeAuxiliaryProviderStep(interruptedJob, f.ctx, runId, {
      step: "speech",
      model: providerSettings.ttsModel,
      provider: f.provider,
      schema: speechCheckpoint,
      effect: async () => ({
        output: {
          bytesBase64: Buffer.from(SYNTHETIC_SPEECH_BYTES).toString("base64"),
          mimeType: "audio/mpeg" as const,
        },
        requestId: "synthetic-speech",
        model: providerSettings.ttsModel,
        provider: f.provider.name,
        usage: { characters: 17 },
        actualMicros: 2,
      }),
    });
    // The stopped job had already moved its asset to processing.
    await db
      .updateTable("media.asset")
      .set({ state: "processing" })
      .where("id", "=", asset.id)
      .execute();
    expect(await providerCosts(f.ctx.userId)).toHaveLength(1);

    await run(db, mediaTtsJob(f.dependencies));
    expect(f.provider.calls).toBe(0);
    const costs = await providerCosts(f.ctx.userId);
    expect(costs).toHaveLength(1);
    expect(Number(costs[0]?.amount_micros)).toBe(2);
    expect(costs[0]?.run_id).toBe(runId);
    expect((await speechAttempts(runId)).map((attempt) => attempt.state)).toEqual(["succeeded"]);
    const ready = await getMediaAsset(db, f.ctx, asset.id);
    expect(ready.state).toBe("ready");
    expect(Buffer.from((await readMediaBytes(db, f.store, f.ctx, asset.id)).bytes).toString()).toBe(
      SYNTHETIC_SPEECH_BYTES,
    );
    expect((await runState(runId)).state).toBe("ready");
    expect((await allowance(db, f.ctx)).consumed.tts).toBe(17);
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(0);
  });
  // C8-5 (P8-02, F-5) and C8-3 (P8-02, F-3; P9-05, C9-1): the job stopped during dispatch, leaving
  // its attempt started and its maximum cost hold open. The next job closes that hold at its
  // maximum (the conservative cost) without calling the provider again; the attempt stays started
  // so the retry guards still see an unknown outcome (E215-R).
  it("C8-3 closes the open cost hold of a speech attempt left started at its maximum, keeps the attempt started and ends needs_input without a provider call", async () => {
    const f = await fixture();
    const asset = await requestTts(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        text: "A short sentence.",
        operationKey: randomUUID(),
        exportAllowed: false,
      },
      f.dependencies,
    );
    const { runId, reservationId } = await speechRun(asset.id);
    const holdId = await db.transaction().execute(async (tx) => {
      // The same operation key and hold the provider step commits before its dispatch.
      const operationKey = `${runId}:speech:1`;
      const hold = await beginProviderStep(tx, f.ctx, {
        sessionId: f.session.id,
        reservationId,
        operationKey,
        maximumMicros: providerSettings.maximumMicros,
        currency: providerSettings.currency,
      });
      await tx
        .insertInto("proc.provider_attempt")
        .values({
          run_id: runId,
          user_id: f.ctx.userId,
          step: "speech",
          attempt: 1,
          operation_key: operationKey,
          hold_id: hold.id,
          provider: f.provider.name,
          model: providerSettings.ttsModel,
          state: "started",
        })
        .execute();
      await tx
        .updateTable("proc.processing_run")
        .set({ state: "processing" })
        .where("id", "=", runId)
        .execute();
      await tx
        .updateTable("media.asset")
        .set({ state: "processing" })
        .where("id", "=", asset.id)
        .execute();
      return hold.id;
    });

    await run(db, mediaTtsJob(f.dependencies));
    expect(f.provider.calls).toBe(0);
    const ended = await getMediaAsset(db, f.ctx, asset.id);
    expect(ended.state).toBe("needs_input");
    expect(ended.lastError).toBe("provider_outcome_unresolved");
    expect(await runState(runId)).toEqual({
      state: "needs_input",
      last_error: "provider_outcome_unresolved",
    });
    // The unknown outcome is recorded once, at the hold's maximum, with no actual amount.
    expect(
      await db
        .selectFrom("quota.provider_cost")
        .select(["operation_key", "amount_micros", "estimated_micros", "run_id"])
        .where("user_id", "=", f.ctx.userId)
        .execute(),
    ).toEqual([
      {
        operation_key: `${runId}:speech:1`,
        amount_micros: null,
        estimated_micros: String(providerSettings.maximumMicros),
        run_id: runId,
      },
    ]);
    // The attempt is not failed: it stays started, an unknown outcome for operator review.
    expect(await speechAttempts(runId)).toEqual([{ state: "started", hold_id: holdId }]);
    expect((await allowance(db, f.ctx)).consumed.tts).toBe(0);
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(0);
    // C8-3 (P9-05): the maximum cost hold of the started attempt is closed.
    const hold = await db
      .selectFrom("quota.cost_hold")
      .select("closed_at")
      .where("id", "=", holdId)
      .executeTakeFirstOrThrow();
    expect(hold.closed_at).not.toBeNull();
  });
  // C8-5 (P8-02, F-5) and C8-4 (P8-02, F-4; P9-06): the function was stopped on the job's last
  // attempt, the sweep failed the job (lease_expired) and reconciliation closed its run. The media
  // hook injected into reconciliation ends the run's speech asset in the same transaction, with the
  // mapping of mediaTtsJob's final-failure path, so an identical request no longer reuses it.
  async function strandedSpeechAsset(inFlight: boolean) {
    const f = await fixture();
    const input = {
      sessionId: f.session.id,
      text: "A short sentence.",
      operationKey: randomUUID(),
      exportAllowed: false,
    };
    const asset = await requestTts(db, f.ctx, input, f.dependencies);
    const { runId, jobId } = await speechRun(asset.id);
    const job = await db
      .selectFrom("plt.job")
      .select(["kind", "max_attempts"])
      .where("id", "=", jobId)
      .executeTakeFirstOrThrow();
    expect(job.kind).toBe("media.tts");
    const past = new Date(Date.now() - 600_000);
    await db
      .updateTable("plt.job")
      .set({
        state: "running",
        attempt: job.max_attempts,
        lease_token: randomUUID(),
        lease_until: past,
        updated_at: past,
      })
      .where("id", "=", jobId)
      .execute();
    // The stopped job had already moved its run and asset to processing.
    await db
      .updateTable("proc.processing_run")
      .set({ state: "processing" })
      .where("id", "=", runId)
      .execute();
    await db
      .updateTable("media.asset")
      .set({ state: "processing" })
      .where("id", "=", asset.id)
      .execute();
    // A speech request still marked in flight: its outcome is unknown (synthetic hold id).
    if (inFlight)
      await db
        .insertInto("proc.provider_attempt")
        .values({
          run_id: runId,
          user_id: f.ctx.userId,
          step: "speech",
          attempt: 1,
          operation_key: `${runId}:speech:1`,
          hold_id: randomUUID(),
          provider: f.provider.name,
          model: providerSettings.ttsModel,
          state: "started",
        })
        .execute();

    await sweepJobs(db, new Date());
    expect(
      await db
        .selectFrom("plt.job")
        .select(["state", "last_error"])
        .where("id", "=", jobId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ state: "failed", last_error: "lease_expired" });
    return { f, input, asset, runId };
  }
  async function expectSpeechRunClosed(inFlight: boolean) {
    const { f, input, asset, runId } = await strandedSpeechAsset(inFlight);
    const expected = inFlight
      ? { state: "needs_input", lastError: "provider_outcome_unresolved" }
      : { state: "failed", lastError: ENDED_JOB_RUN_ERROR };
    expect(
      await reconcileEndedJobRuns(db, new Date(), {
        userId: f.ctx.userId,
        afterAuxiliaryClose: closeEndedSpeechRunMedia,
      }),
    ).toBe(1);
    expect(await runState(runId)).toEqual({
      state: expected.state,
      last_error: expected.lastError,
    });
    expect((await allowance(db, f.ctx)).consumed.tts).toBe(0);
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(0);
    expect(await providerCosts(f.ctx.userId)).toEqual([]);
    expect(f.provider.calls).toBe(0);
    // The asset is no longer processing: it carries the run's outcome and code.
    const closed = await getMediaAsset(db, f.ctx, asset.id);
    expect({ state: closed.state, lastError: closed.lastError }).toEqual(expected);
    // An identical request no longer returns the stranded asset; it starts a new one.
    const again = await requestTts(
      db,
      f.ctx,
      { ...input, operationKey: randomUUID() },
      f.dependencies,
    );
    expect(again.id).not.toBe(asset.id);
    expect(again.state).toBe("queued");
    // Running reconciliation again changes nothing further.
    expect(
      await reconcileEndedJobRuns(db, new Date(), {
        userId: f.ctx.userId,
        afterAuxiliaryClose: closeEndedSpeechRunMedia,
      }),
    ).toBe(0);
    expect((await getMediaAsset(db, f.ctx, asset.id)).state).toBe(expected.state);
    // The new request's job runs on its own queue kind with this fixture's provider, so no due
    // media.tts job is left for a later test's mediaTtsJob run (C8-2 counts its provider calls).
    const { jobId: againJobId } = await speechRun(again.id);
    const kind = `media.synthetic_${randomUUID().replaceAll("-", "")}`;
    await db.updateTable("plt.job").set({ kind }).where("id", "=", againJobId).execute();
    await runDueJobs(db, [{ ...mediaTtsJob(f.dependencies), kind }], {
      deadline: new Date(Date.now() + 5000),
      kinds: [kind],
    });
    expect((await getMediaAsset(db, f.ctx, again.id)).state).toBe("ready");
    expect((await getMediaAsset(db, f.ctx, asset.id)).state).toBe(expected.state);
  }
  it("C8-4 reconciling a speech run whose last job lease expired fails the run and its asset with processing_interrupted", async () => {
    await expectSpeechRunClosed(false);
  });
  it("C8-4 reconciling a speech run whose last job lease expired with a request in flight leaves the run and its asset needs_input with provider_outcome_unresolved", async () => {
    await expectSpeechRunClosed(true);
  });
  it("C8-4 keeps the speech run open when the media hook fails, and the next reconciliation closes both", async () => {
    const { f, asset, runId } = await strandedSpeechAsset(false);
    await expect(
      reconcileEndedJobRuns(db, new Date(), {
        userId: f.ctx.userId,
        afterAuxiliaryClose: async () => {
          throw new Error("Synthetic hook failure");
        },
      }),
    ).rejects.toThrow("Synthetic hook failure");
    // The hook shares the run's transaction: neither the run nor its reservation was closed.
    expect((await runState(runId)).state).toBe("processing");
    expect((await allowance(db, f.ctx)).reserved.tts).toBeGreaterThan(0);
    expect((await getMediaAsset(db, f.ctx, asset.id)).state).toBe("processing");
    expect(
      await reconcileEndedJobRuns(db, new Date(), {
        userId: f.ctx.userId,
        afterAuxiliaryClose: closeEndedSpeechRunMedia,
      }),
    ).toBe(1);
    expect(await runState(runId)).toEqual({ state: "failed", last_error: ENDED_JOB_RUN_ERROR });
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(0);
    const closed = await getMediaAsset(db, f.ctx, asset.id);
    expect({ state: closed.state, lastError: closed.lastError }).toEqual({
      state: "failed",
      lastError: ENDED_JOB_RUN_ERROR,
    });
  });
  // C8-2 (P8-02, F-2): an earlier job committed the asset's object pointer from onRegistered and
  // stopped before the bytes were written and verified, so the registered object stayed pending.
  it("C8-2 rewrites a registered but unverified speech object on rerun and publishes only a verified object", async () => {
    const f = await fixture();
    const asset = await requestTts(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        text: "A short sentence.",
        operationKey: randomUUID(),
        exportAllowed: false,
      },
      f.dependencies,
    );
    const { runId } = await speechRun(asset.id);
    const interruptedJob: JobContext = {
      db,
      now: () => new Date(),
      job: { id: randomUUID(), attempt: 1 },
      async step() {
        throw new Error("Unused fixture job step");
      },
    };
    await executeAuxiliaryProviderStep(interruptedJob, f.ctx, runId, {
      step: "speech",
      model: providerSettings.ttsModel,
      provider: f.provider,
      schema: speechCheckpoint,
      effect: async () => ({
        output: {
          bytesBase64: Buffer.from(SYNTHETIC_SPEECH_BYTES).toString("base64"),
          mimeType: "audio/mpeg" as const,
        },
        requestId: "synthetic-speech",
        model: providerSettings.ttsModel,
        provider: f.provider.name,
        usage: { characters: 17 },
        actualMicros: 2,
      }),
    });
    // The same pending record writeOwnedObject registers before onRegistered commits its pointer;
    // the stopped job never wrote its bytes or verified it.
    const stale = await createObject(db, {
      module: "media",
      ownerUserId: f.ctx.userId,
      retention: "durable",
      contentType: "audio/mpeg",
      sizeBytes: Buffer.byteLength(SYNTHETIC_SPEECH_BYTES),
      now: new Date(),
    });
    await db
      .updateTable("media.asset")
      .set({ state: "processing", object_id: stale.id })
      .where("id", "=", asset.id)
      .execute();

    await run(db, mediaTtsJob(f.dependencies));
    expect(f.provider.calls).toBe(0);
    const ready = await getMediaAsset(db, f.ctx, asset.id);
    expect(ready.state).toBe("ready");
    expect(ready.objectId).not.toBeNull();
    const published = await db
      .selectFrom("plt.storage_object")
      .select("state")
      .where("id", "=", ready.objectId as string)
      .executeTakeFirstOrThrow();
    expect(published.state).toBe("verified");
    expect(Buffer.from((await readMediaBytes(db, f.store, f.ctx, asset.id)).bytes).toString()).toBe(
      SYNTHETIC_SPEECH_BYTES,
    );
    const replaced = await db
      .selectFrom("plt.storage_object")
      .select("state")
      .where("id", "=", stale.id)
      .executeTakeFirstOrThrow();
    expect(replaced.state).toBe("deleted");
    expect(await f.store.read(stale.key)).toBeNull();
    expect((await runState(runId)).state).toBe("ready");
    expect(await providerCosts(f.ctx.userId)).toHaveLength(1);
    expect((await allowance(db, f.ctx)).consumed.tts).toBe(17);
    expect((await allowance(db, f.ctx)).reserved.tts).toBe(0);
  });
});
