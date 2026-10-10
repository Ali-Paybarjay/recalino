import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { testDatabaseUrl } from "../../test/local-db";
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
import {
  getLatestVersion,
  knowledgeModelSchema,
  matchesExplanationScript,
  modelClaims,
} from "../lkm";
import { AppError, type JobContext, MemoryObjectStore } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion, sourceClassificationSchema } from "../src";
import { sourceSnapshotSchema } from "./contracts";
import { buildKnowledgeRepairInput } from "./knowledge-repair";
import { buildKnowledgeTranslationInput } from "./knowledge-translation";
import { createProcessingRun, getRun } from "./runs";
import { processingJob, providerStep } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "synthetic-language-correction",
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
  modelMaximumMicros: { "synthetic/stt": 5000, "synthetic/vision": 30000 },
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
function translationOutput(input: Pick<StructuredInput<unknown>, "input">) {
  const data = JSON.parse(input.input);
  return {
    language: "fa",
    translations: data.targets.map((target: { key: string; protectedEnglish?: string[] }) => ({
      key: target.key,
      text: `این توضیح آموزشی به زبان فارسی است. ${(target.protectedEnglish ?? []).join(" ")}`,
    })),
  };
}
class TranslationProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = settings;
  readonly structuredCalls = vi.fn(async (input: StructuredInput<unknown>) => {
    if (this.failure) throw this.failure;
    return this.response(input);
  });
  failure?: ProviderError;
  response: (input: StructuredInput<unknown>) => unknown = translationOutput;
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    return {
      output: (await this.structuredCalls(input)) as T,
      requestId: "synthetic-language-correction",
      provider: this.name,
      model: input.model,
      actualMicros: 11000,
      usage: { inputTokens: 2300, outputTokens: 900 },
    };
  }
  async transcribe(): Promise<never> {
    throw new Error("Cached transcription must not dispatch");
  }
  async speech(): Promise<never> {
    throw new Error("Language correction must not dispatch speech");
  }
}

