import { randomUUID } from "node:crypto";
import type {
  AiProvider,
  ProviderResult,
  ProviderSettings,
  StructuredInput,
  Transcript,
  TranscriptionInput,
} from "@recalino/core/aip";
import { listCards } from "@recalino/core/card";
import { createDatabase } from "@recalino/core/db";
import { getNotebook, publishNotebook } from "@recalino/core/note";
import { createSession } from "@recalino/core/org";
import { type JobContext, MemoryObjectStore, sha256Hex } from "@recalino/core/plt";
import {
  beginAutomaticLearningBatch,
  completeAutomaticLearningBatch,
  createProcessingRun,
  getAutomaticLearningSession,
  getProcessingRunSnapshot,
  listRuns,
  processingJob,
  requestAutomaticLearning,
  selectProcessingSourceSnapshot,
} from "@recalino/core/proc";
import { amounts, configureCostPolicy, grantEntitlement } from "@recalino/core/quota";
import { appendContentVersion } from "@recalino/core/src";
import { afterAll, expect, it } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import {
  automaticLearningJob,
  automaticLearningSync,
  readAutomaticLearning,
} from "./automatic-learning";
import { finalizeAutomaticRun } from "./automatic-learning-publication";

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
afterAll(() => db.destroy());
const providerSettings: ProviderSettings = {
  version: "automatic-fixture",
  llmModel: "synthetic/llm",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 10000,
  maxOutputTokens: 4000,
  timeoutMs: 1000,
  maximumMicros: 10,
  currency: "USD",
  priceVersion: "fixture",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
class AutomaticFixtureProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = providerSettings;
  calls = 0;
  answer = "First verified answer";
  beforeGenerate?: () => Promise<void>;
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    this.calls++;
    await this.beforeGenerate?.();
    const data = JSON.parse(input.input) as {
      sources: {
        sourceId: string;
        contentVersionId: string;
        blocks: { id: string; text: string }[];
      }[];
    };
    const claims = data.sources.map((source, index) => ({
      id: `claim-${index}`,
      text: `Material ${index + 1} supports this learning point.`,
      origin: "from_class",
      creation: "ai_generation",
      evidence: "material",
      sourceRefs: [
        {
          sourceId: source.sourceId,
          contentVersionId: source.contentVersionId,
          locator: {
            kind: "text",
            blockId: source.blocks[0]?.id,
            start: 0,
            end: Array.from(source.blocks[0]?.text ?? "").length,
          },
        },
      ],
      speakerRole: "unknown",
      uncertain: false,
    }));
    return {
      output: input.schema.parse({
        schemaVersion: "1",
        title: "Automatically built class",
        language: { learning: "en", explanation: "en" },
        summary: claims,
        topics: [],
        learningItems: data.sources.map((source, index) => ({
          id: `item-${index}`,
          kind: "concept",
          front: `What does source ${source.sourceId} explain?`,
          back: index === 0 ? this.answer : `Learning point ${index + 1}`,
          claim: { ...claims[index], id: `item-claim-${index}` },
        })),
        homework: [],
        uncertainties: [],
        coverage: { complete: true, missingSourceIds: [] },
        sourceClassifications: [],
      }),
      requestId: `automatic-fixture-${this.calls}`,
      model: input.model,
      provider: this.name,
      actualMicros: 1,
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
  async transcribe(_input: TranscriptionInput): Promise<ProviderResult<Transcript>> {
    throw new Error("No transcription in this fixture");
  }
  async speech(): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    throw new Error("No speech in this fixture");
  }
}
async function fixture(grant = true) {
  const base = await studyFixture(db);
  const session = await createSession(db, base.ctx, {}, { key: randomUUID() });
  const provider = new AutomaticFixtureProvider();
  let workerProvider: AiProvider | undefined = provider;
  const definition = processingJob({
    get provider() {
      return workerProvider;
    },
    store: new MemoryObjectStore(),
  });
  const job = {
    ...definition,
    async run(
      payload: Parameters<typeof definition.run>[0],
      context: Parameters<typeof definition.run>[1],
    ) {
      await definition.run(payload, context);
      await finalizeAutomaticRun(
        context.db,
        { userId: payload.userId, requestId: context.job.id },
        payload.runId,
        context.now(),
      );
    },
  };
  const now = new Date();
  if (grant)
    await grantEntitlement(db, {
      userId: base.ctx.userId,
      startsAt: new Date(now.getTime() - 1000),
      endsAt: new Date(now.getTime() + 3600000),
      amounts: amounts({ document: 100, regeneration: 100, audio: 100 }),
      operationKey: randomUUID(),
      actorId: "synthetic-operator",
      reason: "Local automatic learning test",
    });
  await configureCostPolicy(
    db,
    {
      version: "automatic-fixture",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Local automatic learning test" },
  );
  const addText = async (name: string) => {
    const asset = await db
      .insertInto("src.asset")
      .values({
        user_id: base.ctx.userId,
        kind: "text",
        declared_mime: "text/plain",
        verified_mime: "text/plain",
        size_bytes: name.length,
        sha256: sha256Hex(name),
        display_name: name,
        contract_version: "1",
        retention: "persistent",
        operation_key: randomUUID(),
        request_hash: randomUUID(),
        verified_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("src.session_source")
      .values({
        user_id: base.ctx.userId,
        session_id: session.id,
        asset_id: asset.id,
        role: "class_material",
        selected: true,
      })
      .execute();
    await db.transaction().execute((tx) =>
      appendContentVersion(tx, base.ctx, asset.id, {
        originKey: randomUUID(),
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: {},
        units: [{ id: "doc", kind: "document", start: 1 }],
        blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: name }],
      }),
    );
    return asset.id;
  };
  const sync = () =>
    automaticLearningSync(db, base.ctx, session.id, {
      dependencies: { provider: () => provider, processing: () => job },
    });
  // Other integration fixtures leave durable jobs queued. Drive only this owned class through
  // the real processing/finalization definition instead of draining another learner's jobs.
  const work = async () => {
    for (let step = 0; step < 20; step++) {
      const active = (await listRuns(db, base.ctx, session.id)).find((run) =>
        ["queued", "processing"].includes(run.state),
      );
      if (!active) return;
      const context: JobContext = {
        db,
        now: () => new Date(),
        job: { id: randomUUID(), attempt: 1 },
        step: async () => "ran" as const,
      };
      await job.run({ runId: active.id, userId: base.ctx.userId }, context);
    }
    throw new Error("Synthetic automatic run did not finish within its checkpoint limit");
  };
  return {
    ...base,
    session,
    provider,
    job,
    addText,
    sync,
    work,
    setWorkerProvider: (available: boolean) => {
      workerProvider = available ? provider : undefined;
    },
  };
}

it("finishes one closed upload batch once, saving notes and active cards without manual publication", async () => {
  const f = await fixture();
  const batch = randomUUID();
  await beginAutomaticLearningBatch(db, f.ctx, f.session.id, batch);
  await f.addText("First handout");
  expect((await f.sync()).state).toBe("waiting_sources");
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
  await f.addText("Second handout");
  await completeAutomaticLearningBatch(db, f.ctx, f.session.id, batch);
  const [one, two] = await Promise.all([f.sync(), f.sync()]);
  expect(one.run?.id).toBe(two.run?.id);
  expect((await getProcessingRunSnapshot(db, f.ctx, one.run?.id ?? "")).sources).toHaveLength(2);
  await f.work();
  expect(await readAutomaticLearning(db, f.ctx, f.session.id)).toMatchObject({
    state: "ready",
    notesReady: true,
    cardsReady: true,
  });
  expect((await getNotebook(db, f.ctx, f.session.id))?.current.number).toBe(1);
  const cards = await listCards(db, f.ctx, { sessionId: f.session.id });
  expect(cards).toHaveLength(2);
  expect(cards.every((card) => card.status === "active")).toBe(true);
  await Promise.all([f.sync(), readAutomaticLearning(db, f.ctx, f.session.id)]);
  await f.work();
  expect(f.provider.calls).toBe(1);
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(1);
  expect((await getNotebook(db, f.ctx, f.session.id))?.current.number).toBe(1);
});

it("updates after another material batch, preserving edits and card identities", async () => {
  const f = await fixture();
  await f.addText("Original handout");
  await f.sync();
  await f.work();
  const before = await getNotebook(db, f.ctx, f.session.id);
  const cards = await listCards(db, f.ctx, { sessionId: f.session.id });
  await publishNotebook(
    db,
    f.ctx,
    f.session.id,
    { expectedRevisionId: before?.current.id ?? null, edits: { title: "My own title" } },
    { key: randomUUID() },
  );
  const batch = randomUUID();
  await beginAutomaticLearningBatch(db, f.ctx, f.session.id, batch);
  await f.addText("New material");
  await completeAutomaticLearningBatch(db, f.ctx, f.session.id, batch);
  f.provider.answer = "Updated verified answer";
  await f.sync();
  await f.work();
  const after = await getNotebook(db, f.ctx, f.session.id);
  expect(after?.current.model.title).toBe("My own title");
  expect(after?.current.model.learningItems).toHaveLength(2);
  const updated = await listCards(db, f.ctx, { sessionId: f.session.id });
  expect(updated).toHaveLength(2);
  expect(updated.find((card) => card.id === cards[0]?.id)?.back).toBe("Updated verified answer");
  expect(f.provider.calls).toBe(2);
});

it("queues new material added while a run is active without concurrent reservations", async () => {
  const f = await fixture();
  await f.addText("First material");
  const first = await f.sync();
  f.provider.beforeGenerate = async () => {
    f.provider.beforeGenerate = undefined;
    await f.addText("Late material");
    await requestAutomaticLearning(db, f.ctx, f.session.id);
    expect((await f.sync()).run?.id).toBe(first.run?.id);
  };
  await f.work();
  expect((await getAutomaticLearningSession(db, f.ctx, f.session.id))?.state).toBe(
    "waiting_sources",
  );
  const next = await f.sync();
  expect(next.run?.id).not.toBe(first.run?.id);
  await f.work();
  expect((await getNotebook(db, f.ctx, f.session.id))?.current.model.learningItems).toHaveLength(2);
  expect(f.provider.calls).toBe(2);
});

it("read-only visits do not enable old classes and insufficient allowance never calls the provider", async () => {
  const f = await fixture(false);
  expect((await readAutomaticLearning(db, f.ctx, f.session.id)).state).toBe("idle");
  expect(await getAutomaticLearningSession(db, f.ctx, f.session.id)).toBeNull();
  await f.addText("Allowance test");
  expect(await f.sync()).toMatchObject({ state: "blocked", lastError: "quota_insufficient" });
  await readAutomaticLearning(db, f.ctx, f.session.id);
  expect(f.provider.calls).toBe(0);
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
});

it("keeps a newer failed retry visible when an older successful callback arrives late", async () => {
  const f = await fixture();
  await f.addText("Delayed finalization material");
  const original = await f.sync();
  await f.work();
  const notes = await getNotebook(db, f.ctx, f.session.id);
  f.provider.beforeGenerate = async () => {
    throw new Error("Synthetic terminal failure");
  };
  const retry = await automaticLearningSync(db, f.ctx, f.session.id, {
    retryKey: randomUUID(),
    dependencies: { provider: () => f.provider, processing: () => f.job },
  });
  expect(retry.run?.id).not.toBe(original.run?.id);
  await f.work();
  const failed = await getAutomaticLearningSession(db, f.ctx, f.session.id);
  expect(failed).toMatchObject({ state: "blocked", runId: retry.run?.id });
  await finalizeAutomaticRun(db, f.ctx, original.run?.id ?? "");
  expect(await getAutomaticLearningSession(db, f.ctx, f.session.id)).toEqual(failed);
  expect((await getNotebook(db, f.ctx, f.session.id))?.current.id).toBe(notes?.current.id);
});

it("acknowledges the same retry key after extraction fingerprint changes without new provider work", async () => {
  const f = await fixture();
  const sourceId = await f.addText("Retry acknowledgement material");
  await f.sync();
  await f.work();
  const retryKey = randomUUID();
  const retry = await automaticLearningSync(db, f.ctx, f.session.id, {
    retryKey,
    dependencies: { provider: () => f.provider, processing: () => f.job },
  });
  await f.work();
  const before = await selectProcessingSourceSnapshot(db, f.ctx, f.session.id);
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, f.ctx, sourceId, {
      originKey: randomUUID(),
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "doc", kind: "document", start: 1 }],
      blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: "Refined cached extraction" }],
    }),
  );
  await requestAutomaticLearning(db, f.ctx, f.session.id);
  const after = await selectProcessingSourceSnapshot(db, f.ctx, f.session.id);
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.sourcesVersion).toBeGreaterThan(before.sourcesVersion);
  const calls = f.provider.calls;
  const replay = await automaticLearningSync(db, f.ctx, f.session.id, {
    retryKey,
    dependencies: {
      provider: () => {
        throw new Error("A replay must not construct a provider");
      },
      processing: () => {
        throw new Error("A replay must not require the processing service");
      },
    },
  });
  expect(replay).toMatchObject({ state: "ready", lastError: null, run: { id: retry.run?.id } });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(2);
  expect(f.provider.calls).toBe(calls);
});

