import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { cleanupFixtureProcessingJobs, runFixtureProcessingStep } from "../../test/processing-jobs";
import { studyFixture } from "../../test/study-fixture";
import { OpenRouterProvider, ProviderError, type ProviderSettings } from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion } from "../lkm";
import { MemoryObjectStore } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion } from "../src";
import { generatedKnowledgeSchema } from "./generated-knowledge";
import { createProcessingRun, getRun } from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const runIds: string[] = [];
afterAll(async () => {
  try {
    await cleanupFixtureProcessingJobs(db, runIds);
  } finally {
    await db.destroy();
  }
});
const settings: ProviderSettings = {
  version: "synthetic-haiku55-worker",
  llmModel: "anthropic/claude-haiku-5.5",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "recalino-knowledge-7",
  maxInputCharacters: 120000,
  maxOutputTokens: 6144,
  structuredTemperature: 0,
  structuredModelOverrides: {
    "anthropic/claude-haiku-5.5": {
      maxOutputTokens: 12000,
      reasoningEffort: "low",
      structuredOutputMode: "json_object",
      omitTemperature: true,
    },
  },
  timeoutMs: 1000,
  maximumMicros: 100000,
  currency: "USD",
  priceVersion: "synthetic",
  charactersPerPage: 3000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
const sentence = "I look forward to meeting my new neighbours.";
const sourceText = `${sentence} Look forward to means anticipate with pleasure; to is a preposition followed by a noun or an -ing form. This printed demonstration is not learner writing.`;
function wire(meaning = "Anticipate a future event with pleasure") {
  return {
    lessonPlan: [{ concept: "look forward to + -ing", evidenceKeys: ["r0"], teachAs: "card" }],
    title: "Looking forward to a meeting",
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    learningItems: [
      {
        type: "lexical",
        kind: "expression",
        claim: {
          text: "Look forward to expresses pleased anticipation of a future event.",
          evidenceKeys: ["r0"],
          uncertain: false,
        },
        meaning: { en: "look forward to", faMeaning: meaning, topic: "anticipation" },
        pronunciation: { ipa: "/lʊk ˈfɔːwəd tə/" },
        practice: {
          fullSentence: sentence,
          gapSentence: "I ______ meeting my new neighbours.",
        },
        teaching: {
          collocations: ["look forward to a meeting"],
          noteFa: "To is a preposition here and takes a noun or an -ing form.",
          imageFa: "A person eagerly waiting to meet new neighbours.",
        },
      },
    ],
    classNotes: {
      coverage: "Look forward to and its prepositional pattern",
      orientation: {},
      activities: { chunks: [], board: [], tasks: [], culture: [], register: [] },
    },
  };
}
function invalidWire(kind: "zod" | "assembly") {
  const value = wire();
  if (kind === "zod") {
    return {
      ...value,
      learningItems: value.learningItems.map((item) => {
        const { gapSentence: _gap, ...practice } = item.practice;
        return { ...item, practice };
      }),
    };
  }
  const item = value.learningItems[0];
  if (!item) throw new Error("Synthetic learning item missing");
  item.claim.evidenceKeys = ["r0", "r0"];
  return value;
}
function response(output: unknown, index = 1, truncated = false, model = settings.llmModel) {
  return new Response(
    JSON.stringify({
      id: `synthetic-haiku55-${index}`,
      model,
      choices: [
        {
          finish_reason: truncated ? "length" : "stop",
          message: { content: truncated ? '{"title":' : JSON.stringify(output) },
        },
      ],
      usage: {
        cost: index === 1 ? 0.000005 : 0.000003,
        prompt_tokens: 1000,
        completion_tokens: 500,
      },
    }),
  );
}
async function fixture(request: typeof fetch, configured: ProviderSettings = settings) {
  const x = await studyFixture(db);
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: sourceText.length,
      sha256: "a".repeat(64),
      display_name: "Synthetic Haiku migration material",
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
      asset_id: asset.id,
      role: "class_material",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, x.ctx, asset.id, {
      originKey: `synthetic-haiku55:${asset.id}`,
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "document", kind: "document", start: 1 }],
      blocks: [{ id: "lesson", unitId: "document", kind: "paragraph", text: sourceText }],
    }),
  );
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ document: 100, regeneration: 2 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic Haiku migration worker verification",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-haiku55-worker",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic Haiku migration worker verification" },
  );
  const provider = new OpenRouterProvider("synthetic-key", configured, request);
  const definition = processingJob({ provider, store: new MemoryObjectStore() });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider, job: definition },
  );
  runIds.push(run.id);
  const subject = { runId: run.id, userId: x.ctx.userId };
  const work = () => runFixtureProcessingStep(db, definition, subject);
  const checkpoints = () =>
    db
      .selectFrom("proc.run_step")
      .select(["step", "output"])
      .where("run_id", "=", run.id)
      .orderBy("step")
      .execute();
  const costs = () =>
    db
      .selectFrom("quota.provider_cost")
      .select(["amount_micros", "estimated_micros"])
      .where("run_id", "=", run.id)
      .orderBy("created_at")
      .execute();
  const attempts = () =>
    db
      .selectFrom("proc.provider_attempt")
      .select(["id", "step", "state", "error_code", "provider_request_id", "hold_id"])
      .where("run_id", "=", run.id)
      .orderBy("started_at")
      .execute();
  return { x, run, provider, work, checkpoints, costs, attempts };
}

