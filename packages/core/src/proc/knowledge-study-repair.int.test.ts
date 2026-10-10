import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { LOCAL_ADMIN_DATABASE_URL, LOCAL_APP_DATABASE_URL } from "../../test/local-db";
import { cleanupFixtureProcessingJobs } from "../../test/processing-jobs";
import { studyFixture } from "../../test/study-fixture";
import { updateProfile } from "../acc";
import {
  type AiProvider,
  ProviderError,
  type ProviderResult,
  type ProviderSettings,
  type StructuredInput,
} from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion } from "../lkm";
import { createCourse, updateSession } from "../org";
import { type JobContext, MemoryObjectStore } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion } from "../src";
import { sourceSnapshotSchema } from "./contracts";
import { createProcessingRun, getRun, retryRun } from "./runs";
import { generatedKnowledgeSchema, processingJob, providerStep } from "./worker";

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
const runIds: string[] = [];
afterAll(async () => {
  await cleanupFixtureProcessingJobs(db, runIds);
  await db.destroy();
});
const settings: ProviderSettings = {
  version: "synthetic-study-repair",
  llmModel: "synthetic/llm",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 120000,
  maxOutputTokens: 6144,
  timeoutMs: 1000,
  maximumMicros: 100000,
  currency: "USD",
  priceVersion: "fixture",
  charactersPerPage: 3000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};

class StudyRepairProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = { ...settings };
  original: unknown;
  answerParts = ["clamped down on"];
  repairFailure?: ProviderError;
  primaryFailure?: ProviderError;
  /** A general evidence repair, for a first response whose evidence is invalid. */
  evidenceRepair?: (input: StructuredInput<unknown>) => unknown;
  readonly calls = vi.fn(async (input: StructuredInput<unknown>) => {
    if (input.schemaName === "class_knowledge") {
      if (this.primaryFailure) throw this.primaryFailure;
      return this.original;
    }
    if (input.schemaName === "class_knowledge_repair" && this.evidenceRepair)
      return this.evidenceRepair(input);
    if (input.schemaName !== "class_study_sentence_repair")
      throw new Error("A sentence mismatch must never regenerate the lesson");
    if (this.repairFailure) throw this.repairFailure;
    const items: { itemId: string }[] = JSON.parse(input.input).items;
    return { items: items.map(({ itemId }) => ({ itemId, answerParts: this.answerParts })) };
  });
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    return {
      output: input.schema.parse(await this.calls(input)),
      requestId: `synthetic-${input.schemaName}`,
      provider: this.name,
      model: input.model,
      actualMicros: input.schemaName === "class_knowledge" ? 2000 : 1000,
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }
  async transcribe(): Promise<never> {
    throw new Error("Synthetic text fixture never transcribes");
  }
  async speech(): Promise<never> {
    throw new Error("Study sentence repair never generates speech");
  }
}