it("FR-PROC-003 automatically recovers a provider configuration interruption without rewriting its diagnostic", async () => {
  const f = await fixture();
  await f.addText("Recoverable configuration material");
  await f.sync();
  f.setWorkerProvider(false);
  await f.work();
  const failed = await getAutomaticLearningSession(db, f.ctx, f.session.id);
  expect(failed).toMatchObject({ state: "blocked", lastError: "configuration_unavailable" });
  expect(f.provider.calls).toBe(0);
  f.setWorkerProvider(true);
  const recovery = automaticLearningJob({ provider: () => f.provider, processing: () => f.job });
  const payload = {
    userId: f.ctx.userId,
    sessionId: f.session.id,
    requestVersion: failed?.requestVersion ?? 0,
  };
  const context: JobContext = {
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  };
  await Promise.all([recovery.run(payload, context), recovery.run(payload, context)]);
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(2);
  await f.work();
  await recovery.run(payload, context);
  expect(await readAutomaticLearning(db, f.ctx, f.session.id)).toMatchObject({ state: "ready" });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(2);
  expect(f.provider.calls).toBe(1);
});

it("ignores unselected upload failures while selected incomplete files still need attention", async () => {
  const f = await fixture();
  await f.addText("Selected working handout");
  const original = await f.sync();
  const unavailableId = await f.addText("Unselected failed handout.txt");
  await db
    .updateTable("src.session_source")
    .set({ selected: false })
    .where("session_id", "=", f.session.id)
    .where("asset_id", "=", unavailableId)
    .execute();
  const run = await db
    .selectFrom("proc.processing_run")
    .select("reservation_id")
    .where("id", "=", original.run?.id ?? "")
    .executeTakeFirstOrThrow();
  const upload = await db
    .insertInto("src.upload_session")
    .values({
      asset_id: unavailableId,
      user_id: f.ctx.userId,
      reservation_id: run.reservation_id,
      state: "pending",
      expires_at: new Date(Date.now() + 3600000),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await f.work();
  expect((await f.sync()).state).toBe("ready");
  await db
    .updateTable("src.upload_session")
    .set({ state: "rejected", rejection_reason: "checksum_mismatch" })
    .where("id", "=", upload.id)
    .execute();
  expect((await f.sync()).state).toBe("ready");
  await db
    .updateTable("src.session_source")
    .set({ selected: true })
    .where("session_id", "=", f.session.id)
    .where("asset_id", "=", unavailableId)
    .execute();
  expect(await f.sync()).toMatchObject({ state: "blocked", lastError: "upload_needs_attention" });
  expect(f.provider.calls).toBe(1);
});

it("fences a batch opened after snapshot selection before any allowance reservation", async () => {
  const f = await fixture();
  await f.addText("Guard test");
  const intent = await requestAutomaticLearning(db, f.ctx, f.session.id, { changed: false });
  await beginAutomaticLearningBatch(db, f.ctx, f.session.id, randomUUID());
  await expect(
    createProcessingRun(
      db,
      f.ctx,
      {
        sessionId: f.session.id,
        operationKey: randomUUID(),
        automaticRequestVersion: intent.requestVersion,
      },
      { provider: f.provider, job: f.job },
    ),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { sources: ["changed_after_estimate"] } },
  });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
});
