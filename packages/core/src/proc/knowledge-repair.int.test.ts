import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { LOCAL_ADMIN_DATABASE_URL, testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { saveTeachingPreference, updateProfile } from "../acc";
import {
  type AiProvider,
  ProviderError,
  type ProviderResult,
  type ProviderSettings,
  type StructuredInput,
} from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion, knowledgeModelSchema, modelClaims } from "../lkm";
import { type JobContext, MemoryObjectStore } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion, sourceClassificationSchema } from "../src";
import { sourceSnapshotSchema } from "./contracts";
import { buildKnowledgeRepairInput } from "./knowledge-repair";
import { cancelRun, createProcessingRun, getRun, retryRun } from "./runs";
import { processingJob, providerStep } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "synthetic-semantic-repair",
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
const generatedSchema = knowledgeModelSchema.extend({
  sourceClassifications: z.array(
    z.strictObject({ sourceId: z.uuid(), classification: sourceClassificationSchema }),
  ),
});

class RepairProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings: ProviderSettings;
  constructor(providerSettings: ProviderSettings = settings) {
    this.settings = { ...providerSettings };
  }
  readonly structuredCalls = vi.fn(async (input: StructuredInput<unknown>) => {
    if (this.failure) throw this.failure;
    return this.response(input);
  });
  failure?: ProviderError;
  response: (input: StructuredInput<unknown>) => unknown = (input) => repairedOutput(input);
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    return {
      output: input.schema.parse(await this.structuredCalls(input)),
      requestId: "synthetic-repaired-request",
      provider: this.name,
      model: input.model,
      actualMicros: 59000,
      usage: { inputTokens: 37644, outputTokens: 2300 },
    };
  }
  async transcribe(): Promise<never> {
    throw new Error("Cached evidence must never transcribe again");
  }
  async speech(): Promise<never> {
    throw new Error("Class repair must never dispatch speech");
  }
}

function repairedOutput(input: Pick<StructuredInput<unknown>, "input">, english = false) {
  const data = JSON.parse(input.input);
  const audioKey = data.sources.find((source: { kind: string }) => source.kind === "audio")
    .evidence[0][0];
  const noteKey = data.sources.find((source: { role: string }) => source.role === "user_notes")
    .evidence[0][0];
  const claim = (id: string, evidenceKey: string) => ({
    id,
    text: english ? "A synthetic English explanation." : "این توضیح آموزشی از شواهد کلاس است.",
    evidenceKey,
    uncertain: false,
  });
  return {
    schemaVersion: "1",
    title: "Synthetic present perfect concepts",
    language: { learning: "en", explanation: "fa" },
    summary: [claim("s1", audioKey)],
    topics: [{ id: "t1", title: "Present relevance", claims: [claim("c1", audioKey)] }],
    learningItems: [
      {
        id: "i1",
        kind: "grammar",
        front: "When do we use the present perfect?",
        back: "برای عملی که به زمان حال ارتباط دارد.",
        claim: claim("c2", noteKey),
      },
    ],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
  };
}