async function fixture(fullSentence = "The council clamped down on unsafe parking near schools.") {
  const x = await studyFixture(db);
  await updateProfile(
    db,
    x.ctx,
    {
      field: "explanation_language",
      explanationLanguage: "first_language",
    },
    { now: new Date() },
  );
  const source = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: "image",
      declared_mime: "image/jpeg",
      verified_mime: "image/jpeg",
      size_bytes: 100,
      sha256: "b".repeat(64),
      display_name: "Synthetic sentence evidence",
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
      user_id: x.ctx.userId,
      session_id: x.session.id,
      asset_id: source.id,
      role: "class_material",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, x.ctx, source.id, {
      originKey: `study-repair:${source.id}`,
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: { ranges: [] },
      units: [{ id: "image-1", kind: "document", start: 1 }],
      blocks: [{ id: "b1", kind: "paragraph", unitId: "image-1", text: fullSentence }],
    }),
  );
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ document: 10, regeneration: 10 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Local sentence repair test",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-study-repair",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Local sentence repair test" },
  );
  const provider = new StudyRepairProvider();
  const job = processingJob({
    provider,
    store: new MemoryObjectStore(),
    // Exercise the production checkpoint before optional voice work; images never invoke it.
    diarizeVoice: async () => {
      throw new Error("Image fixture must never dispatch voice analysis");
    },
  });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider, job },
  );
  runIds.push(run.id);
  const row = await db
    .selectFrom("proc.processing_run")
    .select("input_snapshot")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  const snapshot = sourceSnapshotSchema.parse(row.input_snapshot);
  const inputSource = snapshot.sources[0];
  if (!inputSource?.contentVersionId) throw new Error("Missing local source snapshot");
  const claim = {
    id: "claim-1",
    text: "این عبارت برای اجرای سخت‌گیرانهٔ قانون به کار می‌رود.",
    origin: "from_class",
    creation: "ai_generation",
    evidence: "material",
    sourceRefs: [
      {
        sourceId: source.id,
        contentVersionId: inputSource.contentVersionId,
        locator: { kind: "text", blockId: "b1", start: 0, end: fullSentence.length },
      },
    ],
    speakerRole: "unknown",
    uncertain: false,
  };
  const original = generatedKnowledgeSchema.parse({
    schemaVersion: "1",
    title: "Synthetic sentence lesson",
    language: { learning: "en", explanation: "fa" },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    sourceClassifications: [
      { sourceId: source.id, classification: { role: "class_material", confidence: "high" } },
    ],
    learningItems: [
      {
        id: "item-1",
        kind: "expression",
        front: "clamp down on (sth/sb)",
        back: "سخت‌گیری کردن",
        claim,
        study: {
          set: "production",
          en: "clamp down on (sth/sb)",
          faMeaning: "سخت‌گیری کردن",
          topic: "rules",
          ipa: "/klæmp daʊn ɒn/",
          faApprox: "کلمپ داون آن",
          gapSentence: "They will ______ something quite different.",
          fullSentence,
          collocations: [],
          noteFa: "برای اجرای سخت‌گیرانهٔ قانون استفاده می‌شود.",
          imageFa: "درِ بسته را تصور کن.",
          sourceFa: "نمونهٔ آموزشی",
        },
      },
    ],
  });
  provider.original = original;
  const context = (): JobContext => ({
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  });
  const work = () => job.run({ runId: run.id, userId: x.ctx.userId }, context());
  return { x, run, provider, original, context, work, job, source };
}

async function steps(runId: string) {
  return db
    .selectFrom("proc.run_step")
    .select(["step", "output"])
    .where("run_id", "=", runId)
    .where("step", "in", ["knowledge", "knowledge:study-repair"])
    .orderBy("step")
    .execute();
}

it("checkpoints each paid stage, resumes without a duplicate call and preserves all evidence", async () => {
  const f = await fixture();
  await f.work();
  expect(f.provider.calls.mock.calls.map(([input]) => input.schemaName)).toEqual([
    "class_knowledge",
  ]);
  const originalCheckpoint = await steps(f.run.id);
  expect(originalCheckpoint).toEqual([{ step: "knowledge", output: f.original }]);
  await f.work();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "processing" });
  expect(f.provider.calls.mock.calls.map(([input]) => input.schemaName)).toEqual([
    "class_knowledge",
    "class_study_sentence_repair",
  ]);
  const checkpoints = await steps(f.run.id);
  expect(checkpoints).toHaveLength(2);
  expect(checkpoints[0]).toEqual(originalCheckpoint[0]);
  await f.work();
  expect(f.provider.calls).toHaveBeenCalledTimes(2);
  expect(await steps(f.run.id)).toEqual(checkpoints);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
  const latest = await getLatestVersion(db, f.x.ctx, f.x.session.id);
  expect(latest?.runId).toBe(f.run.id);
  expect(latest?.model.learningItems[0]?.study).toMatchObject({
    fullSentence: "The council clamped down on unsafe parking near schools.",
    gapSentence: "The council ______ unsafe parking near schools.",
  });
  expect(latest?.model.learningItems[0]?.claim.sourceRefs).toEqual(
    f.original.learningItems[0]?.claim.sourceRefs,
  );
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select(["step", "attempt", "state"])
      .where("run_id", "=", f.run.id)
      .orderBy("step")
      .execute(),
  ).toEqual([
    { step: "knowledge", attempt: 1, state: "succeeded" },
    { step: "knowledge:study-repair", attempt: 1, state: "succeeded" },
  ]);
  const costs = await db
    .selectFrom("quota.provider_cost")
    .select("amount_micros")
    .where("run_id", "=", f.run.id)
    .execute();
  expect(costs.map((cost) => Number(cost.amount_micros)).sort()).toEqual([1000, 2000]);
});