async function fixture(options: { invalidHomework?: boolean; fullHistory?: boolean } = {}) {
  const x = await studyFixture(db);
  await updateProfile(
    db,
    x.ctx,
    { field: "explanation_language", explanationLanguage: "first_language" },
    { now: new Date() },
  );
  for (let index = 0; index < 7; index++) {
    const audio = index === 0;
    const role = audio ? "class_audio" : index === 6 ? "user_notes" : "class_material";
    const source = await db
      .insertInto("src.asset")
      .values({
        user_id: x.ctx.userId,
        kind: audio ? "audio" : "image",
        declared_mime: audio ? "audio/mpeg" : "image/jpeg",
        verified_mime: audio ? "audio/mpeg" : "image/jpeg",
        duration_ms: audio ? 3000 : null,
        size_bytes: 1000,
        // Distinct files: D59 charges identical content once.
        sha256: `${index}`.repeat(64),
        display_name: `Synthetic immutable source ${index}`,
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
        originKey: `synthetic-language-correction:${source.id}`,
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: {
          ranges: [],
          sourceClassification: { role: audio ? "class_material" : role, confidence: "high" },
        },
        units: audio
          ? [
              { id: "t0", kind: "time", start: 0, end: 1000, status: "extracted" },
              { id: "t1", kind: "time", start: 1000, end: 2000, status: "extracted" },
              {
                id: "t2",
                kind: "time",
                start: 2000,
                end: 3000,
                status: "partial",
                reason: "synthetic_partial_audio",
              },
            ]
          : [{ id: "image-1", kind: "document", start: 1 }],
        blocks: Array.from({ length: 3 }, (_, i) => ({
          id: `b${i}`,
          kind: audio ? "transcript" : "paragraph",
          unitId: audio ? `t${i}` : "image-1",
          text: `Synthetic native English evidence ${index}:${i}.`,
          speakerRole: "unknown",
        })),
      }),
    );
  }
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 100, document: 100, regeneration: 10 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic bounded language correction integration",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-language-correction",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic bounded language correction integration" },
  );
  const provider = new TranslationProvider();
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
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
  if (!audio?.contentVersionId) throw new Error("Synthetic audio missing");
  const repair = buildKnowledgeRepairInput(
    {
      sources: snapshot.sources,
      explanationLanguage: "fa",
      teachingPreferences: { shorterExamples: false },
      missingSourceIds: [audio.sourceId],
    },
    120000,
  );
  const key = JSON.parse(repair.input).sources.find(
    (source: { kind: string }) => source.kind === "audio",
  ).evidence[0][0];
  let ordinal = 0;
  const claim = () => ({
    id: `claim-${ordinal}`,
    text: `An English educational explanation number ${ordinal++}.`,
    evidenceKey: key as string | null,
    uncertain: false,
  });
  const rawRepair = {
    schemaVersion: "1" as const,
    title: "Synthetic present perfect class",
    language: { learning: "en" as const, explanation: "fa" },
    summary: Array.from({ length: 4 }, claim),
    topics: Array.from({ length: 4 }, (_, i) => ({
      id: `topic-${i}`,
      title: "Synthetic topic",
      claims: [claim()],
    })),
    learningItems: Array.from({ length: 6 }, (_, i) => ({
      id: `item-${i}`,
      kind: "expression" as const,
      front: `English target ${i}`,
      back: "این پشت کارت به زبان فارسی است.",
      claim: claim(),
    })),
    homework: Array.from({ length: 2 }, claim),
    uncertainties: Array.from({ length: 2 }, claim),
    coverage: { complete: false, missingSourceIds: [audio.sourceId] },
  };
  if (options.invalidHomework) {
    const homework = rawRepair.homework[0];
    if (!homework) throw new Error("Synthetic homework missing");
    homework.evidenceKey = null;
  }
  const fullClaim = {
    id: "original",
    text: "An English original explanation.",
    origin: "from_class" as const,
    creation: "ai_generation" as const,
    evidence: "audio" as const,
    sourceRefs: [
      {
        sourceId: audio.sourceId,
        contentVersionId: audio.contentVersionId,
        locator: { kind: "time" as const, startMs: 0, endMs: 1000 },
      },
    ],
    speakerRole: "unknown" as const,
    uncertain: false,
  };
  const original = {
    schemaVersion: "1" as const,
    title: "Synthetic initial result",
    language: { learning: "en" as const, explanation: "فارسی" },
    summary: [fullClaim],
    topics: [],
    learningItems: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    sourceClassifications: snapshot.sources.map((source) => ({
      sourceId: source.sourceId,
      classification: {
        role: source.role === "user_notes" ? ("user_notes" as const) : ("class_material" as const),
        confidence: "high" as const,
      },
    })),
  };
  async function seed<T>(
    step: string,
    schema: z.ZodType<T>,
    output: T,
    cost = 1,
    model = settings.llmModel,
  ) {
    return providerStep(jobContext(), x.ctx, run.id, step, model, provider, schema, async () => ({
      output,
      requestId: `synthetic-history-${step}`,
      provider: provider.name,
      model,
      actualMicros: cost,
      usage: {},
    }));
  }
  async function failedSeed(step: string, code: string, cost: number | null, model: string) {
    await expect(
      providerStep(
        jobContext(),
        x.ctx,
        run.id,
        step,
        model,
        provider,
        z.strictObject({}),
        async () => {
          throw new ProviderError(code, false, false, {
            requestId: `synthetic-history-failed-${step}`,
            provider: provider.name,
            model,
            actualMicros: cost,
            usage: {},
          });
        },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
  }
  if (options.fullHistory !== false) {
    await failedSeed("stt:historical-3", "provider_timestamps_invalid", null, settings.sttModel);
    for (let i = 0; i < 26; i++)
      await seed(`stt:historical-${i}`, z.strictObject({}), {}, 1, settings.sttModel);
    await failedSeed("vision:historical-1", "provider_http_400", 0, settings.visionModel);
    for (let i = 0; i < 6; i++)
      await seed(`vision:historical-${i}`, z.strictObject({}), {}, 1, settings.visionModel);
    await failedSeed("knowledge", "provider_schema_invalid", 68060, settings.llmModel);
  }
  await seed("knowledge", generatedSchema, original, 54724);
  await seed("knowledge:repair", repair.schema, repair.schema.parse(rawRepair), 59000);
  const translation = buildKnowledgeTranslationInput(rawRepair, "fa", 120000);
  const work = () => job.run({ runId: run.id, userId: x.ctx.userId }, jobContext());
  const requeue = () =>
    db
      .updateTable("proc.processing_run")
      .set({ state: "queued" })
      .where("id", "=", run.id)
      .execute();
  return {
    x,
    run,
    snapshot,
    repair,
    rawRepair,
    translation,
    provider,
    jobContext,
    seed,
    work,
    requeue,
  };
}

async function history(runId: string) {
  const attempts = await db
    .selectFrom("proc.provider_attempt")
    .selectAll()
    .where("run_id", "=", runId)
    .where("step", "!=", "knowledge:repair-language")
    .orderBy("id")
    .execute();
  const costs = await db
    .selectFrom("quota.provider_cost")
    .selectAll()
    .where("run_id", "=", runId)
    .where(
      "attempt_id",
      "in",
      attempts.map((attempt) => attempt.id),
    )
    .orderBy("id")
    .execute();
  const holds = await db
    .selectFrom("quota.cost_hold")
    .selectAll()
    .where(
      "id",
      "in",
      attempts.map((attempt) => attempt.hold_id),
    )
    .orderBy("id")
    .execute();
  const checkpoints = await db
    .selectFrom("proc.run_step")
    .selectAll()
    .where("run_id", "=", runId)
    .where("step", "!=", "knowledge:repair-language")
    // D59 publication records what it charged; it is not a provider checkpoint.
    .where("step", "not like", "charge:%")
    .orderBy("step")
    .execute();
  return { attempts, costs, holds, checkpoints };
}

it("translates all eighteen cached English explanations once, preserving thirty-seven historic costs and six Persian backs", async () => {
  const f = await fixture();
  const before = await history(f.run.id);
  expect(before.attempts).toHaveLength(37);
  expect(before.costs).toHaveLength(37);
  expect(before.holds).toHaveLength(37);
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  const call = f.provider.structuredCalls.mock.calls[0]?.[0];
  expect(call?.schemaName).toBe("class_knowledge_translation");
  expect(call?.operationKey).toBe(`${f.run.id}:knowledge:repair-language:1`);
  const input = JSON.parse(call?.input ?? "{}");
  expect(input.format).toBe("knowledge_explanation_translation_v1");
  expect(input.targets).toHaveLength(18);
  expect(
    input.targets.every((target: { section: string }) => target.section !== "learningBack"),
  ).toBe(true);
  expect(Array.from(call?.input ?? "").length).toBeLessThan(10000);
  expect(call?.system).toContain("hard limit of 6144 output tokens");
  expect(await history(f.run.id)).toEqual(before);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "partial_ready",
    lastError: null,
  });
  const latest = await getLatestVersion(db, f.x.ctx, f.x.session.id);
  expect(latest?.runId).toBe(f.run.id);
  expect(latest?.model.language.explanation).toBe("fa");
  expect(latest?.model.summary).toHaveLength(4);
  expect(latest?.model.learningItems).toHaveLength(6);
  expect(latest?.model.learningItems.map((item) => item.front)).toEqual(
    f.rawRepair.learningItems.map((item) => item.front),
  );
  expect(latest?.model.learningItems.map((item) => item.back)).toEqual(
    f.rawRepair.learningItems.map((item) => item.back),
  );
  expect(
    latest &&
      modelClaims(latest.model).every((claim) => matchesExplanationScript(claim.text, "fa")),
  ).toBe(true);
  expect(
    latest &&
      modelClaims(latest.model).every(
        (claim) => claim.creation === "ai_generation" && claim.speakerRole === "unknown",
      ),
  ).toBe(true);
  expect(
    latest &&
      modelClaims(latest.model).every((claim) => claim.sourceRefs[0]?.locator.kind === "time"),
  ).toBe(true);
  expect(
    await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("run_id", "=", f.run.id)
      .execute(),
  ).toHaveLength(38);
  const reservation = await db
    .selectFrom("quota.reservation")
    .select(["settled_amounts", "closed_at"])
    .where("id", "=", f.run.reservationId)
    .executeTakeFirstOrThrow();
  expect(reservation.settled_amounts).toEqual({
    audio: 3,
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

it("refuses translation for a non-language canonical evidence failure", async () => {
  const f = await fixture({ invalidHomework: true, fullHistory: false });
  await f.work();
  expect(f.provider.structuredCalls).not.toHaveBeenCalled();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "output_class_evidence_missing",
  });
});

it("the language-repair proof rejects earlier native evidence failures without relabeling the language", async () => {
  const f = await fixture({ fullHistory: false });
  expect(() => f.repair.assertLanguageRepairEvidence(f.rawRepair)).not.toThrow();
  expect(() => f.repair.decode(f.rawRepair)).toThrow(AppError);
  const audio = f.snapshot.sources.find((source) => source.kind === "audio");
  const first = audio?.units.find((unit) => unit.start === 0);
  if (!first) throw new Error("Synthetic native unit missing");
  first.start = 500;
  try {
    f.repair.assertLanguageRepairEvidence(f.rawRepair);
    throw new Error("An invalid native reference was admitted");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "validation_failed",
      details: { fields: { output: ["time_reference_invalid"] } },
    });
  }
  expect(f.rawRepair.language.explanation).toBe("fa");
  expect(f.provider.structuredCalls).not.toHaveBeenCalled();
});