async function fixture(
  options: {
    seedOriginal?: boolean;
    originalValid?: boolean;
    providerSettings?: ProviderSettings;
  } = {},
) {
  const x = await studyFixture(db);
  await updateProfile(
    db,
    x.ctx,
    { field: "explanation_language", explanationLanguage: "first_language" },
    { now: new Date() },
  );
  await saveTeachingPreference(db, x.ctx, {
    key: "shorter_examples",
    origin: "explicit",
    value: true,
  });
  const blockCounts = [1395, 16, 11, 17, 3, 22, 5];
  for (const [index, blockCount] of blockCounts.entries()) {
    const audio = index === 0;
    const role = audio
      ? "class_audio"
      : index === 3 || index === 6
        ? "user_notes"
        : "class_material";
    const source = await db
      .insertInto("src.asset")
      .values({
        user_id: x.ctx.userId,
        kind: audio ? "audio" : "image",
        declared_mime: audio ? "audio/mpeg" : "image/jpeg",
        verified_mime: audio ? "audio/mpeg" : "image/jpeg",
        duration_ms: audio ? 1395000 : null,
        size_bytes: 1000,
        // Distinct files: D59 charges identical content once.
        sha256: `${index}`.repeat(64),
        display_name: `Synthetic cached source ${index}`,
        contract_version: "1",
        retention: audio ? "device_only" : "persistent",
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
        role,
        selected: true,
      })
      .execute();
    await db.transaction().execute((tx) =>
      appendContentVersion(tx, x.ctx, source.id, {
        originKey: `synthetic-semantic-repair:${source.id}`,
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: {
          ranges: [],
          sourceClassification: { role: audio ? "class_material" : role, confidence: "high" },
        },
        units: audio
          ? Array.from({ length: blockCount }, (_, i) => ({
              id: `u${i}`,
              kind: "time",
              start: i * 1000,
              end: (i + 1) * 1000,
              status: i === blockCount - 1 ? "partial" : "extracted",
              ...(i === blockCount - 1 ? { reason: "synthetic_partial_audio" } : {}),
            }))
          : [{ id: "image-1", kind: "document", start: 1 }],
        blocks: Array.from({ length: blockCount }, (_, i) => ({
          id: `b${i}`,
          kind: audio ? "transcript" : "paragraph",
          unitId: audio ? `u${i}` : "image-1",
          text: `Synthetic grammar evidence ${index}:${i}.`,
          speakerRole: "unknown",
        })),
      }),
    );
  }
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 2000, document: 100, regeneration: 10 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic bounded knowledge repair integration",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-semantic-repair",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic bounded knowledge repair integration" },
  );
  const provider = new RepairProvider(options.providerSettings);
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const run = await createProcessingRun(
    db,
    x.ctx,
    {
      sessionId: x.session.id,
      operationKey: randomUUID(),
    },
    { provider, job },
  );
  const row = await db
    .selectFrom("proc.processing_run")
    .select("input_snapshot")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  const snapshot = sourceSnapshotSchema.parse(row.input_snapshot);
  for (const source of snapshot.sources)
    await db
      .insertInto("proc.run_step")
      .values({
        run_id: run.id,
        step: `source:${source.sourceId}`,
        output: JSON.stringify(source),
        completed_at: new Date(),
      })
      .execute();
  const jobContext = (): JobContext => ({
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  });
  const audio = snapshot.sources.find((source) => source.kind === "audio");
  if (!audio?.contentVersionId) throw new Error("Synthetic source missing");
  const repair = buildKnowledgeRepairInput(
    {
      sources: snapshot.sources,
      explanationLanguage: "fa",
      teachingPreferences: { shorterExamples: true },
      missingSourceIds: [audio.sourceId],
    },
    120000,
  );
  const claim = {
    id: "s1",
    text: options.originalValid
      ? "این توضیح آموزشی از کلاس است."
      : "A synthetic English explanation.",
    origin: "from_class" as const,
    creation: "ai_generation" as const,
    evidence: "audio" as const,
    sourceRefs: [
      {
        sourceId: audio.sourceId,
        contentVersionId: audio.contentVersionId,
        locator: { kind: "time" as const, startMs: 0, endMs: options.originalValid ? 1000 : 2000 },
      },
    ],
    speakerRole: "unknown" as const,
    uncertain: false,
  };
  const original = {
    schemaVersion: "1" as const,
    title: "Synthetic full-schema original",
    language: { learning: "en" as const, explanation: options.originalValid ? "fa" : "فارسی" },
    summary: [claim],
    topics: [],
    learningItems: [
      {
        id: "i1",
        kind: "grammar" as const,
        front: "Synthetic question",
        back: "پاسخ آموزشی",
        claim: { ...claim, id: "c2" },
      },
    ],
    homework: [],
    uncertainties: options.originalValid
      ? []
      : [
          {
            ...claim,
            id: "u1",
            creation: "user_confirmed" as const,
            uncertain: true,
          },
        ],
    coverage: { complete: true, missingSourceIds: [] },
    sourceClassifications: snapshot.sources.map((source) => ({
      sourceId: source.sourceId,
      classification: {
        role:
          source.kind === "audio"
            ? ("class_material" as const)
            : source.role === "user_notes"
              ? ("user_notes" as const)
              : ("class_material" as const),
        confidence: "high" as const,
      },
    })),
  };
  if (options.seedOriginal !== false)
    await providerStep(
      jobContext(),
      x.ctx,
      run.id,
      "knowledge",
      settings.llmModel,
      provider,
      generatedSchema,
      async () => ({
        output: original,
        requestId: "synthetic-original-success",
        provider: provider.name,
        model: settings.llmModel,
        usage: { inputTokens: 37644, outputTokens: 3416 },
        actualMicros: 54724,
      }),
    );
  const work = async () => {
    for (let step = 0; step < 4; step++) {
      if (!["queued", "processing"].includes((await getRun(db, x.ctx, run.id)).state)) return;
      await job.run({ runId: run.id, userId: x.ctx.userId }, jobContext());
    }
    throw new Error("Synthetic knowledge repair exceeded its bounded continuations");
  };
  const workStep = () => job.run({ runId: run.id, userId: x.ctx.userId }, jobContext());
  return { x, run, snapshot, repair, provider, job, jobContext, work, workStep, original };
}

