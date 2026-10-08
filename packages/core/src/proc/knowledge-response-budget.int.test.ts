import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { saveTeachingPreference } from "../acc";
import { OpenRouterProvider, type ProviderSettings } from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion } from "../lkm";
import { MemoryObjectStore } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion } from "../src";
import { createProcessingRun, getRun } from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "synthetic-response-budget",
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

async function fixture(request: typeof fetch, sourceCount = 1, outputTokens = 6144) {
  const x = await studyFixture(db);
  await saveTeachingPreference(db, x.ctx, {
    key: "shorter_examples",
    origin: "explicit",
    value: true,
  });
  const texts: string[] = [];
  for (let index = 0; index < sourceCount; index++) {
    const text = `${"The present perfect connects a past action with the present. ".repeat(150)}Final source marker ${index}.`;
    texts.push(text);
    const source = await db
      .insertInto("src.asset")
      .values({
        user_id: x.ctx.userId,
        kind: "text",
        declared_mime: "text/plain",
        verified_mime: "text/plain",
        size_bytes: text.length,
        sha256: "a".repeat(64),
        display_name: `Synthetic long-class source ${index}`,
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
        originKey: `synthetic-budget:${source.id}`,
        schemaVersion: "1",
        provenance: "machine_extraction",
        settings: {},
        units: [{ id: "document", kind: "document", start: 1 }],
        blocks: [{ id: "text", kind: "paragraph", unitId: "document", text }],
      }),
    );
  }
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ document: 100, regeneration: 1 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic knowledge response budget integration",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-response-budget",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic knowledge response budget integration" },
  );
  const provider = new OpenRouterProvider(
    "synthetic-private-key",
    { ...settings, maxOutputTokens: outputTokens },
    request,
  );
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider, job },
  );
  const work = () =>
    job.run(
      { runId: run.id, userId: x.ctx.userId },
      {
        db,
        now: () => new Date(),
        job: { id: randomUUID(), attempt: 1 },
        step: async () => "ran" as const,
      },
    );
  return { x, run, work, texts };
}

function completeResponse(body: ReturnType<typeof JSON.parse>) {
  const input = JSON.parse(body.messages[1].content[0].text);
  const source = input.sources[0];
  const claim = (id: string, text: string) => ({
    id,
    text,
    origin: "from_class",
    creation: "ai_generation",
    evidence: "material",
    sourceRefs: [source.allowedSourceRefs[0]],
    speakerRole: "unknown",
    uncertain: false,
  });
  return new Response(
    JSON.stringify({
      id: "synthetic-budget-complete",
      model: settings.llmModel,
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              schemaVersion: "1",
              title: "Present perfect and present relevance",
              language: { learning: "en", explanation: "en" },
              summary: [
                claim("s1", "The present perfect connects a past action with the present."),
              ],
              topics: [
                {
                  id: "t1",
                  title: "Present relevance",
                  claims: [claim("c1", "A past action can matter now.")],
                },
              ],
              learningItems: [
                {
                  id: "i1",
                  kind: "grammar",
                  front: "When do we use the present perfect?",
                  back: "For a past action connected with the present.",
                  claim: claim("c2", "The present perfect connects past and present."),
                  study: {
                    set: "production",
                    en: "present perfect",
                    kind: "grammar",
                    ipa: "/ˌprezənt ˈpɜːfɪkt/",
                    faMeaning: "A past action connected with the present",
                    topic: "grammar",
                    taskFa: "Rewrite the first clause using the tense from class.",
                    prompt: "I lost my keys, so I cannot get in.",
                    fullSentence: "I have lost my keys, so I cannot get in.",
                    collocations: [],
                    noteFa: "Use have or has with the past participle.",
                    imageFa: "A missing key beside a locked door.",
                    sourceFa: "Class grammar explanation; the practice example is generated.",
                  },
                },
              ],
              homework: [],
              uncertainties: [],
              classNotes: {
                date: input.lessonContext.date,
                course: input.lessonContext.course,
                coverage: "Present perfect and present relevance",
                chunks: [],
                board: [],
                tasks: [],
                register: [],
                gapfill: [],
                sourceNote:
                  "These are selected study points; further lesson details are not included.",
              },
              coverage: { complete: true, missingSourceIds: [] },
              sourceClassifications: input.sources.map((selected: { sourceId: string }) => ({
                sourceId: selected.sourceId,
                classification: { role: "class_material", confidence: "high" },
              })),
            }),
          },
        },
      ],
      usage: { cost: 0.000037, prompt_tokens: 20000, completion_tokens: 700 },
    }),
  );
}