describe("FR-PROC-003 Haiku 5.5 durable knowledge migration", () => {
  it("sends direct JSON controls and stores canonical immutable knowledge before publication, never the wire DTO", async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: settings.llmModel,
        max_tokens: 12000,
        reasoning: { effort: "low" },
        response_format: { type: "json_object" },
        provider: { zdr: true, data_collection: "deny", require_parameters: true },
      });
      expect(body).not.toHaveProperty("temperature");
      const input = JSON.parse(body.messages[1].content[0].text);
      expect(input.format).toBe("knowledge_generation_keys_v5");
      expect(input.sources[0].evidence[0]).toContain(sourceText);
      expect(body.messages[0].content).toContain("Write lessonPlan FIRST");
      expect(body.messages[0].content).not.toContain(
        "top-level JSON object has only these keys: schemaVersion",
      );
      return response(wire());
    });
    const f = await fixture(request);
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
    const checkpoint = (await f.checkpoints()).find((entry) => entry.step === "knowledge");
    expect(checkpoint).toBeDefined();
    const generated = generatedKnowledgeSchema.parse(checkpoint?.output);
    expect(generated.language).toEqual({ learning: "en", explanation: "en" });
    expect(generated.classNotes).toMatchObject({
      date: f.x.session.classDate,
      board: [],
      chunks: [],
      tasks: [],
      register: [],
    });
    expect(generated.learningItems[0]?.claim).toMatchObject({
      origin: "from_class",
      creation: "ai_generation",
      speakerRole: "unknown",
    });
    expect(generated.learningItems[0]?.study).toMatchObject({
      set: "production",
      sourceFa: "From class",
    });
    expect(generated.learningItems[0]).not.toHaveProperty("type");
    expect(await f.costs()).toEqual([{ amount_micros: "5", estimated_micros: null }]);
    const before = await f.checkpoints();
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await f.checkpoints()).toEqual(before);
  });

  it("accounts two known invalid wires, preserves the first marker and never invents a missing required field", async () => {
    let responseCount = 0;
    const request = vi.fn<typeof fetch>(async () => response(invalidWire("zod"), ++responseCount));
    const f = await fixture(request);
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "processing" });
    const marker = (await f.checkpoints()).find(
      (entry) => entry.step === "knowledge:schema-invalid",
    );
    expect(marker?.output).toMatchObject({ reason: "provider_schema_invalid" });
    expect(await f.costs()).toEqual([{ amount_micros: "5", estimated_micros: null }]);
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      lastError: "provider_schema_invalid",
      outputVersionId: null,
    });
    expect((await f.checkpoints()).filter((entry) => entry.step.startsWith("knowledge"))).toEqual([
      marker,
    ]);
    expect(await f.costs()).toEqual([
      { amount_micros: "5", estimated_micros: null },
      { amount_micros: "3", estimated_micros: null },
    ]);
    expect((await f.attempts()).map((entry) => entry.step).sort()).toEqual([
      "knowledge",
      "knowledge:repair",
    ]);
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("settles a structurally valid paid wire whose immutable evidence assembly fails, rather than marking an unknown outcome", async () => {
    let responseCount = 0;
    const request = vi.fn<typeof fetch>(async () =>
      response(invalidWire("assembly"), ++responseCount),
    );
    const f = await fixture(request);
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "processing",
    });
    const attempt = await db
      .selectFrom("proc.provider_attempt")
      .select(["id", "state", "error_code", "provider_request_id", "hold_id"])
      .where("run_id", "=", f.run.id)
      .executeTakeFirstOrThrow();
    expect(attempt).toMatchObject({
      state: "failed",
      error_code: "provider_schema_invalid",
      provider_request_id: "synthetic-haiku55-1",
    });
    expect(
      (
        await db
          .selectFrom("quota.cost_hold")
          .select("closed_at")
          .where("id", "=", attempt.hold_id)
          .executeTakeFirstOrThrow()
      ).closed_at,
    ).toBeInstanceOf(Date);
    expect(await f.costs()).toEqual([{ amount_micros: "5", estimated_micros: null }]);
    const marker = (await f.checkpoints()).find(
      (entry) => entry.step === "knowledge:schema-invalid",
    );
    // Only the code-owned assembly code is kept, never the rejected response text.
    expect(marker?.output).toEqual({
      reason: "provider_schema_invalid",
      attemptId: attempt.id,
      detail: "assembly:source_reference_invalid",
    });
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      lastError: "provider_schema_invalid",
      outputVersionId: null,
    });
    expect((await f.checkpoints()).filter((entry) => entry.step.startsWith("knowledge"))).toEqual([
      marker,
    ]);
    expect(await f.costs()).toEqual([
      { amount_micros: "5", estimated_micros: null },
      { amount_micros: "3", estimated_micros: null },
    ]);
    for (const paidAttempt of await f.attempts()) {
      expect(paidAttempt.state).toBe("failed");
      expect(
        (
          await db
            .selectFrom("quota.cost_hold")
            .select("closed_at")
            .where("id", "=", paidAttempt.hold_id)
            .executeTakeFirstOrThrow()
        ).closed_at,
      ).toBeInstanceOf(Date);
    }
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(["zod", "assembly"] as const)(
    "recovers a known paid %s failure once with unchanged source input and durable canonical checkpoints",
    async (invalidKind) => {
      const inputs: unknown[] = [];
      const keys: (string | null)[] = [];
      const request = vi.fn<typeof fetch>(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        inputs.push(body.messages[1]);
        keys.push(new Headers(init?.headers).get("Idempotency-Key"));
        if (inputs.length > 2) throw new Error("A third paid request must never be dispatched");
        if (inputs.length === 2) {
          expect(body.messages[0].content).toContain(
            "server rejected the previous response (provider_schema_invalid)",
          );
          expect(body.messages[0].content).toContain(
            invalidKind === "zod"
              ? "Schema check failed at learningItems.0.practice.gapSentence"
              : "A claim cited an invalid or duplicate evidence key",
          );
          expect(body.messages[0].content).not.toContain('"r0","r0"');
        }
        return response(inputs.length === 1 ? invalidWire(invalidKind) : wire(), inputs.length);
      });
      const f = await fixture(request);
      await f.work();
      expect(request).toHaveBeenCalledTimes(1);
      expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "processing" });
      const marker = (await f.checkpoints()).find(
        (entry) => entry.step === "knowledge:schema-invalid",
      );
      const firstAttempt = (await f.attempts())[0];
      if (!firstAttempt) throw new Error("Missing first accounted attempt");
      expect(marker?.output).toEqual({
        reason: "provider_schema_invalid",
        attemptId: firstAttempt.id,
        detail:
          invalidKind === "zod"
            ? "zod:invalid_type@learningItems.0.practice.gapSentence"
            : "assembly:source_reference_invalid",
      });
      expect(firstAttempt).toMatchObject({
        step: "knowledge",
        state: "failed",
        error_code: "provider_schema_invalid",
        provider_request_id: "synthetic-haiku55-1",
      });
      expect((await f.checkpoints()).some((entry) => entry.step === "knowledge")).toBe(false);
      await f.work();
      expect(inputs[1]).toEqual(inputs[0]);
      expect(keys).toEqual([`${f.run.id}:knowledge:1`, `${f.run.id}:knowledge:repair:1`]);
      expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
        state: "ready",
        lastError: null,
      });
      const checkpoints = await f.checkpoints();
      expect(checkpoints.find((entry) => entry.step === "knowledge:schema-invalid")).toEqual(
        marker,
      );
      const canonical = checkpoints.find((entry) => entry.step === "knowledge");
      const repaired = checkpoints.find((entry) => entry.step === "knowledge:repair");
      expect(canonical?.output).toEqual(repaired?.output);
      const generated = generatedKnowledgeSchema.parse(canonical?.output);
      expect(generated.learningItems[0]?.study).toMatchObject({
        set: "production",
        faMeaning: "Anticipate a future event with pleasure",
      });
      expect(generated.learningItems[0]).not.toHaveProperty("identity");
      expect(checkpoints.some((entry) => entry.step === "knowledge:input-context")).toBe(true);
      expect(await f.costs()).toEqual([
        { amount_micros: "5", estimated_micros: null },
        { amount_micros: "3", estimated_micros: null },
      ]);
      for (const paidAttempt of await f.attempts())
        expect(
          (
            await db
              .selectFrom("quota.cost_hold")
              .select("closed_at")
              .where("id", "=", paidAttempt.hold_id)
              .executeTakeFirstOrThrow()
          ).closed_at,
        ).toBeInstanceOf(Date);
      expect(await f.work()).toBe(false);
      expect(request).toHaveBeenCalledTimes(2);
      expect(await f.checkpoints()).toEqual(checkpoints);
      expect(
        (await getLatestVersion(db, f.x.ctx, f.x.session.id))?.model.learningItems[0]?.study,
      ).toMatchObject({
        faMeaning: "Anticipate a future event with pleasure",
      });
    },
  );

  it.each(["schema", "truncated", "semantic"] as const)(
    "ends a schema-failed first attempt after a %s recovery without buying a third generation",
    async (failure) => {
      let responseCount = 0;
      const request = vi.fn<typeof fetch>(async () => {
        responseCount++;
        if (responseCount > 2) throw new Error("A third paid request must never be dispatched");
        if (responseCount === 1) return response(invalidWire("zod"), 1);
        if (failure === "truncated") return response(null, 2, true);
        return response(
          failure === "schema" ? invalidWire("zod") : wire("look forward to means anticipate"),
          2,
        );
      });
      const f = await fixture(request);
      await f.work();
      expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "processing" });
      await f.work();
      const run = await getRun(db, f.x.ctx, f.run.id);
      expect(run).toMatchObject({ state: "failed", outputVersionId: null });
      if (failure !== "semantic")
        expect(run.lastError).toBe(
          failure === "schema" ? "provider_schema_invalid" : "provider_output_truncated",
        );
      const checkpoints = await f.checkpoints();
      expect(checkpoints.some((entry) => entry.step === "knowledge:schema-invalid")).toBe(true);
      expect(
        checkpoints.some((entry) =>
          ["knowledge:compact", "knowledge:study-repair"].includes(entry.step),
        ),
      ).toBe(false);
      expect((await f.attempts()).map((entry) => entry.step).sort()).toEqual([
        "knowledge",
        "knowledge:repair",
      ]);
      expect(await f.costs()).toEqual([
        { amount_micros: "5", estimated_micros: null },
        { amount_micros: "3", estimated_micros: null },
      ]);
      for (const paidAttempt of await f.attempts())
        expect(
          (
            await db
              .selectFrom("quota.cost_hold")
              .select("closed_at")
              .where("id", "=", paidAttempt.hold_id)
              .executeTakeFirstOrThrow()
          ).closed_at,
        ).toBeInstanceOf(Date);
      expect((await getLatestVersion(db, f.x.ctx, f.x.session.id))?.id).toBe(f.x.knowledge.id);
      expect(await f.work()).toBe(false);
      expect(request).toHaveBeenCalledTimes(2);
      expect(await f.checkpoints()).toEqual(checkpoints);
    },
  );

  it("never retries an accounting-less schema error or saves a paid-response marker", async () => {
    const request = vi.fn<typeof fetch>();
    const f = await fixture(request);
    const structured = vi
      .spyOn(f.provider, "structured")
      .mockRejectedValue(new ProviderError("provider_schema_invalid", false, false));
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      lastError: "provider_schema_invalid",
    });
    expect((await f.checkpoints()).some((entry) => entry.step.startsWith("knowledge"))).toBe(false);
    expect(await f.costs()).toEqual([{ amount_micros: "0", estimated_micros: null }]);
    expect(await f.work()).toBe(false);
    expect(structured).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it("retains terminal legacy Haiku 4.5 schema failure behavior without a recovery marker", async () => {
    const request = vi.fn<typeof fetch>();
    const model = "anthropic/claude-haiku-4.5";
    const f = await fixture(request, { ...settings, llmModel: model });
    const structured = vi.spyOn(f.provider, "structured").mockRejectedValue(
      new ProviderError("provider_schema_invalid", false, false, {
        requestId: "synthetic-legacy-invalid",
        provider: "openrouter",
        model,
        usage: { inputTokens: 1000, outputTokens: 500 },
        actualMicros: 5,
      }),
    );
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      lastError: "provider_schema_invalid",
    });
    expect((await f.checkpoints()).some((entry) => entry.step.startsWith("knowledge"))).toBe(false);
    expect(await f.costs()).toEqual([{ amount_micros: "5", estimated_micros: null }]);
    expect(await f.work()).toBe(false);
    expect(structured).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps an unknown schema recovery attempt uncertain and closes its hold at the maximum, without replay", async () => {
    let responseCount = 0;
    const request = vi.fn<typeof fetch>(async () => {
      if (++responseCount === 1) return response(invalidWire("zod"), 1);
      throw new Error("Synthetic unknown recovery outcome");
    });
    const f = await fixture(request);
    await f.work();
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "needs_input",
      lastError: "provider_outcome_unknown",
    });
    const attempts = await f.attempts();
    expect(attempts).toHaveLength(2);
    let repairMaximum: string | undefined;
    for (const attempt of attempts) {
      const hold = await db
        .selectFrom("quota.cost_hold")
        .select(["closed_at", "maximum_micros"])
        .where("id", "=", attempt.hold_id)
        .executeTakeFirstOrThrow();
      if (attempt.step === "knowledge") {
        expect(attempt.state).toBe("failed");
        expect(hold.closed_at).toBeInstanceOf(Date);
      } else {
        expect(attempt).toMatchObject({ step: "knowledge:repair", state: "uncertain" });
        // P9-05 (C9-2): the unknown outcome's hold is closed at its own maximum.
        expect(hold.closed_at).toBeInstanceOf(Date);
        repairMaximum = hold.maximum_micros;
      }
    }
    expect(await f.costs()).toEqual([
      { amount_micros: "5", estimated_micros: null },
      { amount_micros: null, estimated_micros: repairMaximum },
    ]);
    expect(
      (await f.checkpoints()).filter((entry) => entry.step.startsWith("knowledge")),
    ).toHaveLength(1);
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retains uncertainty and closes a paid hold whose outcome is unknown at its maximum, never repeating it or releasing it at zero", async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error("Synthetic unknown transport outcome");
    });
    const f = await fixture(request);
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "needs_input",
      lastError: "provider_outcome_unknown",
    });
    const attempt = await db
      .selectFrom("proc.provider_attempt")
      .select(["state", "hold_id"])
      .where("run_id", "=", f.run.id)
      .executeTakeFirstOrThrow();
    expect(attempt.state).toBe("uncertain");
    // P9-05 (C9-2): the hold is closed once, at its own maximum, never released at zero.
    const hold = await db
      .selectFrom("quota.cost_hold")
      .select(["closed_at", "maximum_micros"])
      .where("id", "=", attempt.hold_id)
      .executeTakeFirstOrThrow();
    expect(hold.closed_at).toBeInstanceOf(Date);
    expect(await f.costs()).toEqual([
      { amount_micros: null, estimated_micros: hold.maximum_micros },
    ]);
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("checkpoints an accounted truncation then performs one compact recovery with the same evidence and normal billing", async () => {
    const inputs: unknown[] = [];
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      inputs.push(body.messages[1]);
      return inputs.length === 1 ? response(null, 1, true) : response(wire(), 2);
    });
    const f = await fixture(request);
    await f.work();
    expect(request).toHaveBeenCalledTimes(1);
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "processing" });
    expect((await f.checkpoints()).some((entry) => entry.step === "knowledge:truncated")).toBe(
      true,
    );
    await f.work();
    expect(request).toHaveBeenCalledTimes(2);
    expect(inputs[1]).toEqual(inputs[0]);
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
    expect(
      (await f.checkpoints()).filter((entry) =>
        ["knowledge", "knowledge:compact"].includes(entry.step),
      ),
    ).toHaveLength(2);
    expect((await f.costs()).map((entry) => Number(entry.amount_micros))).toEqual([5, 3]);
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("ends a truncated 5.5 run after an invalid compact response, never paying for a third repair or publishing it", async () => {
    let responseCount = 0;
    const request = vi.fn<typeof fetch>(async () => {
      responseCount += 1;
      if (responseCount > 2) throw new Error("A third paid request must never be dispatched");
      return responseCount === 1
        ? response(null, 1, true)
        : response(wire("look forward to means anticipate"), 2);
    });
    const f = await fixture(request);
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "processing" });
    await f.work();
    expect(request).toHaveBeenCalledTimes(2);
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      outputVersionId: null,
    });
    const checkpoints = await f.checkpoints();
    expect(checkpoints.some((entry) => entry.step === "knowledge:truncated")).toBe(true);
    expect(checkpoints.some((entry) => entry.step === "knowledge:compact")).toBe(true);
    expect(
      checkpoints.some((entry) =>
        ["knowledge:repair", "knowledge:study-repair"].includes(entry.step),
      ),
    ).toBe(false);
    const attempts = await db
      .selectFrom("proc.provider_attempt")
      .select(["step", "hold_id"])
      .where("run_id", "=", f.run.id)
      .execute();
    expect(attempts.map((entry) => entry.step).sort()).toEqual(["knowledge", "knowledge:compact"]);
    for (const attempt of attempts)
      expect(
        (
          await db
            .selectFrom("quota.cost_hold")
            .select("closed_at")
            .where("id", "=", attempt.hold_id)
            .executeTakeFirstOrThrow()
        ).closed_at,
      ).toBeInstanceOf(Date);
    expect((await f.costs()).map((entry) => Number(entry.amount_micros))).toEqual([5, 3]);
    expect((await getLatestVersion(db, f.x.ctx, f.x.session.id))?.id).toBe(f.x.knowledge.id);
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("preserves a semantically invalid paid checkpoint and repairs its hidden answer once under a new checkpoint", async () => {
    let responseCount = 0;
    const request = vi.fn<typeof fetch>(async () => {
      responseCount += 1;
      return response(
        responseCount === 1 ? wire("look forward to means anticipate") : wire(),
        responseCount,
      );
    });
    const f = await fixture(request);
    await f.work();
    expect(request).toHaveBeenCalledTimes(1);
    const original = (await f.checkpoints()).find((entry) => entry.step === "knowledge");
    expect(original).toBeDefined();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "processing" });
    await f.work();
    expect(request).toHaveBeenCalledTimes(2);
    expect((await f.checkpoints()).find((entry) => entry.step === "knowledge")).toEqual(original);
    expect((await f.checkpoints()).some((entry) => entry.step === "knowledge:repair")).toBe(true);
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
    const latest = await getLatestVersion(db, f.x.ctx, f.x.session.id);
    expect(latest?.model.learningItems[0]?.study).toMatchObject({
      faMeaning: "Anticipate a future event with pleasure",
    });
    expect((await f.costs()).map((entry) => Number(entry.amount_micros))).toEqual([5, 3]);
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("never buys a third 5.5 generation when a paid knowledge commit failed and the job retried", async () => {
    let responseCount = 0;
    const request = vi.fn<typeof fetch>(async () => {
      responseCount += 1;
      if (responseCount > 2) throw new Error("A third paid request must never be dispatched");
      return response(wire("look forward to means anticipate"), responseCount);
    });
    const f = await fixture(request);
    await f.work();
    expect(request).toHaveBeenCalledTimes(1);
    // Reproduce a paid response whose success transaction failed: the attempt and its cost are
    // recorded, but the canonical checkpoint is absent, so a retried job sees no knowledge.
    const [first] = await f.attempts();
    if (!first) throw new Error("Missing paid attempt");
    await db
      .updateTable("proc.provider_attempt")
      .set({ state: "failed", error_code: "provider_output_commit_failed" })
      .where("id", "=", first.id)
      .execute();
    await db
      .deleteFrom("proc.run_step")
      .where("run_id", "=", f.run.id)
      .where("step", "in", ["knowledge", "knowledge:input-context"])
      .execute();
    await f.work();
    expect(request).toHaveBeenCalledTimes(2);
    await f.work();
    expect(request).toHaveBeenCalledTimes(2);
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      lastError: "knowledge_repair_exhausted",
      outputVersionId: null,
    });
    expect((await f.attempts()).map((entry) => entry.step)).toEqual(["knowledge", "knowledge"]);
    expect((await f.costs()).map((entry) => Number(entry.amount_micros))).toEqual([5, 3]);
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