async function failedWithPaidRepair(options: { providerSettings?: ProviderSettings } = {}) {
  const f = await fixture(options);
  await db
    .insertInto("proc.run_step")
    .values({
      run_id: f.run.id,
      step: "knowledge:input-context",
      output: JSON.stringify({ version: 1, date: f.x.session.classDate }),
      completed_at: new Date(),
    })
    .execute();
  await cancelRun(db, f.x.ctx, f.run.id);
  await db
    .updateTable("proc.processing_run")
    .set({ state: "failed", last_error: "output_time_reference_invalid" })
    .where("id", "=", f.run.id)
    .execute();
  const repairRun = await retryRun(db, f.x.ctx, f.run.id, randomUUID(), {
    provider: f.provider,
    job: f.job,
  });
  const output = repairedOutput(f.repair);
  const item = output.learningItems[0];
  if (!item) throw new Error("Missing synthetic repair item");
  const paid = {
    ...output,
    learningItems: [
      {
        ...item,
        kind: "vocabulary",
        study: {
          set: "production",
          en: "gig (noun)",
          faMeaning: "اجرای موسیقی",
          topic: "music",
          ipa: "/ɡɪɡ/",
          faApprox: "گِگ",
          gapSentence: "She has a ______ at the pub on Saturday.",
          fullSentence: "She has a gig at the pub on Saturday.",
          collocations: [],
          noteFa: "برای اجرای موسیقی استفاده می‌شود.",
          imageFa: "یک صحنهٔ موسیقی را تصور کن.",
          sourceFa: "نمونهٔ آموزشی",
        },
      },
    ],
  };
  await providerStep(
    f.jobContext(),
    f.x.ctx,
    repairRun.id,
    "knowledge:repair",
    settings.llmModel,
    f.provider,
    f.repair.schema,
    async () => ({
      output: f.repair.schema.parse(paid),
      requestId: "synthetic-paid-dictionary-repair",
      provider: f.provider.name,
      model: settings.llmModel,
      usage: { inputTokens: 100, outputTokens: 100 },
      actualMicros: 1000,
    }),
  );
  // Reproduce the immutable historical failure from the pre-compatibility validator.
  await cancelRun(db, f.x.ctx, repairRun.id);
  await db
    .updateTable("proc.processing_run")
    .set({ state: "failed", last_error: "output_study_target_unsupported" })
    .where("id", "=", repairRun.id)
    .execute();
  return { ...f, run: repairRun, paid };
}

it("reuses a fully validated paid repair on explicit retry without another provider call or cost", async () => {
  const f = await failedWithPaidRepair();
  const historical = async () => ({
    steps: await db
      .selectFrom("proc.run_step")
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
  const before = await historical();
  const retry = await retryRun(db, f.x.ctx, f.run.id, randomUUID(), {
    provider: f.provider,
    job: f.job,
  });
  const saved = await db
    .selectFrom("proc.run_step")
    .select(["step", "output"])
    .where("run_id", "=", retry.id)
    .where("step", "in", ["knowledge:repair", "knowledge:repair-reused"])
    .execute();
  expect(saved.find((row) => row.step === "knowledge:repair")?.output).toEqual(f.paid);
  expect(saved.find((row) => row.step === "knowledge:repair-reused")?.output).toMatchObject({
    sourceRunId: f.run.id,
    sourceStep: "knowledge:repair",
  });
  await f.job.run({ runId: retry.id, userId: f.x.ctx.userId }, f.jobContext());
  expect(await getRun(db, f.x.ctx, retry.id)).toMatchObject({ state: "partial_ready" });
  expect(f.provider.structuredCalls).not.toHaveBeenCalled();
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
  expect(await historical()).toEqual(before);
});

it.each(["context", "knowledge", "schema", "answer", "cost", "attempt"] as const)(
  "never reuses a paid repair after its %s proof is invalid",
  async (changed) => {
    const f = await failedWithPaidRepair();
    if (changed === "context") {
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
          output: JSON.stringify({ version: 1, date: "2030-01-01" }),
          completed_at: new Date(),
        })
        .execute();
    }
    if (changed === "knowledge") {
      // A later repair cannot be attached to a different saved original response.
      const other = await createProcessingRun(
        db,
        f.x.ctx,
        { sessionId: f.x.session.id, operationKey: randomUUID() },
        { provider: f.provider, job: f.job },
      );
      await providerStep(
        f.jobContext(),
        f.x.ctx,
        other.id,
        "knowledge",
        settings.llmModel,
        f.provider,
        generatedSchema,
        async () => ({
          output: { ...f.original, title: "Different original" },
          requestId: "synthetic-different-original",
          provider: f.provider.name,
          model: settings.llmModel,
          usage: {},
          actualMicros: 1000,
        }),
      );
      await db
        .insertInto("proc.run_step")
        .values({
          run_id: other.id,
          step: "knowledge:input-context",
          output: JSON.stringify({ version: 1, date: f.x.session.classDate }),
          completed_at: new Date(),
        })
        .execute();
      await cancelRun(db, f.x.ctx, other.id);
      await db
        .updateTable("proc.processing_run")
        .set({ state: "failed" })
        .where("id", "=", other.id)
        .execute();
    }
    if (changed === "schema" || changed === "answer") {
      const broken = structuredClone(f.paid);
      if (changed === "schema") (broken as Record<string, unknown>).unknown = true;
      else {
        const item = broken.learningItems[0];
        if (!item) throw new Error("Missing synthetic paid item");
        item.study.gapSentence = "She has a gig at the ______ on Saturday.";
      }
      await db
        .deleteFrom("proc.run_step")
        .where("run_id", "=", f.run.id)
        .where("step", "=", "knowledge:repair")
        .execute();
      await db
        .insertInto("proc.run_step")
        .values({
          run_id: f.run.id,
          step: "knowledge:repair",
          output: JSON.stringify(broken),
          completed_at: new Date(),
        })
        .execute();
    }
    if (changed === "cost") {
      // Only this synthetic local fixture impersonates the database owner.
      const localAdmin = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });
      try {
        await localAdmin
          .deleteFrom("quota.provider_cost")
          .where("run_id", "=", f.run.id)
          .where("operation_key", "like", "%:knowledge:repair:%")
          .execute();
      } finally {
        await localAdmin.destroy();
      }
    }
    if (changed === "attempt")
      await db
        .updateTable("proc.provider_attempt")
        .set({ state: "failed" })
        .where("run_id", "=", f.run.id)
        .where("step", "=", "knowledge:repair")
        .execute();
    const retry = await retryRun(db, f.x.ctx, f.run.id, randomUUID(), {
      provider: f.provider,
      job: f.job,
    });
    expect(
      await db
        .selectFrom("proc.run_step")
        .select("step")
        .where("run_id", "=", retry.id)
        .where("step", "in", ["knowledge:repair", "knowledge:repair-reused"])
        .execute(),
    ).toEqual([]);
  },
);