it("publishes representative notes from all seven complete long-class sources inside the configured output budget", async () => {
  const seen: ReturnType<typeof JSON.parse>[] = [];
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    seen.push(body);
    expect(body.max_tokens).toBe(6144);
    expect(body.messages[0].content).toContain("hard limit of 6144 output tokens");
    expect(body.messages[0].content).toContain("Aim below 4608");
    expect(body.messages[0].content).toContain("populate classNotes and each learningItem.study");
    expect(body.messages[0].content).toContain("one shared source");
    expect(body.messages[0].content).toContain("The learner explicitly prefers shorter examples");
    expect(body.messages[0].content).toContain("keep fewer complete items");
    expect(body.messages[0].content).toContain("Never silently claim exhaustive coverage");
    return completeResponse(body);
  });
  const f = await fixture(request, 7);
  await f.work();
  expect(request).toHaveBeenCalledTimes(1);
  const input = JSON.parse(seen[0].messages[1].content[0].text);
  expect(input.sources).toHaveLength(7);
  expect(
    input.sources.map((source: { blocks: { text: string }[] }) => source.blocks[0]?.text),
  ).toEqual(f.texts);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
  const latest = await getLatestVersion(db, f.x.ctx, f.x.session.id);
  expect(latest?.runId).toBe(f.run.id);
  expect(latest?.model.coverage).toEqual({ complete: true, missingSourceIds: [] });
  expect(latest?.model.topics[0]?.claims[0]?.sourceRefs[0]?.sourceId).toBe(
    input.sources[0].sourceId,
  );
  expect(latest?.model.learningItems[0]?.front).toBe("present perfect");
  expect(latest?.model.learningItems[0]?.study?.set).toBe("production");
  expect(latest?.model.learningItems[0]?.study?.faApprox).toBeUndefined();
  expect(latest?.model.classNotes?.date).toBe(f.x.session.classDate);
  expect(latest?.model.classNotes?.sourceNote).toContain("selected study points");
});

it("scales the instruction down while preserving a smaller configured hard limit and the full output schema", async () => {
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.max_tokens).toBe(2048);
    expect(body.messages[0].content).toContain("hard limit of 2048 output tokens");
    expect(body.messages[0].content).toContain("Aim below 1536");
    expect(body.messages[0].content).toContain("finish the entire valid JSON object");
    expect(body.messages[0].content).toContain(
      "Budget for complete production fields and evidence",
    );
    expect(body.messages[0].content).toContain("keep fewer complete items");
    return completeResponse(body);
  });
  const f = await fixture(request, 1, 2048);
  await f.work();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
});

