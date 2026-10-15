import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { cleanupFixtureProcessingJobs, runFixtureProcessingJobs } from "../../test/processing-jobs";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../acc";
import type {
  AiProvider,
  ProviderResult,
  ProviderSettings,
  StructuredInput,
  Transcript,
} from "../aip";
import { createDatabase } from "../db";
import type { KnowledgeModel } from "../lkm";
import { createSession } from "../org";
import { MemoryObjectStore, sha256Hex, writeOwnedObject } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import { createProcessingRun, getRun } from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 6 });
const runIds: string[] = [];
afterAll(async () => {
  try {
    await cleanupFixtureProcessingJobs(db, runIds);
  } finally {
    await db.destroy();
  }
});

const base: ProviderSettings = {
  version: "fixture-lesson-quality",
  llmModel: "synthetic/llm",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 20000,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maximumMicros: 10,
  currency: "USD",
  priceVersion: "fixture",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};

/** Synthetic provider: board readings and a one-claim lesson; never a paid service. */
class BoardProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  visionModels: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  knowledgeInputs: unknown[] = [];
  visionSystems: string[] = [];
  constructor(readonly settings: ProviderSettings) {}
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    if (input.schemaName === "source_extraction") {
      this.visionModels.push(input.model);
      this.visionSystems.push(input.system);
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      // Calls in flight overlap only if the worker starts them together.
      await new Promise((resolve) => setTimeout(resolve, 40));
      this.inFlight -= 1;
      const structured = this.settings.lessonQuality?.structuredBoard;
      const blocks = structured
        ? [
            { id: "h", type: "heading", text: "Present perfect" },
            {
              id: "r",
              type: "relation",
              text: "have + past participle → result now",
              // D78: one mark on the block and one the reading invented.
              ...(this.settings.lessonQuality?.learnerMarks
                ? {
                    marks: [
                      { style: "underline", text: "past participle" },
                      { style: "highlight", text: "not on this block" },
                    ],
                  }
                : {}),
            },
            { id: "e", type: "example", text: "I have lost my keys.", uncertain: true },
          ]
        : [{ id: "ocr-1", text: "Present perfect" }];
      return {
        output: input.schema.parse({
          blocks,
          classification: { role: "board_photo", confidence: "high" },
        }),
        requestId: "synthetic-vision",
        model: input.model,
        provider: this.name,
        actualMicros: 1,
        usage: { pages: 1 },
      };
    }
    const data = JSON.parse(input.input) as {
      sources: {
        sourceId: string;
        contentVersionId: string;
        blocks: { id: string; text: string }[];
      }[];
    };
    this.knowledgeInputs.push(data);
    const source = data.sources[0];
    const block = source?.blocks[0];
    if (!source || !block) throw new Error("Fixture expected extracted board text");
    const model: KnowledgeModel = {
      schemaVersion: "1",
      title: "Synthetic board lesson",
      language: { learning: "en", explanation: "en" },
      summary: [
        {
          id: "claim-1",
          text: "The board shows the present perfect.",
          origin: "from_class",
          creation: "ai_generation",
          evidence: "board",
          sourceRefs: [
            {
              sourceId: source.sourceId,
              contentVersionId: source.contentVersionId,
              locator: {
                kind: "text",
                blockId: block.id,
                start: 0,
                end: Array.from(block.text).length,
              },
            },
          ],
          speakerRole: "unknown",
          uncertain: false,
        },
      ],
      topics: [],
      learningItems: [],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
    };
    return {
      output: input.schema.parse({ ...model, sourceClassifications: [] }),
      requestId: "synthetic-generation",
      model: input.model,
      provider: this.name,
      actualMicros: 1,
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
  async transcribe(): Promise<ProviderResult<Transcript>> {
    throw new Error("Fixture has no audio");
  }
  async speech(): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    throw new Error("Fixture has no speech");
  }
}