it("gives a general repair that leaves only a mismatched gap one answer-span repair", async () => {
  const f = await fixture();
  const original = structuredClone(f.original);
  const firstClaim = original.learningItems[0]?.claim;
  if (!firstClaim) throw new Error("Missing fixture claim");
  // The first response cites the photo as audio, so the general evidence repair runs first.
  firstClaim.evidence = "audio";
  f.provider.original = original;
  const study = f.original.learningItems[0]?.study;
  f.provider.evidenceRepair = (input) => {
    const key = JSON.parse(input.input).sources[0].evidence[0][0];
    return {
      schemaVersion: "1",
      title: "Synthetic sentence lesson",
      language: { learning: "en", explanation: "fa" },
      summary: [],
      topics: [],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
      learningItems: [
        {
          id: "item-1",
          kind: "expression",
          front: "clamp down on (sth/sb)",
          back: "سخت‌گیری کردن",
          claim: { id: "claim-1", text: firstClaim.text, evidenceKey: key, uncertain: false },
          // The repair keeps the gap that does not match its sentence.
          study,
        },
      ],
    };
  };
  await f.work();
  await f.work();
  await f.work();
  await f.work();
  expect(f.provider.calls.mock.calls.map(([input]) => input.schemaName)).toEqual([
    "class_knowledge",
    "class_knowledge_repair",
    "class_study_sentence_repair",
  ]);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
  const latest = await getLatestVersion(db, f.x.ctx, f.x.session.id);
  expect(latest?.model.learningItems[0]?.study).toMatchObject({
    fullSentence: "The council clamped down on unsafe parking near schools.",
    gapSentence: "The council ______ unsafe parking near schools.",
  });
  expect(latest?.model.learningItems[0]?.claim).toMatchObject({
    origin: "from_class",
    evidence: "material",
  });
  // Each correction is still one paid dispatch: no second general or answer-span repair.
  await f.work();
  expect(f.provider.calls).toHaveBeenCalledTimes(3);
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select(["step", "attempt", "state"])
      .where("run_id", "=", f.run.id)
      .orderBy("step")
      .execute(),
  ).toEqual([
    { step: "knowledge", attempt: 1, state: "succeeded" },
    { step: "knowledge:repair", attempt: 1, state: "succeeded" },
    { step: "knowledge:study-repair", attempt: 1, state: "succeeded" },
  ]);
});

it("rejects an ambiguous answer after one correction and retains the original knowledge checkpoint", async () => {
  const f = await fixture("They put it up and put it down again.");
  f.provider.answerParts = ["put"];
  await f.work();
  const before = (await steps(f.run.id))[0];
  await f.work();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "output_study_repair_answer_invalid",
    outputVersionId: null,
  });
  expect(f.provider.calls).toHaveBeenCalledTimes(2);
  expect((await steps(f.run.id))[0]).toEqual(before);
  expect((await getLatestVersion(db, f.x.ctx, f.x.session.id))?.id).toBe(f.x.knowledge.id);
});