it("FR-PROC-003 D56 never replays an earlier paid repair into a content-contract retry", async () => {
  // Under the content contract a paid knowledge:repair is a whole regenerated lesson, so only the
  // legacy evidence-key repair is replayed. Even a legacy-shaped paid repair is skipped here: a
  // retry after a validator fix pays for its own regeneration instead (known D56 limitation).
  const content: ProviderSettings = {
    ...settings,
    version: "synthetic-content-repair",
    structuredModelOverrides: { [settings.llmModel]: { knowledgeContract: "content" } },
  };
  const f = await failedWithPaidRepair({ providerSettings: content });
  const retry = await retryRun(db, f.x.ctx, f.run.id, randomUUID(), {
    provider: f.provider,
    job: f.job,
  });
  const steps = await db
    .selectFrom("proc.run_step")
    .select("step")
    .where("run_id", "=", retry.id)
    .where("step", "in", ["knowledge:reused", "knowledge:repair", "knowledge:repair-reused"])
    .execute();
  // The paid generation is still recovered; its paid repair is not.
  expect(steps.map((row) => row.step)).toEqual(["knowledge:reused"]);
  expect(
    await db
      .selectFrom("proc.run_step")
      .select("output")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge:repair")
      .executeTakeFirstOrThrow(),
  ).toEqual({ output: f.paid });
  expect(f.provider.structuredCalls).not.toHaveBeenCalled();
});

function knownTruncation(): ProviderError {
  return new ProviderError("provider_output_truncated", false, false, {
    requestId: "synthetic-truncated-knowledge",
    provider: "synthetic",
    model: settings.llmModel,
    actualMicros: 68060,
    usage: { inputTokens: 37340, outputTokens: 6144 },
  });
}