const geminiModel = "google/gemini-3.8-flash";
const geminiControls = {
  maxOutputTokens: 32000,
  reasoningEffort: "medium",
  structuredOutputMode: "json_object",
  omitTemperature: true,
} as const;
const geminiSettings: ProviderSettings = {
  ...settings,
  version: "synthetic-gemini-worker",
  llmModel: geminiModel,
  structuredModelOverrides: {
    [geminiModel]: { ...geminiControls, knowledgeContract: "content" },
  },
};

describe("FR-PROC-003 settings-selected content knowledge contract", () => {
  it("generates content-contract knowledge for a configured non-Haiku model with its own controls", async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: geminiModel,
        max_tokens: 32000,
        reasoning: { effort: "medium" },
        response_format: { type: "json_object" },
        provider: { zdr: true, data_collection: "deny", require_parameters: true },
      });
      expect(body).not.toHaveProperty("temperature");
      const input = JSON.parse(body.messages[1].content[0].text);
      expect(input.format).toBe("knowledge_generation_keys_v5");
      return response(wire(), 1, false, geminiModel);
    });
    const f = await fixture(request, geminiSettings);
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
    const checkpoint = (await f.checkpoints()).find((entry) => entry.step === "knowledge");
    const generated = generatedKnowledgeSchema.parse(checkpoint?.output);
    expect(generated.learningItems[0]?.claim).toMatchObject({ origin: "from_class" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("applies the schema-invalid marker and two-generation cap to a configured non-Haiku model", async () => {
    let responseCount = 0;
    const request = vi.fn<typeof fetch>(async () =>
      response(invalidWire("zod"), ++responseCount, false, geminiModel),
    );
    const f = await fixture(request, geminiSettings);
    await f.work();
    const marker = (await f.checkpoints()).find(
      (entry) => entry.step === "knowledge:schema-invalid",
    );
    expect(marker?.output).toMatchObject({ reason: "provider_schema_invalid" });
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      lastError: "provider_schema_invalid",
      outputVersionId: null,
    });
    expect((await f.attempts()).map((entry) => entry.step).sort()).toEqual([
      "knowledge",
      "knowledge:repair",
    ]);
    expect(await f.work()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps the legacy contract for the same model when the override does not select content", async () => {
    const request = vi.fn<typeof fetch>();
    const f = await fixture(request, {
      ...geminiSettings,
      structuredModelOverrides: { [geminiModel]: geminiControls },
    });
    const structured = vi.spyOn(f.provider, "structured").mockRejectedValue(
      new ProviderError("provider_schema_invalid", false, false, {
        requestId: "synthetic-gemini-legacy-invalid",
        provider: "openrouter",
        model: geminiModel,
        usage: { inputTokens: 1000, outputTokens: 500 },
        actualMicros: 5,
      }),
    );
    await f.work();
    expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
      state: "failed",
      lastError: "provider_schema_invalid",
    });
    expect((await f.checkpoints()).some((entry) => entry.step.startsWith("knowledge"))).toBe(false);
    expect(structured).toHaveBeenCalledOnce();
    expect(structured.mock.calls[0]?.[0]).toMatchObject({ schemaName: "class_knowledge" });
    expect(request).not.toHaveBeenCalled();
  });
});