it.each([false, true])(
  "never dispatches a second paid correction after an uncertain=%s outcome",
  async (uncertain) => {
    const f = await fixture();
    const effect = vi.fn(async (): Promise<never> => {
      throw new ProviderError(
        uncertain ? "provider_outcome_unknown" : "provider_http_400",
        false,
        uncertain,
      );
    });
    const invoke = () =>
      providerStep(
        f.context(),
        f.x.ctx,
        f.run.id,
        "knowledge:study-repair",
        settings.llmModel,
        f.provider,
        z.strictObject({ answer: z.string() }),
        effect,
      );
    await expect(invoke()).rejects.toThrow();
    await expect(invoke()).rejects.toMatchObject(
      uncertain
        ? { code: "provider_outcome_unresolved" }
        : { details: { fields: { output: ["knowledge_repair_exhausted"] } } },
    );
    expect(effect).toHaveBeenCalledTimes(1);
    const attempts = await db
      .selectFrom("proc.provider_attempt")
      .select(["id", "state", "hold_id"])
      .where("run_id", "=", f.run.id)
      .execute();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.state).toBe(uncertain ? "uncertain" : "failed");
    if (uncertain) {
      const hold = await db
        .selectFrom("quota.cost_hold")
        .select("closed_at")
        .where("id", "=", attempts[0]?.hold_id ?? "")
        .executeTakeFirstOrThrow();
      expect(hold.closed_at).toBeNull();
      expect(
        await db
          .selectFrom("quota.provider_cost")
          .select("id")
          .where("run_id", "=", f.run.id)
          .execute(),
      ).toEqual([]);
    }
  },
);

async function failedAfterKnowledge(withNotes = false) {
  const f = await fixture();
  if (withNotes) {
    const course = await createCourse(
      db,
      f.x.ctx,
      { name: "Synthetic legacy course" },
      { key: randomUUID() },
    );
    await updateSession(db, f.x.ctx, f.x.session.id, { courseId: course.id });
    f.original.classNotes = {
      date: f.x.session.classDate,
      course: course.name,
      coverage: "Synthetic rules lesson",
      chunks: [],
      board: [],
      tasks: [],
      register: [],
      gapfill: [],
    };
  }
  f.provider.repairFailure = new ProviderError("provider_http_400", false, false);
  await f.work();
  await f.work();
  expect((await getRun(db, f.x.ctx, f.run.id)).state).toBe("failed");
  f.provider.repairFailure = undefined;
  return f;
}

