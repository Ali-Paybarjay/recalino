import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { cleanupFixtureProcessingJobs, runFixtureProcessingJobs } from "../../test/processing-jobs";
import { studyFixture } from "../../test/study-fixture";
import type {
  AiProvider,
  ProviderResult,
  ProviderSettings,
  StructuredInput,
  Transcript,
} from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion, type LearningItem } from "../lkm";
import { type JobContext, MemoryObjectStore } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion } from "../src";
import { sourceSnapshotSchema } from "./contracts";
import { cancelRun, createProcessingRun, getRun, retryRun } from "./runs";
import { generatedKnowledgeSchema, processingJob, providerStep } from "./worker";

// D110 (2026-10-20 incident): one content-contract response with several independent bad
// study cards publishes without a paid repair. Synthetic class only; no real class content.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const runIds: string[] = [];
afterAll(async () => {
  try {
    await cleanupFixtureProcessingJobs(db, runIds);
  } finally {
    await db.destroy();
  }
});

const llm = "synthetic/guard-llm";
const settings: ProviderSettings = {
  version: "fixture-study-output-guard",
  llmModel: llm,
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "recalino-knowledge-11",
  structuredModelOverrides: { [llm]: { knowledgeContract: "content", maxOutputTokens: 32000 } },
  lessonQuality: {
    version: "lesson-quality-1",
    budget: "lesson-budget-1",
    sourceCoverage: true,
    structuredBoard: true,
  },
  maxInputCharacters: 400000,
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
const words =
  "anchor beacon candle dagger ember falcon garnet harbor island jigsaw kettle lantern meadow nectar orchard pebble".split(
    " ",
  );
/** Wire cards: [en, fullSentence, gapSentence]; the incident's shapes in synthetic sentences. */
const fillers = words.map((word) => [
  word,
  `We see the ${word} today.`,
  "We see the ______ today.",
]);
const run2Cards = [
  ...fillers,
  ["conceal", "Some people conceal their names online.", "Some people conceal their names online."],
  [
    "a cloak of anonymity",
    "Some users hide behind a cloak of anonymity, making abuse easier.",
    "Some users hide behind ______ , making abuse easier.",
  ],
  [
    "no face, no case",
    "They said no face, no case, and laughed.",
    "They said ______, and laughed.",
  ],
  // Fails the content-contract assembly: part of the target stays visible.
  ["look forward to", "I look forward to meeting you.", "I look ______ to meeting you."],
];

/** Answers the content-contract lesson with the run-2 shape; never a paid service. */
class GuardProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  readonly settings = { ...settings };
  structuredCalls: string[] = [];
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    this.structuredCalls.push(input.schemaName);
    if (input.schemaName !== "class_knowledge_content")
      throw new Error("Card-level problems within the allowance must never buy a repair");
    const data = JSON.parse(input.input) as {
      sources: { evidence: [string | null, ...unknown[]][] }[];
    };
    const key =
      data.sources.flatMap((source) => source.evidence.map(([entry]) => entry)).find(Boolean) ??
      "r0";
    const output = {
      lessonPlan: [{ concept: "synthetic words", evidenceKeys: [key], teachAs: "card" }],
      title: "Synthetic guarded lesson",
      learningItems: run2Cards.map(([en, fullSentence, gapSentence]) => ({
        type: "lexical",
        kind: "expression",
        claim: { text: `The class teaches ${en}.`, evidenceKeys: [key], uncertain: false },
        meaning: { en, faMeaning: "A useful everyday phrase.", topic: "synthetic words" },
        pronunciation: { ipa: "/ˈsɪnθətɪk/" },
        practice: { fullSentence, gapSentence },
        teaching: {
          collocations: [],
          noteFa: "A common phrase in everyday speech.",
          imageFa: "Two neighbours talking over a fence.",
        },
      })),
      classNotes: { coverage: "A synthetic class about everyday words." },
    };
    return {
      output: input.schema.parse(output),
      requestId: `synthetic-${this.structuredCalls.length}`,
      model: input.model,
      provider: this.name,
      actualMicros: 1,
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
  async transcribe(): Promise<ProviderResult<Transcript>> {
    throw new Error("Fixture audio is already transcribed");
  }
  async speech(): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    throw new Error("Fixture has no speech");
  }
}