it("checkpoints a paid known truncation then generates one compact complete result with unchanged input and cost limit", async () => {
  const f = await fixture({ seedOriginal: false, originalValid: true });
  f.provider.response = (input) => {
    if (input.operationKey === `${f.run.id}:knowledge:1`) throw knownTruncation();
    return f.original;
  };
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "processing" });
  const marker = await db
    .selectFrom("proc.run_step")
    .select("output")
    .where("run_id", "=", f.run.id)
    .where("step", "=", "knowledge:truncated")
    .executeTakeFirstOrThrow();
  expect(marker.output).toMatchObject({ reason: "provider_output_truncated" });
  expect(
    await db
      .selectFrom("proc.run_step")
      .select("step")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge")
      .execute(),
  ).toHaveLength(0);
  const firstCost = await db
    .selectFrom("quota.provider_cost")
    .select("amount_micros")
    .where("run_id", "=", f.run.id)
    .executeTakeFirstOrThrow();
  expect(Number(firstCost.amount_micros)).toBe(68060);
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(2);
  const first = f.provider.structuredCalls.mock.calls[0]?.[0];
  const compact = f.provider.structuredCalls.mock.calls[1]?.[0];
  expect(compact?.operationKey).toBe(`${f.run.id}:knowledge:compact:1`);
  expect(compact?.input).toBe(first?.input);
  expect(compact?.schema).toBe(first?.schema);
  expect(compact?.model).toBe(first?.model);
  expect(compact?.system).toContain("at most ONE complete learning item");
  expect(compact?.system).toContain("hard limit of 2048 output tokens");
  expect(compact?.system).toContain("این نسخه گزیده‌ای از درس است");
  expect(f.provider.settings.maxOutputTokens).toBe(6144);
  const outputs = await db
    .selectFrom("proc.run_step")
    .select(["step", "output"])
    .where("run_id", "=", f.run.id)
    .where("step", "in", ["knowledge", "knowledge:compact"])
    .execute();
  expect(outputs).toHaveLength(2);
  expect(outputs[0]?.output).toEqual(outputs[1]?.output);
  expect(
    (
      await db
        .selectFrom("proc.run_step")
        .select("output")
        .where("run_id", "=", f.run.id)
        .where("step", "=", "knowledge:input-context")
        .executeTakeFirstOrThrow()
    ).output,
  ).toEqual({ version: 1, date: f.x.session.classDate });
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "partial_ready" });
  const costs = await db
    .selectFrom("quota.provider_cost")
    .select("amount_micros")
    .where("run_id", "=", f.run.id)
    .execute();
  expect(costs.map((row) => Number(row.amount_micros)).sort((a, b) => a - b)).toEqual([
    59000, 68060,
  ]);
  await db
    .updateTable("proc.processing_run")
    .set({ state: "queued" })
    .where("id", "=", f.run.id)
    .execute();
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(2);
});

it("never repeats a failed compact generation even after its job is replayed", async () => {
  const f = await fixture({ seedOriginal: false });
  f.provider.response = () => {
    throw knownTruncation();
  };
  await f.workStep();
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(2);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "provider_output_truncated",
  });
  await db
    .updateTable("proc.processing_run")
    .set({ state: "queued" })
    .where("id", "=", f.run.id)
    .execute();
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(2);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "knowledge_repair_exhausted",
  });
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge:compact")
      .execute(),
  ).toHaveLength(1);
});

it.each([
  new ProviderError("provider_outcome_unknown", false, true),
  new ProviderError("provider_http_503", false, true),
  new ProviderError("provider_http_400", false, false),
  new ProviderError("provider_schema_invalid", false, false),
  new ProviderError("provider_output_truncated", false, false),
  new ProviderError("provider_output_truncated", false, true, knownTruncation().accounting),
])(
  "never creates compact recovery for an unproven or unrelated failure: $code",
  async (failure) => {
    const f = await fixture({ seedOriginal: false });
    f.provider.failure = failure;
    await f.workStep();
    expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
    expect(
      await db
        .selectFrom("proc.run_step")
        .select("step")
        .where("run_id", "=", f.run.id)
        .where("step", "in", ["knowledge:truncated", "knowledge:compact"])
        .execute(),
    ).toHaveLength(0);
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: failure.uncertain ? "needs_input" : "failed",
      lastError: failure.code,
    });
  },
);

it("records the exact server lesson context for a successful primary response", async () => {
  const f = await fixture({ seedOriginal: false, originalValid: true });
  f.provider.response = () => f.original;
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  expect(
    (
      await db
        .selectFrom("proc.run_step")
        .select("output")
        .where("run_id", "=", f.run.id)
        .where("step", "=", "knowledge:input-context")
        .executeTakeFirstOrThrow()
    ).output,
  ).toEqual({ version: 1, date: f.x.session.classDate });
});

it("resumes the compact step when a worker stops after saving truncation accounting but before scheduling", async () => {
  const f = await fixture({ seedOriginal: false, originalValid: true });
  await expect(
    providerStep(
      f.jobContext(),
      f.x.ctx,
      f.run.id,
      "knowledge",
      settings.llmModel,
      f.provider,
      generatedSchema,
      async () => {
        throw knownTruncation();
      },
    ),
  ).rejects.toMatchObject({ code: "provider_output_truncated" });
  f.provider.response = () => f.original;
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  expect(f.provider.structuredCalls.mock.calls[0]?.[0].operationKey).toBe(
    `${f.run.id}:knowledge:compact:1`,
  );
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "partial_ready" });
});

it("preserves an unresolved compact hold and never dispatches it again", async () => {
  const f = await fixture({ seedOriginal: false });
  f.provider.response = (input) => {
    if (input.operationKey === `${f.run.id}:knowledge:1`) throw knownTruncation();
    throw new ProviderError("provider_outcome_unknown", false, true);
  };
  await f.workStep();
  await f.workStep();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "needs_input",
    lastError: "provider_outcome_unknown",
  });
  const attempt = await db
    .selectFrom("proc.provider_attempt")
    .selectAll()
    .where("run_id", "=", f.run.id)
    .where("step", "=", "knowledge:compact")
    .executeTakeFirstOrThrow();
  expect(attempt.state).toBe("uncertain");
  expect(
    (
      await db
        .selectFrom("quota.cost_hold")
        .select("closed_at")
        .where("id", "=", attempt.hold_id)
        .executeTakeFirstOrThrow()
    ).closed_at,
  ).toBeNull();
  await db
    .updateTable("proc.processing_run")
    .set({ state: "queued" })
    .where("id", "=", f.run.id)
    .execute();
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(2);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "needs_input",
    lastError: "provider_outcome_unresolved",
  });
});