it("owner retry finds an older paid checkpoint, preserves history and bills only its new repair", async () => {
  const f = await failedAfterKnowledge();
  const history = async () => ({
    run: await db
      .selectFrom("proc.processing_run")
      .selectAll()
      .where("id", "=", f.run.id)
      .executeTakeFirstOrThrow(),
    checkpoints: await steps(f.run.id),
    attempts: await db
      .selectFrom("proc.provider_attempt")
      .selectAll()
      .where("run_id", "=", f.run.id)
      .orderBy("step")
      .execute(),
    costs: await db
      .selectFrom("quota.provider_cost")
      .selectAll()
      .where("run_id", "=", f.run.id)
      .orderBy("id")
      .execute(),
  });
  const before = await history();
  // A later known failure without a knowledge checkpoint must not hide the reusable run.
  f.provider.primaryFailure = new ProviderError("provider_http_400", false, false);
  const later = await createProcessingRun(
    db,
    f.x.ctx,
    {
      sessionId: f.x.session.id,
      operationKey: randomUUID(),
    },
    { provider: f.provider, job: f.job },
  );
  runIds.push(later.id);
  await f.job.run({ runId: later.id, userId: f.x.ctx.userId }, f.context());
  expect((await getRun(db, f.x.ctx, later.id)).state).toBe("failed");
  expect(await steps(later.id)).toEqual([]);
  f.provider.primaryFailure = undefined;
  f.provider.calls.mockClear();
  const key = randomUUID();
  const retry = await retryRun(db, f.x.ctx, later.id, key, { provider: f.provider, job: f.job });
  runIds.push(retry.id);
  expect(retry.id).not.toBe(f.run.id);
  expect(retry.reservationId).not.toBe(f.run.reservationId);
  expect(await retryRun(db, f.x.ctx, later.id, key, { provider: f.provider, job: f.job })).toEqual(
    retry,
  );
  expect(await steps(retry.id)).toEqual([{ step: "knowledge", output: f.original }]);
  const provenance = await db
    .selectFrom("proc.run_step")
    .select("output")
    .where("run_id", "=", retry.id)
    .where("step", "=", "knowledge:reused")
    .executeTakeFirstOrThrow();
  expect(provenance.output).toMatchObject({ sourceRunId: f.run.id, sourceStep: "knowledge" });
  expect(
    await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("run_id", "=", retry.id)
      .execute(),
  ).toEqual([]);
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", retry.id)
      .execute(),
  ).toEqual([]);
  for (let i = 0; i < 2; i++)
    await f.job.run({ runId: retry.id, userId: f.x.ctx.userId }, f.context());
  expect((await getRun(db, f.x.ctx, retry.id)).state).toBe("ready");
  expect(f.provider.calls.mock.calls.map(([input]) => input.schemaName)).toEqual([
    "class_study_sentence_repair",
  ]);
  expect(
    (
      await db
        .selectFrom("quota.provider_cost")
        .select("amount_micros")
        .where("run_id", "=", retry.id)
        .execute()
    ).map((cost) => Number(cost.amount_micros)),
  ).toEqual([1000]);
  expect(await history()).toEqual(before);
});

it.each(["prompt", "model", "profile", "source", "date", "course"] as const)(
  "does not reuse a checkpoint after a %s change",
  async (change) => {
    const f = await failedAfterKnowledge();
    if (change === "prompt") f.provider.settings.promptVersion = "changed";
    if (change === "model") f.provider.settings.llmModel = "synthetic/new-model";
    if (change === "profile")
      await updateProfile(
        db,
        f.x.ctx,
        { field: "level_goal", level: "B2", goal: "general" },
        { now: new Date() },
      );
    if (change === "source")
      await db.transaction().execute((tx) =>
        appendContentVersion(tx, f.x.ctx, f.source.id, {
          originKey: `changed:${randomUUID()}`,
          schemaVersion: "1",
          provenance: "user_correction",
          settings: {},
          units: [{ id: "image-1", kind: "document", start: 1 }],
          blocks: [
            { id: "b1", kind: "paragraph", unitId: "image-1", text: "Changed source evidence." },
          ],
        }),
      );
    if (change === "date")
      await updateSession(db, f.x.ctx, f.x.session.id, { classDate: "2027-01-01" });
    if (change === "course") {
      const course = await createCourse(
        db,
        f.x.ctx,
        { name: "Changed synthetic course" },
        { key: randomUUID() },
      );
      await updateSession(db, f.x.ctx, f.x.session.id, { courseId: course.id });
    }
    const retry = await retryRun(db, f.x.ctx, f.run.id, randomUUID(), {
      provider: f.provider,
      job: f.job,
    });
    runIds.push(retry.id);
    expect(await steps(retry.id)).toEqual([]);
  },
);