it("settles each truncated request exactly once while checkpointing one bounded compact recovery", async () => {
  const seen: ReturnType<typeof JSON.parse>[] = [];
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    seen.push(body);
    return new Response(
      JSON.stringify({
        id: `synthetic-budget-truncated-${seen.length}`,
        model: settings.llmModel,
        choices: [{ finish_reason: "length", message: { content: '{"schemaVersion":"1",' } }],
        usage: { cost: 0.06806, prompt_tokens: 37340, completion_tokens: 6144 },
      }),
    );
  });
  const f = await fixture(request);
  await f.work();
  expect(request).toHaveBeenCalledTimes(1);
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "processing",
    lastError: null,
  });
  const attempt = await db
    .selectFrom("proc.provider_attempt")
    .select(["id", "hold_id", "state", "error_code", "provider_request_id"])
    .where("run_id", "=", f.run.id)
    .where("step", "=", "knowledge")
    .executeTakeFirstOrThrow();
  expect(attempt).toMatchObject({
    state: "failed",
    error_code: "provider_output_truncated",
    provider_request_id: "synthetic-budget-truncated-1",
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
  const cost = await db
    .selectFrom("quota.provider_cost")
    .select(["amount_micros", "estimated_micros", "usage"])
    .where("run_id", "=", f.run.id)
    .executeTakeFirstOrThrow();
  expect(Number(cost.amount_micros)).toBe(68060);
  expect(cost.estimated_micros).toBeNull();
  expect(cost.usage).toEqual({ inputTokens: 37340, outputTokens: 6144 });
  expect(
    (
      await db
        .selectFrom("proc.run_step")
        .select("output")
        .where("run_id", "=", f.run.id)
        .where("step", "=", "knowledge:truncated")
        .executeTakeFirstOrThrow()
    ).output,
  ).toEqual({
    reason: "provider_output_truncated",
    attemptId: attempt.id,
  });
  expect(
    await db
      .selectFrom("proc.run_step")
      .select("step")
      .where("run_id", "=", f.run.id)
      .where("step", "in", ["knowledge", "knowledge:compact", "knowledge:input-context"])
      .execute(),
  ).toEqual([]);
  expect(
    (
      await db
        .selectFrom("quota.reservation")
        .select("closed_at")
        .where("id", "=", f.run.reservationId)
        .executeTakeFirstOrThrow()
    ).closed_at,
  ).toBeNull();

  await f.work();
  expect(request).toHaveBeenCalledTimes(2);
  expect(seen[1].max_tokens).toBe(6144);
  expect(seen[1].messages[1]).toEqual(seen[0].messages[1]);
  expect(seen[1].messages[0].content).toContain("hard limit of 2048 output tokens");
  expect(seen[1].messages[0].content).toContain("at most ONE complete learning item");
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "failed",
    lastError: "provider_output_truncated",
    outputVersionId: null,
  });
  const attempts = await db
    .selectFrom("proc.provider_attempt")
    .select(["step", "state", "error_code", "provider_request_id"])
    .where("run_id", "=", f.run.id)
    .orderBy("step")
    .execute();
  expect(attempts).toEqual([
    {
      step: "knowledge",
      state: "failed",
      error_code: "provider_output_truncated",
      provider_request_id: "synthetic-budget-truncated-1",
    },
    {
      step: "knowledge:compact",
      state: "failed",
      error_code: "provider_output_truncated",
      provider_request_id: "synthetic-budget-truncated-2",
    },
  ]);
  const costs = await db
    .selectFrom("quota.provider_cost")
    .select(["amount_micros", "estimated_micros", "usage"])
    .where("run_id", "=", f.run.id)
    .execute();
  expect(costs).toHaveLength(2);
  expect(costs.map((row) => Number(row.amount_micros))).toEqual([68060, 68060]);
  expect(costs.every((row) => row.estimated_micros === null)).toBe(true);
  expect(costs.map((row) => row.usage)).toEqual([
    { inputTokens: 37340, outputTokens: 6144 },
    { inputTokens: 37340, outputTokens: 6144 },
  ]);
  const reservation = await db
    .selectFrom("quota.reservation")
    .select(["settled_amounts", "closed_at"])
    .where("id", "=", f.run.reservationId)
    .executeTakeFirstOrThrow();
  expect(reservation.settled_amounts).toEqual({
    audio: 0,
    document: 0,
    regeneration: 0,
    tts: 0,
    storage: 0,
  });
  expect(reservation.closed_at).toBeInstanceOf(Date);
  await f.work();
  expect(request).toHaveBeenCalledTimes(2);
  expect(
    await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("run_id", "=", f.run.id)
      .execute(),
  ).toHaveLength(2);
});
it("leaves an unknown network outcome without an invented request ID or settled provider cost", async () => {
  const request = vi.fn<typeof fetch>(async () => {
    throw new Error("Synthetic interrupted provider connection");
  });
  const f = await fixture(request);
  await f.work();
  expect(await getRun(db, f.x.ctx, f.run.id)).toMatchObject({
    state: "needs_input",
    lastError: "provider_outcome_unknown",
  });
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select(["state", "provider_request_id"])
      .where("run_id", "=", f.run.id)
      .executeTakeFirst(),
  ).toEqual({ state: "uncertain", provider_request_id: null });
  expect(
    await db
      .selectFrom("quota.provider_cost")
      .select("id")
      .where("run_id", "=", f.run.id)
      .execute(),
  ).toEqual([]);
});

it("preserves an already recorded request ID when a later error has no accounting metadata", async () => {
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    const operationKey = new Headers(init?.headers).get("Idempotency-Key");
    expect(operationKey).toBeTruthy();
    await db
      .updateTable("proc.provider_attempt")
      .set({ provider_request_id: "synthetic-already-recorded-request" })
      .where("operation_key", "=", operationKey ?? "")
      .execute();
    throw new Error("Synthetic interrupted provider connection after identifier was recorded");
  });
  const f = await fixture(request);
  await f.work();
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select(["state", "provider_request_id"])
      .where("run_id", "=", f.run.id)
      .executeTakeFirst(),
  ).toEqual({ state: "uncertain", provider_request_id: "synthetic-already-recorded-request" });
});