/** A synthetic ten-minute class, already transcribed. */
async function shortClass() {
  const x = await studyFixture(db);
  const minutes = 10;
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: "audio",
      declared_mime: "audio/mpeg",
      verified_mime: "audio/mpeg",
      size_bytes: 1000,
      duration_ms: minutes * 60_000,
      sha256: "c".repeat(64),
      display_name: "Synthetic guarded class.mp3",
      contract_version: "1",
      retention: "device_only",
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
      role: "class_audio",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, x.ctx, asset.id, {
      originKey: `synthetic-guarded-class:${asset.id}`,
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: Array.from({ length: minutes }, (_, index) => ({
        id: `u${index}`,
        kind: "time" as const,
        start: index * 60_000,
        end: index * 60_000 + 50_000,
      })),
      blocks: Array.from({ length: minutes }, (_, index) => ({
        id: `b${index}`,
        unitId: `u${index}`,
        kind: "transcript" as const,
        text: `Synthetic minute ${index}: we talk about ${words[index]}.`,
      })),
    }),
  );
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ document: 100, regeneration: 100, audio: 100000 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic study output guard verification",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-study-output-guard",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic study output guard verification" },
  );
  const provider = new GuardProvider();
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider, job },
  );
  runIds.push(run.id);
  const jobContext = (): JobContext => ({
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  });
  const work = async () => {
    for (
      let attempt = 0;
      attempt < 8 && ["queued", "processing"].includes((await getRun(db, x.ctx, run.id)).state);
      attempt++
    )
      await runFixtureProcessingJobs(db, job, { userId: x.ctx.userId, sessionId: x.session.id });
  };
  return { ...x, provider, job, run, jobContext, work };
}

const production = (items: readonly LearningItem[]) =>
  items.filter((item) => item.study?.set === "production");
const gap = (items: readonly LearningItem[], en: string) => {
  const study = items.find((item) => item.study?.en === en)?.study;
  return study?.set === "production" ? study.gapSentence : undefined;
};

