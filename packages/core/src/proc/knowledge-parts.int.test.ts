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
import { getLatestVersion } from "../lkm";
import { MemoryObjectStore } from "../plt";
import { allowance, amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { appendContentVersion } from "../src";
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

const llm = "synthetic/content-llm";
function settings(classPartMinutes?: number): ProviderSettings {
  return {
    version: "fixture-lesson-parts",
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
      ...(classPartMinutes ? { classPartMinutes } : {}),
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
}
const targets = ["look forward to", "get on with", "put up with"];

/** Synthetic content-contract lessons: one card per request, never a paid service. */
class PartsProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  requests: { schemaName: string; system: string; sources: number; keys: number }[] = [];
  constructor(readonly settings: ProviderSettings) {}
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    const data = JSON.parse(input.input) as {
      sources: { sourceKey?: string; evidence: [string | null, ...unknown[]][] }[];
    };
    const firstKeys = data.sources.map(
      (source) => source.evidence.find(([key]) => key !== null)?.[0] ?? null,
    );
    this.requests.push({
      schemaName: input.schemaName,
      system: input.system,
      sources: data.sources.length,
      keys: data.sources.reduce((sum, source) => sum + source.evidence.length, 0),
    });
    // Both parts teach the shared target once more: the merge keeps it once.
    const index = this.requests.length - 1;
    const words = [targets[0] ?? "", targets[index + 1] ?? ""];
    const key = firstKeys.find((value) => value !== null) ?? "r0";
    const item = (target: string) => ({
      type: "lexical",
      kind: "expression",
      claim: { text: `The class teaches ${target}.`, evidenceKeys: [key], uncertain: false },
      meaning: { en: target, faMeaning: "A useful everyday phrase.", topic: "phrasal verbs" },
      pronunciation: { ipa: "/ˈsɪnθətɪk/" },
      practice: {
        fullSentence: `Every week I ${target} my synthetic neighbours.`,
        gapSentence: "Every week I ______ my synthetic neighbours.",
      },
      teaching: {
        collocations: [],
        noteFa: "A common phrase in everyday speech.",
        imageFa: "Two neighbours talking over a fence.",
      },
    });
    const output = {
      lessonPlan: firstKeys.flatMap((sourceKey, sourceIndex) =>
        sourceKey
          ? [{ concept: `source ${sourceIndex}`, evidenceKeys: [sourceKey], teachAs: "card" }]
          : [],
      ),
      title: "Synthetic long class",
      learningItems: words.map(item),
      classNotes: { coverage: `Part ${index + 1} of a synthetic class.` },
    };
    return {
      output: input.schema.parse(output),
      requestId: `synthetic-${index}`,
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

/** A synthetic 128-minute class: one transcript segment per minute. */
async function longClass(configured: ProviderSettings) {
  const x = await studyFixture(db);
  const minutes = 128;
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: "audio",
      declared_mime: "audio/mpeg",
      verified_mime: "audio/mpeg",
      size_bytes: 1000,
      duration_ms: minutes * 60_000,
      sha256: "b".repeat(64),
      display_name: "Synthetic long class.mp3",
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
      originKey: `synthetic-long-class:${asset.id}`,
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
        text: `Synthetic minute ${index}: we ${targets[index % 3]} our neighbours.`,
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
    reason: "Synthetic long-class verification",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-lesson-parts",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic long-class verification" },
  );
  const provider = new PartsProvider(configured);
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider, job },
  );
  runIds.push(run.id);
  for (
    let attempt = 0;
    attempt < 8 && (await getRun(db, x.ctx, run.id)).state !== "ready";
    attempt++
  )
    await runFixtureProcessingJobs(db, job, { userId: x.ctx.userId, sessionId: x.session.id });
  return { ...x, provider, run };
}

describe("D63 classes longer than one part (owner decision 2026-10-12)", () => {
  it("teaches a 128-minute class in two parts and publishes one merged lesson, charged once", async () => {
    const f = await longClass(settings(90));
    expect((await getRun(db, f.ctx, f.run.id)).state).toBe("ready");
    // Two parts of 64 minutes, each with its own measured budget and half of the evidence.
    expect(f.provider.requests.map((request) => request.schemaName)).toEqual([
      "class_knowledge_content",
      "class_knowledge_content",
    ]);
    expect(f.provider.requests.map((request) => request.keys)).toEqual([64, 64]);
    const latest = await getLatestVersion(db, f.ctx, f.session.id);
    // The shared target is taught once; each part's own target is kept.
    expect(latest?.model.learningItems.map((item) => item.front).sort()).toEqual([
      "get on with",
      "look forward to",
      "put up with",
    ]);
    expect(latest?.model.coverage.sources).toEqual([
      { sourceId: expect.any(String), status: "used" },
    ]);
    // Material is charged once at publication, in seconds of the whole class.
    expect((await allowance(db, f.ctx)).consumed.audio).toBe(128 * 60);
  });

  it("keeps a single lesson call without the setting", async () => {
    const f = await longClass(settings());
    expect((await getRun(db, f.ctx, f.run.id)).state).toBe("ready");
    expect(f.provider.requests).toHaveLength(1);
    expect(f.provider.requests[0]?.keys).toBe(128);
  });
});