async function photosFixture(settings: ProviderSettings, count: number) {
  const userId = await createAuthUser();
  const now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 600, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  const ctx = { userId, requestId: randomUUID() };
  await updateProfile(db, ctx, { field: "first_language", firstLanguage: "fa" }, { now });
  await updateProfile(
    db,
    ctx,
    { field: "explanation_language", explanationLanguage: "english" },
    { now },
  );
  await updateProfile(db, ctx, { field: "level_goal", level: null, goal: null }, { now });
  await updateProfile(db, ctx, { field: "timezone", timezone: "Europe/London" }, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  const session = await createSession(db, ctx, {}, { key: randomUUID() });
  const store = new MemoryObjectStore();
  const assetIds: string[] = [];
  for (let index = 0; index < count; index++) {
    const bytes = Buffer.from(`Synthetic board photo ${index}`);
    const objectId = await writeOwnedObject(db, store, ctx, {
      module: "src",
      retention: "durable",
      contentType: "image/jpeg",
      bytes,
      now,
    });
    const asset = await db
      .insertInto("src.asset")
      .values({
        user_id: ctx.userId,
        kind: "image",
        declared_mime: "image/jpeg",
        verified_mime: "image/jpeg",
        size_bytes: bytes.length,
        sha256: sha256Hex(bytes),
        original_object_id: objectId,
        display_name: `Board-${index}.jpeg`,
        contract_version: "1",
        retention: "persistent",
        operation_key: randomUUID(),
        request_hash: randomUUID(),
        verified_at: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    assetIds.push(asset.id);
    await db
      .insertInto("src.session_source")
      .values({
        user_id: ctx.userId,
        session_id: session.id,
        asset_id: asset.id,
        role: "class_material",
        selected: true,
      })
      .execute();
  }
  await grantEntitlement(db, {
    userId: ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ document: 100, regeneration: 100, audio: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "Synthetic integration fixture",
  });
  await configureCostPolicy(
    db,
    {
      version: "fixture",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic-operator", reason: "Synthetic integration fixture" },
  );
  const provider = new BoardProvider(settings);
  const job = processingJob({ provider, store, visionConcurrency: 4 });
  const run = await createProcessingRun(
    db,
    ctx,
    { sessionId: session.id, operationKey: randomUUID() },
    { provider, job },
  );
  runIds.push(run.id);
  const work = async () => {
    for (
      let attempt = 0;
      attempt < 6 && (await getRun(db, ctx, run.id)).state !== "ready";
      attempt++
    )
      await runFixtureProcessingJobs(db, job, { userId: ctx.userId, sessionId: session.id });
  };
  const contentBlocks = async () =>
    Promise.all(
      assetIds.map(async (assetId) => {
        const row = await db
          .selectFrom("src.content_version")
          .select("blocks")
          .where("asset_id", "=", assetId)
          .orderBy("created_at", "desc")
          .executeTakeFirstOrThrow();
        return row.blocks as Record<string, unknown>[];
      }),
    );
  return { ctx, run, provider, work, contentBlocks };
}

describe("lesson-quality-1 board photos (diagnosis 2026-10-12 §5.3, 0.5)", () => {
  it("reads several photos in parallel within the bound and keeps typed blocks in reading order", async () => {
    const settings: ProviderSettings = {
      ...base,
      lessonQuality: {
        version: "lesson-quality-1",
        budget: "lesson-budget-1",
        sourceCoverage: true,
        structuredBoard: true,
        boardVisionModel: "synthetic/board-vision",
      },
    };
    const f = await photosFixture(settings, 5);
    await f.work();
    expect((await getRun(db, f.ctx, f.run.id)).state).toBe("ready");
    // Five photos, at most four at once, each read exactly once.
    expect(f.provider.visionModels).toEqual(Array(5).fill("synthetic/board-vision"));
    expect(f.provider.maxInFlight).toBeGreaterThan(1);
    expect(f.provider.maxInFlight).toBeLessThanOrEqual(4);
    for (const blocks of await f.contentBlocks())
      expect(blocks).toEqual([
        expect.objectContaining({ kind: "heading", layout: { type: "heading", order: 1 } }),
        expect.objectContaining({ kind: "paragraph", layout: { type: "relation", order: 2 } }),
        expect.objectContaining({
          kind: "paragraph",
          layout: { type: "example", order: 3, uncertain: true },
        }),
      ]);
    // The structure reaches the lesson request as block metadata.
    expect(JSON.stringify(f.provider.knowledgeInputs)).toContain('"type":"relation"');
  });

  it("D78 keeps the spans marked on a photo and passes them to the lesson", async () => {
    const settings: ProviderSettings = {
      ...base,
      lessonQuality: {
        version: "lesson-quality-1",
        budget: "lesson-budget-1",
        sourceCoverage: true,
        structuredBoard: true,
        learnerMarks: true,
      },
    };
    const f = await photosFixture(settings, 1);
    await f.work();
    expect((await getRun(db, f.ctx, f.run.id)).state).toBe("ready");
    expect(f.provider.visionSystems[0]).toContain("highlighted with a marker");
    const [blocks] = await f.contentBlocks();
    expect(blocks?.[1]).toMatchObject({
      layout: {
        type: "relation",
        order: 2,
        marks: [{ style: "underline", text: "past participle" }],
      },
    });
    expect(JSON.stringify(f.provider.knowledgeInputs)).toContain(
      '"marks":[{"style":"underline","text":"past participle"}]',
    );
  });

  it("keeps the plain OCR contract and the vision model for snapshots without lessonQuality", async () => {
    const f = await photosFixture(base, 2);
    await f.work();
    expect((await getRun(db, f.ctx, f.run.id)).state).toBe("ready");
    expect(f.provider.visionModels).toEqual(["synthetic/vision", "synthetic/vision"]);
    for (const blocks of await f.contentBlocks())
      expect(blocks).toEqual([
        { id: "ocr-1", kind: "paragraph", text: "Present perfect", unitId: "image-1" },
      ]);
  });
});
