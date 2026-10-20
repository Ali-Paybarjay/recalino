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
import { createSession, releaseCaptureLease, renewCaptureLease } from "@recalino/core/org";
import { type JobContext, MemoryObjectStore, sha256Hex } from "@recalino/core/plt";
import {
  beginAutomaticLearningBatch,
  cancelAutomaticLearningBatch,
  completeAutomaticLearningBatch,
  createProcessingRun,
  getAutomaticLearningSession,
  getProcessingRunSnapshot,
  listPendingAutomaticLearning,
  listRuns,
  processingJob,
  registerAutomaticLearningFile,
  requestAutomaticLearning,
  selectProcessingSourceSnapshot,
} from "@recalino/core/proc";
import {
  adjustAllowance,
  allowance,
  amounts,
  configureCostPolicy,
  grantEntitlement,
} from "@recalino/core/quota";
import { appendContentVersion } from "@recalino/core/src";
import { afterAll, expect, it } from "vitest";
import { processAutomaticFixtureSession } from "../../../../packages/core/test/automatic-learning-fixture";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import {
  automaticLearningJob,
  automaticLearningSync,
  readAutomaticLearning,
  scheduleAutomaticLearning,
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
  // D105: the learner presses Process this session; the route then syncs, as here.
  const process = async () => {
    await processAutomaticFixtureSession(db, base.ctx, session.id);
    return sync();
  };
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
    process,
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
  // D105: an upload-only session also waits for Process this session.
  expect(await f.sync()).toMatchObject({ processRequest: "not_requested" });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
  const [one, two] = await Promise.all([f.process(), f.process()]);
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

it("processes a fully received declared batch after browser closure with one run and no duplicate reservation", async () => {
  const f = await fixture(),
    batchId = randomUUID(),
    firstId = randomUUID(),
    secondId = randomUUID();
  await beginAutomaticLearningBatch(db, f.ctx, f.session.id, batchId, new Date(), [
    firstId,
    secondId,
  ]);
  const first = await f.addText("Background first handout");
  await registerAutomaticLearningFile(db, f.ctx, f.session.id, {
    batchId,
    fileId: firstId,
    sourceId: first,
  });
  expect((await f.sync()).state).toBe("waiting_sources");
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
  const second = await f.addText("Background second handout");
  await registerAutomaticLearningFile(db, f.ctx, f.session.id, {
    batchId,
    fileId: secondId,
    sourceId: second,
  });
  // No client complete request follows these persisted server receipts: the server seals the
  // group, and the session then waits for the learner's press (D105).
  expect(await f.sync()).toMatchObject({ batchId: null, processRequest: "not_requested" });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
  const [one, two] = await Promise.all([f.process(), f.process()]);
  expect(one.run?.id).toBe(two.run?.id);
  expect(
    (await getProcessingRunSnapshot(db, f.ctx, one.run?.id ?? "")).sources
      .map((source) => source.sourceId)
      .sort(),
  ).toEqual([first, second].sort());
  await f.work();
  expect(await readAutomaticLearning(db, f.ctx, f.session.id)).toMatchObject({
    state: "ready",
    notesReady: true,
    cardsReady: true,
  });
  await f.sync();
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(1);
  expect(
    await db
      .selectFrom("quota.reservation")
      .select("id")
      .where("user_id", "=", f.ctx.userId)
      .execute(),
  ).toHaveLength(1);
});

it("cancels an incomplete declared group without regenerating or losing earlier notes and cards", async () => {
  const f = await fixture();
  await f.addText("Earlier class material");
  await f.process();
  await f.work();
  const previous = await getNotebook(db, f.ctx, f.session.id),
    calls = f.provider.calls;
  const batchId = randomUUID(),
    fileId = randomUUID();
  await beginAutomaticLearningBatch(db, f.ctx, f.session.id, batchId, new Date(), [fileId]);
  const newSource = await f.addText("Cancelled added material");
  await registerAutomaticLearningFile(db, f.ctx, f.session.id, {
    batchId,
    fileId,
    sourceId: newSource,
  });
  await cancelAutomaticLearningBatch(db, f.ctx, f.session.id, batchId);
  expect(await f.sync()).toMatchObject({
    state: "blocked",
    lastError: "upload_batch_cancelled",
    notesReady: true,
  });
  expect(await getNotebook(db, f.ctx, f.session.id)).toEqual(previous);
  expect(await listCards(db, f.ctx, { sessionId: f.session.id })).toHaveLength(1);
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(1);
  expect(f.provider.calls).toBe(calls);
});

it("updates after another material batch, preserving edits and card identities", async () => {
  const f = await fixture();
  await f.addText("Original handout");
  await f.process();
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
  // D105: the session is open again; nothing regenerates until the learner presses again.
  expect(await f.sync()).toMatchObject({ processRequest: "new_material", notesReady: true });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(1);
  await f.process();
  await f.work();
  const after = await getNotebook(db, f.ctx, f.session.id);
  expect(after?.current.model.title).toBe("My own title");
  expect(after?.current.model.learningItems).toHaveLength(2);
  const updated = await listCards(db, f.ctx, { sessionId: f.session.id });
  expect(updated).toHaveLength(2);
  expect(updated.find((card) => card.id === cards[0]?.id)?.back).toBe("Updated verified answer");
  expect(f.provider.calls).toBe(2);
});

it("D105: new material added during a run waits for the learner's next press, with no follow-up run", async () => {
  const f = await fixture();
  await f.addText("First material");
  const first = await f.process();
  f.provider.beforeGenerate = async () => {
    f.provider.beforeGenerate = undefined;
    await f.addText("Late material");
    await requestAutomaticLearning(db, f.ctx, f.session.id);
    expect((await f.sync()).run?.id).toBe(first.run?.id);
  };
  await f.work();
  // The requested run published its notes; the late material reopened the session.
  expect((await getNotebook(db, f.ctx, f.session.id))?.current.model.learningItems).toHaveLength(1);
  expect(await getAutomaticLearningSession(db, f.ctx, f.session.id)).toMatchObject({
    state: "waiting_sources",
    runId: first.run?.id,
  });
  expect(
    await db
      .selectFrom("plt.job")
      .select("id")
      .where("kind", "=", "proc.automatic_learning")
      .where("payload", "@>", JSON.stringify({ sessionId: f.session.id }))
      .execute(),
  ).toEqual([]);
  const waiting = await f.sync();
  expect(waiting).toMatchObject({ processRequest: "new_material", run: { id: first.run?.id } });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(1);
  const next = await f.process();
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
  expect(await f.sync()).toMatchObject({ processRequest: "not_requested", lastError: null });
  expect(await f.process()).toMatchObject({ state: "blocked", lastError: "quota_insufficient" });
  await readAutomaticLearning(db, f.ctx, f.session.id);
  expect(f.provider.calls).toBe(0);
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
});

it("reads an old ambiguous failed quota run as an operator check without changing its history", async () => {
  const f = await fixture();
  await f.addText("Old quota diagnostic material");
  const current = await f.process();
  const runId = current.run?.id;
  if (!runId) throw new Error("Expected a synthetic processing run");
  const policy = await db.selectFrom("quota.cost_policy").selectAll().executeTakeFirstOrThrow();
  try {
    await configureCostPolicy(
      db,
      {
        version: "automatic-budget-blocker",
        currency: "USD",
        killSwitch: false,
        limits: { session: 9, userMonth: 100000000, systemDay: 100000000, systemMonth: 100000000 },
      },
      { actorId: "synthetic-operator", reason: "Local historical diagnostic regression" },
    );
    await f.work();
    expect(await readAutomaticLearning(db, f.ctx, f.session.id)).toMatchObject({
      state: "blocked",
      lastError: "processing_budget_session",
    });
    // Simulate the only diagnostic retained by the pre-fix production worker.
    await db
      .updateTable("proc.processing_run")
      .set({ last_error: "quota_insufficient" })
      .where("id", "=", runId)
      .where("user_id", "=", f.ctx.userId)
      .execute();
    await db
      .updateTable("proc.automatic_session")
      .set({ last_error: "quota_insufficient" })
      .where("session_id", "=", f.session.id)
      .where("user_id", "=", f.ctx.userId)
      .execute();
    const beforeRun = await db
      .selectFrom("proc.processing_run")
      .selectAll()
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();
    const beforeIntent = await getAutomaticLearningSession(db, f.ctx, f.session.id);
    const beforeReservations = await db
      .selectFrom("quota.reservation")
      .selectAll()
      .where("user_id", "=", f.ctx.userId)
      .execute();
    for (let visit = 0; visit < 2; visit++) {
      const status = await readAutomaticLearning(db, f.ctx, f.session.id);
      expect(status).toMatchObject({ state: "blocked", lastError: "service_processing_blocked" });
      expect(status.message).not.toContain("More allowance is needed");
    }
    expect(
      await db
        .selectFrom("proc.processing_run")
        .selectAll()
        .where("id", "=", runId)
        .executeTakeFirstOrThrow(),
    ).toEqual(beforeRun);
    expect(await getAutomaticLearningSession(db, f.ctx, f.session.id)).toEqual(beforeIntent);
    expect(
      await db
        .selectFrom("quota.reservation")
        .selectAll()
        .where("user_id", "=", f.ctx.userId)
        .execute(),
    ).toEqual(beforeReservations);
    expect(
      await db
        .selectFrom("proc.provider_attempt")
        .select("id")
        .where("run_id", "=", runId)
        .execute(),
    ).toHaveLength(0);
    expect(f.provider.calls).toBe(0);
  } finally {
    await configureCostPolicy(
      db,
      {
        version: policy.version,
        currency: policy.currency,
        killSwitch: policy.kill_switch,
        limits: policy.limits as {
          session: number;
          userMonth: number;
          systemDay: number;
          systemMonth: number;
        },
      },
      { actorId: "synthetic-operator", reason: "Restore local fixture cost policy" },
    );
  }
});

it("keeps explicit retries inside the AI budget and resumes after an operator update", async () => {
  const f = await fixture();
  await f.addText("Guarded retry material");
  const policy = await db.selectFrom("quota.cost_policy").selectAll().executeTakeFirstOrThrow();
  const restore = () =>
    configureCostPolicy(
      db,
      {
        version: policy.version,
        currency: policy.currency,
        killSwitch: policy.kill_switch,
        limits: policy.limits as {
          session: number;
          userMonth: number;
          systemDay: number;
          systemMonth: number;
        },
      },
      { actorId: "synthetic-operator", reason: "Restore local fixture cost policy" },
    );
  const retry = () =>
    automaticLearningSync(db, f.ctx, f.session.id, {
      retryKey: randomUUID(),
      dependencies: { provider: () => f.provider, processing: () => f.job },
    });
  const before = await allowance(db, f.ctx);
  try {
    await configureCostPolicy(
      db,
      {
        version: "automatic-retry-budget",
        currency: "USD",
        killSwitch: false,
        limits: { session: 9, userMonth: 100000000, systemDay: 100000000, systemMonth: 100000000 },
      },
      { actorId: "synthetic-operator", reason: "Local guarded retry regression" },
    );
    await f.process();
    await f.work();
    await retry();
    await f.work();
    expect(await readAutomaticLearning(db, f.ctx, f.session.id)).toMatchObject({
      state: "blocked",
      lastError: "processing_budget_session",
    });
    expect(f.provider.calls).toBe(0);
    expect(await allowance(db, f.ctx)).toEqual(before);
    await restore();
    // A policy update alone never starts new paid processing.
    expect((await readAutomaticLearning(db, f.ctx, f.session.id)).state).toBe("blocked");
    expect(f.provider.calls).toBe(0);
    await retry();
    await f.work();
    expect(await readAutomaticLearning(db, f.ctx, f.session.id)).toMatchObject({
      state: "ready",
      lastError: null,
      notesReady: true,
    });
    expect(f.provider.calls).toBe(1);
    expect((await allowance(db, f.ctx)).consumed.document).toBe(1);
  } finally {
    await restore();
  }
});

it("keeps a newer failed retry visible when an older successful callback arrives late", async () => {
  const f = await fixture();
  await f.addText("Delayed finalization material");
  const original = await f.process();
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
  await f.process();
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
  // D105: the change reopened the session; the learner presses Process this session again.
  await processAutomaticFixtureSession(db, f.ctx, f.session.id);
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
  await f.process();
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
  const original = await f.process();
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
  const intent = await processAutomaticFixtureSession(db, f.ctx, f.session.id);
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

async function limitedFixture(units: Parameters<typeof amounts>[0]) {
  const f = await fixture(false);
  const now = new Date();
  const entitlementId = await grantEntitlement(db, {
    userId: f.ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts(units),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Local D59 automatic learning test",
  });
  return { ...f, entitlementId };
}

it("D59: an update reserves only the new file and names a real shortage with its amounts (FR-QUOTA-007)", async () => {
  const f = await limitedFixture({ document: 1, regeneration: 5 });
  await f.addText("D59 first file");
  await f.process();
  await f.work();
  expect(await readAutomaticLearning(db, f.ctx, f.session.id, () => f.provider)).toMatchObject({
    state: "ready",
  });
  await f.addText("D59 second file");
  // The material routes raise the request version for a new file; the learner presses again.
  await requestAutomaticLearning(db, f.ctx, f.session.id);
  const blocked = await f.process();
  expect(blocked).toMatchObject({
    state: "blocked",
    lastError: "quota_insufficient",
    // Before D59 the update asked for both files again.
    allowance: {
      active: true,
      required: { document: 1, regeneration: 1 },
      available: { document: 0, regeneration: 5 },
    },
  });
  expect(blocked.message).toBe(
    "Your material is saved, but this session needs more allowance than is left. Pages and images: 1 needed, 0 left. Ask the pilot operator for more allowance or select less material, then retry. You do not need to upload the same files again.",
  );
  await adjustAllowance(db, {
    userId: f.ctx.userId,
    entitlementId: f.entitlementId,
    dimension: "document",
    delta: 1,
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Local operator raises the allowance",
  });
  const covered = await readAutomaticLearning(db, f.ctx, f.session.id, () => f.provider);
  expect(covered.message).toBe(
    "Your material is saved. Your allowance now covers this session. Retry to create the notes and flashcards. You do not need to upload the same files again.",
  );
  // FR-QUOTA-007 rule 5: nothing starts until the learner retries.
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(1);
  await automaticLearningSync(db, f.ctx, f.session.id, {
    retryKey: randomUUID(),
    dependencies: { provider: () => f.provider, processing: () => f.job },
  });
  await f.work();
  expect((await allowance(db, f.ctx)).consumed).toMatchObject({ document: 2, regeneration: 1 });
});

it("D59: the same file in another class of the period is processed without new allowance", async () => {
  const f = await limitedFixture({ document: 1, regeneration: 5 });
  await f.addText("D59 shared recording transcript");
  await f.process();
  await f.work();
  const copy = await createSession(db, f.ctx, {}, { key: randomUUID() });
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: f.ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: 31,
      sha256: sha256Hex("D59 shared recording transcript"),
      display_name: "D59 shared recording transcript",
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
      user_id: f.ctx.userId,
      session_id: copy.id,
      asset_id: asset.id,
      role: "class_material",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, f.ctx, asset.id, {
      originKey: randomUUID(),
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "doc", kind: "document", start: 1 }],
      blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: "D59 shared recording" }],
    }),
  );
  await processAutomaticFixtureSession(db, f.ctx, copy.id);
  const started = await automaticLearningSync(db, f.ctx, copy.id, {
    dependencies: { provider: () => f.provider, processing: () => f.job },
  });
  expect(started.state).toBe("processing");
  const run = (await listRuns(db, f.ctx, copy.id))[0];
  if (!run) throw new Error("Expected the copied class to start processing");
  await f.job.run(
    { runId: run.id, userId: f.ctx.userId },
    {
      db,
      now: () => new Date(),
      job: { id: randomUUID(), attempt: 1 },
      step: async () => "ran" as const,
    },
  );
  expect((await listRuns(db, f.ctx, copy.id))[0]?.state).toBe("ready");
  expect((await allowance(db, f.ctx)).consumed.document).toBe(1);
});