it("settles a finished truncated response after cancellation without dispatching compact recovery", async () => {
  const f = await fixture({ seedOriginal: false });
  f.provider.response = async () => {
    await cancelRun(db, f.x.ctx, f.run.id);
    throw knownTruncation();
  };
  await f.workStep();
  await f.workStep();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "cancelled" });
  const cost = await db
    .selectFrom("quota.provider_cost")
    .select("amount_micros")
    .where("run_id", "=", f.run.id)
    .executeTakeFirstOrThrow();
  expect(Number(cost.amount_micros)).toBe(68060);
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge:compact")
      .execute(),
  ).toHaveLength(0);
});

async function originalEvidence(runId: string) {
  const attempt = await db
    .selectFrom("proc.provider_attempt")
    .selectAll()
    .where("run_id", "=", runId)
    .where("step", "=", "knowledge")
    .executeTakeFirstOrThrow();
  return {
    attempt,
    hold: await db
      .selectFrom("quota.cost_hold")
      .selectAll()
      .where("id", "=", attempt.hold_id)
      .executeTakeFirstOrThrow(),
    cost: await db
      .selectFrom("quota.provider_cost")
      .selectAll()
      .where("attempt_id", "=", attempt.id)
      .executeTakeFirstOrThrow(),
    checkpoint: await db
      .selectFrom("proc.run_step")
      .selectAll()
      .where("run_id", "=", runId)
      .where("step", "=", "knowledge")
      .executeTakeFirstOrThrow(),
  };
}

it("repairs an immutable invalid full-schema cache once using all 1469 blocks and publishes partial notes with normal accounting", async () => {
  const f = await fixture();
  const before = await originalEvidence(f.run.id);
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  const call = f.provider.structuredCalls.mock.calls[0]?.[0];
  expect(call?.schemaName).toBe("class_knowledge_repair");
  expect(call?.operationKey).toBe(`${f.run.id}:knowledge:repair:1`);
  expect(call?.system).toContain('language.explanation must be exactly "fa"');
  expect(call?.system).toContain("each claim.text explains in the resolved explanation language");
  expect(call?.system).toContain("All explanation prose must use Persian (Farsi)");
  expect(call?.system).toContain("Every claim text");
  expect(call?.system).toContain("real Persian explanation in Arabic script");
  expect(call?.system).toContain("hard limit of 6144 output tokens");
  expect(call?.system).not.toContain("Return every required sourceClassifications entry");
  expect(call?.system).not.toContain("From-class claims require real sourceId/contentVersionId");
  const input = JSON.parse(call?.input ?? "{}");
  expect(input.format).toBe("knowledge_repair_keys_v1");
  expect(input.sources).toHaveLength(7);
  expect(
    input.sources.reduce(
      (total: number, source: { evidence: unknown[] }) => total + source.evidence.length,
      0,
    ),
  ).toBe(1469);
  expect(Array.from(call?.input ?? "").length).toBeLessThanOrEqual(120000);
  const sentTexts = input.sources.flatMap((source: { evidence: unknown[][] }) =>
    source.evidence.map((row) => row[row[1] === "text" ? 5 : 4]),
  );
  expect(sentTexts).toEqual(
    f.snapshot.sources.flatMap((source) => source.blocks.map((block) => block.text)),
  );
  expect(await originalEvidence(f.run.id)).toEqual(before);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "partial_ready",
    lastError: null,
  });
  const latest = await getLatestVersion(db, f.x.ctx, f.x.session.id);
  expect(latest?.runId).toBe(f.run.id);
  expect(latest?.model.learningItems).toHaveLength(1);
  expect(latest?.model.language.explanation).toBe("fa");
  expect(latest?.model.coverage).toEqual({
    complete: false,
    missingSourceIds: [f.snapshot.sources.find((source) => source.kind === "audio")?.sourceId],
  });
  expect(
    latest &&
      modelClaims(latest.model).every(
        (claim) => claim.creation === "ai_generation" && claim.speakerRole === "unknown",
      ),
  ).toBe(true);
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
  ]);
  const costs = await db
    .selectFrom("quota.provider_cost")
    .select("amount_micros")
    .where("run_id", "=", f.run.id)
    .execute();
  expect(costs.map((cost) => Number(cost.amount_micros)).sort((a, b) => a - b)).toEqual([
    54724, 59000,
  ]);
  const reservation = await db
    .selectFrom("quota.reservation")
    .select(["settled_amounts", "closed_at"])
    .where("id", "=", f.run.reservationId)
    .executeTakeFirstOrThrow();
  expect(reservation.settled_amounts).toEqual({
    audio: 1395,
    document: 6,
    regeneration: 1,
    tts: 0,
    storage: 0,
  });
  expect(reservation.closed_at).toBeInstanceOf(Date);
  expect(
    await db
      .selectFrom("quota.ledger")
      .select("dimension")
      .where("reservation_id", "=", f.run.reservationId)
      .where("kind", "=", "settle")
      .execute(),
  ).toHaveLength(3);
});