it("does not expose another owner's checkpoint and does not reuse for ordinary regeneration", async () => {
  const f = await failedAfterKnowledge();
  const other = await fixture();
  await expect(
    retryRun(db, other.x.ctx, f.run.id, randomUUID(), {
      provider: f.provider,
      job: f.job,
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  const fresh = await createProcessingRun(
    db,
    f.x.ctx,
    {
      sessionId: f.x.session.id,
      operationKey: randomUUID(),
    },
    { provider: f.provider, job: f.job },
  );
  runIds.push(fresh.id);
  expect(await steps(fresh.id)).toEqual([]);
});

it.each(["matching", "missing", "mismatched"] as const)(
  "legacy output context must be exact (%s)",
  async (variant) => {
    const f = await failedAfterKnowledge(variant !== "missing");
    await db
      .deleteFrom("proc.run_step")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge:input-context")
      .execute();
    if (variant === "mismatched")
      await updateSession(db, f.x.ctx, f.x.session.id, { classDate: "2027-01-01" });
    const retry = await retryRun(db, f.x.ctx, f.run.id, randomUUID(), {
      provider: f.provider,
      job: f.job,
    });
    runIds.push(retry.id);
    const copied = await steps(retry.id);
    if (variant === "matching") {
      expect(copied).toHaveLength(1);
      const provenance = await db
        .selectFrom("proc.run_step")
        .select("output")
        .where("run_id", "=", retry.id)
        .where("step", "=", "knowledge:reused")
        .executeTakeFirstOrThrow();
      expect(provenance.output).toMatchObject({ contextVerification: "legacy_output_fields" });
      expect(
        await db
          .selectFrom("proc.run_step")
          .select("step")
          .where("run_id", "=", retry.id)
          .where("step", "=", "knowledge:input-context")
          .execute(),
      ).toEqual([]);
    } else expect(copied).toEqual([]);
  },
);

it("never falls back to matching legacy fields when the server input context differs", async () => {
  const f = await failedAfterKnowledge(true);
  // Deliberately replace this synthetic local checkpoint to test fail-closed history validation.
  await db
    .deleteFrom("proc.run_step")
    .where("run_id", "=", f.run.id)
    .where("step", "=", "knowledge:input-context")
    .execute();
  await db
    .insertInto("proc.run_step")
    .values({
      run_id: f.run.id,
      step: "knowledge:input-context",
      output: JSON.stringify({ version: 1, date: "2027-01-01" }),
      completed_at: new Date(),
    })
    .execute();
  const retry = await retryRun(db, f.x.ctx, f.run.id, randomUUID(), {
    provider: f.provider,
    job: f.job,
  });
  runIds.push(retry.id);
  expect(await steps(retry.id)).toEqual([]);
});

it.each(["missing_cost", "open_hold", "failed_attempt"] as const)(
  "does not reuse a checkpoint without trustworthy paid provenance (%s)",
  async (variant) => {
    const f = await failedAfterKnowledge();
    const attempt = await db
      .selectFrom("proc.provider_attempt")
      .select(["id", "hold_id"])
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge")
      .executeTakeFirstOrThrow();
    if (variant === "missing_cost") {
      // Simulate malformed historical accounting in this synthetic LOCAL fixture only.
      const localAdmin = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });
      try {
        await localAdmin
          .deleteFrom("quota.provider_cost")
          .where("attempt_id", "=", attempt.id)
          .execute();
      } finally {
        await localAdmin.destroy();
      }
    } else if (variant === "open_hold")
      await db
        .updateTable("quota.cost_hold")
        .set({ closed_at: null })
        .where("id", "=", attempt.hold_id)
        .execute();
    else
      await db
        .updateTable("proc.provider_attempt")
        .set({ state: "failed" })
        .where("id", "=", attempt.id)
        .execute();
    const retry = await retryRun(db, f.x.ctx, f.run.id, randomUUID(), {
      provider: f.provider,
      job: f.job,
    });
    runIds.push(retry.id);
    expect(await steps(retry.id)).toEqual([]);
  },
);

it("refuses owner retry when a later repair outcome remains uncertain", async () => {
  const f = await fixture();
  f.provider.repairFailure = new ProviderError("provider_outcome_unknown", false, true);
  await f.work();
  await f.work();
  await expect(
    retryRun(db, f.x.ctx, f.run.id, randomUUID(), { provider: f.provider, job: f.job }),
  ).rejects.toMatchObject({ details: { fields: { retry: ["provider_outcome_unresolved"] } } });
});