// D105 (owner decision 2026-10-20): the production pattern of several runs per class came from
// Stop, a lapsed capture lease and follow-ups each starting lesson work. Only the learner's
// "Process this session" starts it now, once, for the material present at that press.
it("D105: Stop, a lapsed capture lease, the reconciler and Retry start no lesson until the learner presses Process", async () => {
  const f = await fixture();
  const learningJobs = () =>
    db
      .selectFrom("plt.job")
      .select("id")
      .where("kind", "=", "proc.automatic_learning")
      .where("payload", "@>", JSON.stringify({ sessionId: f.session.id }))
      .execute();
  // Part 1 is registered while recording; the material routes raise the request version.
  await renewCaptureLease(db, f.ctx, f.session.id);
  await f.addText("Recorded part 1");
  await requestAutomaticLearning(db, f.ctx, f.session.id);
  expect((await f.sync()).processRequest).toBe("not_requested");
  // Process never stops a recording.
  await expect(processAutomaticFixtureSession(db, f.ctx, f.session.id)).rejects.toMatchObject({
    code: "conflict",
    details: { fields: { session: ["capture_in_progress"] } },
  });
  // Stop releases the lease: still nothing to process until the learner asks.
  await releaseCaptureLease(db, f.ctx, f.session.id);
  expect(await f.sync()).toMatchObject({ processRequest: "not_requested", run: null });
  // Recording again, then the page is lost: the lease lapses on its own.
  await renewCaptureLease(db, f.ctx, f.session.id, new Date(Date.now() - 60 * 60 * 1000));
  await f.addText("Recorded part 2");
  await requestAutomaticLearning(db, f.ctx, f.session.id);
  // What the 60 s reconciler does: the class is not pending, and scheduling queues nothing.
  expect(
    (await listPendingAutomaticLearning(db, 250)).some((row) => row.sessionId === f.session.id),
  ).toBe(false);
  await scheduleAutomaticLearning(db, f.ctx, f.session.id, { changed: false });
  expect(await learningJobs()).toEqual([]);
  // A Retry is for a requested version only.
  await automaticLearningSync(db, f.ctx, f.session.id, {
    retryKey: randomUUID(),
    dependencies: { provider: () => f.provider, processing: () => f.job },
  });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(0);
  // One press, even pressed twice, makes exactly one run with every part.
  const [one, two] = await Promise.all([f.process(), f.process()]);
  expect(one.run?.id).toBeTruthy();
  expect(two.run?.id).toBe(one.run?.id);
  expect(one).toMatchObject({ processRequest: "requested", requestedRevision: one.revision });
  expect((await getProcessingRunSnapshot(db, f.ctx, one.run?.id ?? "")).sources).toHaveLength(2);
  await f.work();
  expect(await f.process()).toMatchObject({ state: "ready", run: { id: one.run?.id } });
  expect(await listRuns(db, f.ctx, f.session.id)).toHaveLength(1);
  expect(f.provider.calls).toBe(1);
  // Once requested, a wake-up queues the lesson job again; that job finds the class ready.
  await scheduleAutomaticLearning(db, f.ctx, f.session.id, { changed: false });
  expect(await learningJobs()).toHaveLength(1);
});