it("never dispatches recursively when the bounded language correction also violates the script", async () => {
  const f = await fixture();
  f.provider.response = (input) => {
    if (input.schemaName === "class_knowledge_translation") {
      const data = JSON.parse(input.input);
      return {
        language: "fa",
        translations: data.targets.map((target: { key: string }) => ({
          key: target.key,
          text: "Still an English explanation.",
        })),
      };
    }
    return repairedOutput(input, true);
  };
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(2);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "output_language_script_mismatch",
    outputVersionId: null,
  });
  await db
    .updateTable("proc.processing_run")
    .set({ state: "queued" })
    .where("id", "=", f.run.id)
    .execute();
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(2);
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge:repair")
      .execute(),
  ).toHaveLength(1);
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge:repair-language")
      .execute(),
  ).toHaveLength(1);
});

it("does not attempt semantic repair after an unknown original provider outcome", async () => {
  const f = await fixture({ seedOriginal: false });
  f.provider.failure = new ProviderError("provider_outcome_unknown", false, true);
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  expect(f.provider.structuredCalls.mock.calls[0]?.[0].schemaName).toBe("class_knowledge");
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "needs_input",
    lastError: "provider_outcome_unknown",
  });
  const attempt = await db
    .selectFrom("proc.provider_attempt")
    .selectAll()
    .where("run_id", "=", f.run.id)
    .executeTakeFirstOrThrow();
  expect(attempt.step).toBe("knowledge");
  expect(attempt.state).toBe("uncertain");
  expect(
    (
      await db
        .selectFrom("quota.cost_hold")
        .select("closed_at")
        .where("id", "=", attempt.hold_id)
        .executeTakeFirstOrThrow()
    ).closed_at,
  ).toBeNull();
  expect(
    await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("run_id", "=", f.run.id)
      .execute(),
  ).toEqual([]);
});

it("reuses a valid cached repair without another provider call after a continuation", async () => {
  const f = await fixture();
  await providerStep(
    f.jobContext(),
    f.x.ctx,
    f.run.id,
    "knowledge:repair",
    settings.llmModel,
    f.provider,
    f.repair.schema,
    async () => ({
      output: f.repair.schema.parse(repairedOutput({ input: f.repair.input })),
      requestId: "synthetic-cached-repair",
      provider: f.provider.name,
      model: settings.llmModel,
      usage: { inputTokens: 37644, outputTokens: 2300 },
      actualMicros: 59000,
    }),
  );
  const before = await originalEvidence(f.run.id);
  await f.work();
  expect(f.provider.structuredCalls).not.toHaveBeenCalled();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "partial_ready",
    lastError: null,
  });
  expect(await originalEvidence(f.run.id)).toEqual(before);
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", f.run.id)
      .execute(),
  ).toHaveLength(2);
});

it("keeps an already valid full-schema cached knowledge result on the original path", async () => {
  const f = await fixture({ originalValid: true });
  const before = await originalEvidence(f.run.id);
  await f.work();
  expect(f.provider.structuredCalls).not.toHaveBeenCalled();
  expect(await originalEvidence(f.run.id)).toEqual(before);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "partial_ready",
    lastError: null,
  });
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("step")
      .where("run_id", "=", f.run.id)
      .execute(),
  ).toEqual([{ step: "knowledge" }]);
});

it("blocks a second paid dispatch after a known failed repair response", async () => {
  const f = await fixture();
  f.provider.failure = new ProviderError("provider_http_400", false, false, {
    requestId: "synthetic-repair-400",
    provider: f.provider.name,
    model: settings.llmModel,
    actualMicros: 0,
    usage: {},
  });
  await f.work();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "provider_http_400",
  });
  await db
    .updateTable("proc.processing_run")
    .set({ state: "queued" })
    .where("id", "=", f.run.id)
    .execute();
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "knowledge_repair_exhausted",
  });
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge:repair")
      .execute(),
  ).toHaveLength(1);
});