describe("D110 study output guard on a content-contract run", () => {
  it("publishes the run-2 shape without a paid repair, and a requeued job changes nothing", async () => {
    const f = await shortClass();
    await f.work();
    expect(await getRun(db, f.ctx, f.run.id)).toMatchObject({ state: "ready", lastError: null });
    expect(f.provider.structuredCalls).toEqual(["class_knowledge_content"]);
    // The assembly's omission is saved beside the paid checkpoint, counts only.
    const marker = await db
      .selectFrom("proc.run_step")
      .select("output")
      .where("run_id", "=", f.run.id)
      .where("step", "=", "knowledge:assembly-omitted")
      .executeTakeFirstOrThrow();
    expect(marker.output).toEqual({
      version: 1,
      omitted: { study_gap_partial: 1 },
      omittedProduction: 1,
    });
    const latest = await getLatestVersion(db, f.ctx, f.session.id);
    expect(latest?.runId).toBe(f.run.id);
    const items = latest?.model.learningItems ?? [];
    expect(production(items)).toHaveLength(18);
    expect(items.map((item) => item.study?.en)).not.toContain("no face, no case");
    expect(items.map((item) => item.study?.en)).not.toContain("look forward to");
    expect(gap(items, "conceal")).toBe("Some people ______ their names online.");
    expect(gap(items, "a cloak of anonymity")).toBe(
      "Some users hide behind ______, making abuse easier.",
    );
    expect(latest?.generation).toMatchObject({
      studyOutput: {
        version: "study-output-guard-1",
        productionLimit: 18,
        gapsRebuilt: { spacing: 1, derivedBlank: 1 },
        droppedItems: { study_target_unsupported: 1 },
        trimmedOverLimit: 0,
        unlinkedMistakes: 0,
        assemblyOmitted: { study_gap_partial: 1 },
      },
    });
    // The audit holds code-owned counts, never class text.
    expect(
      JSON.stringify((latest?.generation as { studyOutput?: unknown } | undefined)?.studyOutput),
    ).not.toMatch(/conceal|cloak|face|neighbours/u);
    await db
      .updateTable("proc.processing_run")
      .set({ state: "queued" })
      .where("id", "=", f.run.id)
      .execute();
    await f.job.run({ runId: f.run.id, userId: f.ctx.userId }, f.jobContext());
    expect(f.provider.structuredCalls).toEqual(["class_knowledge_content"]);
    expect((await getLatestVersion(db, f.ctx, f.session.id))?.id).toBe(latest?.id);
  });

  it("publishes a reused run-1 checkpoint on Retry without a paid call", async () => {
    const f = await shortClass();
    const row = await db
      .selectFrom("proc.processing_run")
      .select("input_snapshot")
      .where("id", "=", f.run.id)
      .executeTakeFirstOrThrow();
    const audio = sourceSnapshotSchema.parse(row.input_snapshot).sources[0];
    if (!audio?.contentVersionId) throw new Error("Missing synthetic snapshot source");
    const claim = (index: number) => ({
      id: `claim-${index}`,
      text: `The class teaches synthetic word ${index}.`,
      origin: "from_class" as const,
      creation: "ai_generation" as const,
      evidence: "audio" as const,
      sourceRefs: [
        {
          sourceId: audio.sourceId,
          contentVersionId: audio.contentVersionId,
          locator: { kind: "time" as const, startMs: 0, endMs: 50_000 },
        },
      ],
      speakerRole: "unknown" as const,
      uncertain: false,
    });
    // The incident's run-1 shape: 18 cards, one stray space before a comma, one slogan.
    const run1Cards = [
      ...fillers,
      [
        "gain momentum",
        "The plan has gradually gained momentum, with new members every week.",
        "The plan has gradually ______ , with new members every week.",
      ],
      [
        "no face, no case",
        "They said no face, no case, and laughed.",
        "They said ______, and laughed.",
      ],
    ];
    const original = generatedKnowledgeSchema.parse({
      schemaVersion: "1",
      title: "Synthetic run-1 lesson",
      language: { learning: "en", explanation: "en" },
      summary: [],
      topics: [],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
      sourceClassifications: [],
      learningItems: run1Cards.map(([en = "", fullSentence = "", gapSentence = ""], index) => ({
        id: `item-${index}`,
        kind: "expression",
        front: en,
        back: "A useful everyday phrase.",
        claim: claim(index),
        study: {
          set: "production",
          en,
          faMeaning: "A useful everyday phrase.",
          topic: "synthetic words",
          ipa: "/ˈsɪnθətɪk/",
          fullSentence,
          gapSentence,
          collocations: [],
          noteFa: "A common phrase in everyday speech.",
          imageFa: "Two neighbours talking over a fence.",
          sourceFa: "From class",
        },
      })),
    });
    // The paid response of a run that failed before D110, as the incident's run 1 did.
    await providerStep(
      f.jobContext(),
      f.ctx,
      f.run.id,
      "knowledge",
      llm,
      f.provider,
      generatedKnowledgeSchema,
      async () => ({
        output: original,
        requestId: "synthetic-run-1",
        provider: f.provider.name,
        model: llm,
        usage: { inputTokens: 10, outputTokens: 10 },
        actualMicros: 1,
      }),
    );
    await db
      .insertInto("proc.run_step")
      .values({
        run_id: f.run.id,
        step: "knowledge:input-context",
        output: JSON.stringify({ version: 1, date: f.session.classDate }),
        completed_at: new Date(),
      })
      .execute();
    await cancelRun(db, f.ctx, f.run.id);
    await db
      .updateTable("proc.processing_run")
      .set({ state: "failed", last_error: "output_study_target_unsupported" })
      .where("id", "=", f.run.id)
      .execute();
    const retry = await retryRun(db, f.ctx, f.run.id, randomUUID(), {
      provider: f.provider,
      job: f.job,
    });
    runIds.push(retry.id);
    expect(
      await db
        .selectFrom("proc.run_step")
        .select("step")
        .where("run_id", "=", retry.id)
        .where("step", "=", "knowledge:reused")
        .execute(),
    ).toHaveLength(1);
    for (
      let attempt = 0;
      attempt < 8 && ["queued", "processing"].includes((await getRun(db, f.ctx, retry.id)).state);
      attempt++
    )
      await runFixtureProcessingJobs(db, f.job, { userId: f.ctx.userId, sessionId: f.session.id });
    expect(await getRun(db, f.ctx, retry.id)).toMatchObject({ state: "ready", lastError: null });
    expect(f.provider.structuredCalls).toEqual([]);
    expect(
      await db
        .selectFrom("proc.provider_attempt")
        .select("id")
        .where("run_id", "=", retry.id)
        .execute(),
    ).toEqual([]);
    const latest = await getLatestVersion(db, f.ctx, f.session.id);
    expect(latest?.runId).toBe(retry.id);
    const items = latest?.model.learningItems ?? [];
    expect(production(items)).toHaveLength(17);
    expect(gap(items, "gain momentum")).toBe(
      "The plan has gradually ______, with new members every week.",
    );
    expect(latest?.generation).toMatchObject({
      studyOutput: {
        gapsRebuilt: { spacing: 1, derivedBlank: 0 },
        droppedItems: { study_target_unsupported: 1 },
      },
    });
  });
});