it.each(["missing", "duplicate", "wrong-key", "wrong-language", "latin-only"] as const)(
  "rejects %s translation and never dispatches a recursive correction",
  async (mode) => {
    const f = await fixture({ fullHistory: false });
    f.provider.response = (input) => {
      const raw = translationOutput(input);
      if (mode === "missing") raw.translations.pop();
      if (mode === "duplicate") raw.translations[1] = raw.translations[0];
      if (mode === "wrong-key") raw.translations[0].key = "invented";
      if (mode === "wrong-language") raw.language = "فارسی";
      if (mode === "latin-only") raw.translations[0].text = "Still an English explanation.";
      return raw;
    };
    const before = await history(f.run.id);
    await f.work();
    expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      outputVersionId: null,
    });
    await f.requeue();
    await f.work();
    expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
    expect(
      await db
        .selectFrom("proc.provider_attempt")
        .select("id")
        .where("run_id", "=", f.run.id)
        .where("step", "=", "knowledge:repair-language")
        .execute(),
    ).toHaveLength(1);
    expect(await history(f.run.id)).toEqual(before);
  },
);

it("blocks an unknown translation outcome and keeps its unresolved hold without fabricated cost", async () => {
  const f = await fixture({ fullHistory: false });
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
    .where("step", "=", "knowledge:repair-language")
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
  await f.requeue();
  await f.work();
  expect(f.provider.structuredCalls).toHaveBeenCalledTimes(1);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "needs_input",
    lastError: "provider_outcome_unresolved",
  });
});

it("reuses a valid cached translation without another provider call", async () => {
  const f = await fixture({ fullHistory: false });
  await f.seed(
    "knowledge:repair-language",
    f.translation.schema,
    f.translation.schema.parse(translationOutput({ input: f.translation.input })),
    11000,
  );
  const before = await history(f.run.id);
  await f.work();
  expect(f.provider.structuredCalls).not.toHaveBeenCalled();
  expect(await history(f.run.id)).toEqual(before);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "partial_ready",
    lastError: null,
  });
});