it("blocks an unknown repair outcome without repeating its dispatch or settling its cost", async () => {
  const f = await fixture();
  const before = await originalEvidence(f.run.id);
  f.provider.failure = new ProviderError("provider_outcome_unknown", false, true);
  await f.work();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "needs_input",
    lastError: "provider_outcome_unknown",
  });
  const attempt = await db
    .selectFrom("proc.provider_attempt")
    .selectAll()
    .where("run_id", "=", f.run.id)
    .where("step", "=", "knowledge:repair")
    .executeTakeFirstOrThrow();
  expect(attempt.state).toBe("uncertain");
  expect(
    (
      await db
        .selectFrom("quota.cost_hold")
        .select("closed_at")
        .where("id", "=", attempt.hold_id)
        .executeTakeFirstOrThrow()
    ).closed_at,
  ).toBeNull();
  expect(
    await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("attempt_id", "=", attempt.id)
      .execute(),
  ).toEqual([]);
  await db
    .updateTable("proc.processing_run")
    .set({ state: "queued" })
    .where("id", "=", f.run.id)
    .execute();
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "needs_input",
    lastError: "provider_outcome_unresolved",
  });
  expect(await originalEvidence(f.run.id)).toEqual(before);
});

it("does not treat changed provider settings as a semantic repair opportunity", async () => {
  const f = await fixture();
  f.provider.settings.version = "synthetic-changed-provider-settings";
  await f.work();
  expect(f.provider.structuredCalls).not.toHaveBeenCalled();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "settings_changed",
  });
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("step")
      .where("run_id", "=", f.run.id)
      .execute(),
  ).toEqual([{ step: "knowledge" }]);
});

it("stores shared rich lesson items through the worker with authoritative date and withheld speech", async () => {
  const f = await fixture({ seedOriginal: false });
  const output = f.repair.decode(repairedOutput({ input: f.repair.input }));
  const item = output.learningItems[0];
  if (!item) throw new Error("Missing rich lesson fixture");
  item.kind = "expression";
  item.study = {
    set: "production",
    en: "wear and tear",
    ipa: "/ˌweər ən ˈteə/",
    faApprox: "وِئِر اِن تِئِ",
    faMeaning: "فرسودگی ناشی از استفاده",
    topic: "binomials",
    gapSentence: "My old bike is showing signs of ______ after years of use.",
    fullSentence: "My old bike is showing signs of wear and tear after years of use.",
    collocations: ["normal wear and tear", "show signs of wear and tear"],
    noteFa: "این عبارت غیرقابل‌شمارش است.",
    imageFa: "لاستیک‌های ساییده‌ی دوچرخه.",
    sourceFa: "یادداشت کلاس",
  };
  output.classNotes = {
    date: "1999-01-01",
    institution: "Invented institution",
    course: "Invented course",
    coverage: "Binomials",
    chunks: [],
    board: [],
    tasks: [],
    register: [],
    gapfill: [],
    mistakes: {
      speechStatus: "verified",
      patterns: [
        {
          labelFa: "الگوی اشتباه",
          count: 2,
          examples: ["hidden spoken sentence"],
          ruleFa: "دلیل اصلاح",
        },
      ],
      items: [
        {
          source: "speech",
          said: "hidden spoken sentence",
          correct: "correct sentence",
          whyFa: "دلیل اصلاح",
          kind: "grammar",
          teacherCorrected: true,
        },
        {
          source: "handwriting",
          said: "a wear and tear",
          correct: "wear and tear",
          whyFa: "غیرقابل‌شمارش است.",
          kind: "grammar",
          teacherCorrected: true,
          itemId: item.id,
        },
      ],
    },
  };
  f.provider.response = () => output;
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  const call = f.provider.structuredCalls.mock.calls[0]?.[0];
  expect(call?.schemaName).toBe("class_knowledge");
  expect(call?.system).toContain("one shared source");
  expect(JSON.parse(call?.input ?? "{}").lessonContext.date).toBe(f.x.session.classDate);
  const saved = await getLatestVersion(db, f.x.ctx, f.x.session.id);
  expect(saved?.model.learningItems[0]?.study).toEqual(item.study);
  expect(saved?.model.learningItems[0]?.front).toBe("wear and tear");
  expect(saved?.model.learningItems[0]?.back).toBe("فرسودگی ناشی از استفاده");
  expect(saved?.model.classNotes?.date).toBe(f.x.session.classDate);
  expect(saved?.model.classNotes?.institution).toBeUndefined();
  expect(saved?.model.classNotes?.course).not.toBe("Invented course");
  expect(saved?.model.classNotes?.mistakes?.speechStatus).toBe("unverified");
  expect(saved?.model.classNotes?.mistakes?.items).toHaveLength(1);
  expect(saved?.model.classNotes?.mistakes?.items[0]?.itemId).toBe(
    saved?.model.learningItems[0]?.id,
  );
  expect(JSON.stringify(saved?.model)).not.toContain("hidden spoken sentence");
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "partial_ready" });
});
