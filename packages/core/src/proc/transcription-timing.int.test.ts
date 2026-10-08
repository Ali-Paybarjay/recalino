import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { OpenRouterProvider, type ProviderSettings } from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion } from "../lkm";
import { DEFAULT_PLT_SETTINGS, MemoryObjectStore, sha256Hex, writeOwnedObject } from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import {
  acceptSourceNotice,
  beginTemporaryAudioUpload,
  createSource,
  selectSourceSnapshot,
  temporaryAudioPartLink,
  verifyTemporaryAudio,
} from "../src";
import { sourceSnapshotSchema } from "./contracts";
import { activateProcessingRun, createProcessingRun, getRun } from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "synthetic-timing",
  llmModel: "synthetic/llm",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 10000,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maximumMicros: 100,
  currency: "USD",
  priceVersion: "fixture",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};

it("publishes partial audio notes with complete text evidence and settled costs when native timing is invalid", async () => {
  const x = await studyFixture(db);
  const text = "We studied the present perfect, including the words outside the invalid time span.";
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/audio/transcriptions"))
      return new Response(
        JSON.stringify({
          text,
          language: "en",
          segments: [
            { start: 0, end: 1, text: "We studied the present perfect" },
            { start: 1, end: 2.05, text: "including the words outside the invalid time span" },
          ],
          usage: { seconds: 2, cost: 0.000002 },
        }),
        { headers: { "X-Generation-Id": "synthetic-timing-stt" } },
      );
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.messages[1].content[0].text);
    const source = input.sources[0];
    expect(source.blocks[0].text).toBe(text);
    expect(source.allowedSourceRefs[0].locator.kind).toBe("text");
    return new Response(
      JSON.stringify({
        id: "synthetic-timing-knowledge",
        model: settings.llmModel,
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                schemaVersion: "1",
                title: "Present perfect",
                language: { learning: "en", explanation: "en" },
                summary: [
                  {
                    id: "synthetic-summary",
                    text: "We studied the present perfect.",
                    origin: "from_class",
                    creation: "ai_generation",
                    evidence: "audio",
                    sourceRefs: [source.allowedSourceRefs[0]],
                    speakerRole: "unknown",
                    uncertain: true,
                  },
                ],
                topics: [],
                learningItems: [],
                homework: [],
                uncertainties: [],
                coverage: { complete: true, missingSourceIds: [] },
                sourceClassifications: [
                  {
                    sourceId: source.sourceId,
                    classification: { role: "class_material", confidence: "high" },
                  },
                ],
              }),
            },
          },
        ],
        usage: { cost: 0.000003 },
      }),
    );
  });
  const provider = new OpenRouterProvider("synthetic-private-key", settings, request);
  const store = new MemoryObjectStore();
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 10, regeneration: 1 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic transcription timing integration",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-timing",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic", reason: "Synthetic transcription timing integration" },
  );
  const bytes = new Uint8Array([0x49, 0x44, 0x33]);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/mpeg",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Synthetic timing.mp3",
    durationMs: 2000,
    parts: [],
    operationKey: randomUUID(),
  });
  const job = processingJob({
    provider,
    store,
    prepareAudio: async ({ runId, source: selected, ctx, now }) => [
      {
        id: `${runId}-0`,
        sourceId: selected.sourceId,
        objectId: await writeOwnedObject(db, store, ctx, {
          module: "src",
          retention: "temporary",
          contentType: "audio/mpeg",
          bytes,
          now,
        }),
        offsetMs: 0,
        durationMs: 2000,
        format: "mp3",
      },
    ],
  });
  const run = await createProcessingRun(
    db,
    x.ctx,
    {
      sessionId: x.session.id,
      operationKey: randomUUID(),
    },
    { provider, job },
  );
  const upload = await beginTemporaryAudioUpload(db, x.ctx, source.assetId, {
    reservationId: run.reservationId,
    parts: [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }],
  });
  const link = await temporaryAudioPartLink(
    db,
    store,
    x.ctx,
    source.assetId,
    upload.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  expect(store.upload(link.url, bytes, "audio/mpeg")).toBe(200);
  await verifyTemporaryAudio(db, store, x.ctx, source.assetId, upload.uploadId, {
    inspect: async () => ({ durationMs: 2000, audioOnly: true }),
  });
  await activateProcessingRun(db, x.ctx, run.id, job);
  const context = {
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  };
  // One native transcription per invocation, then the durable continuation publishes notes.
  await job.run({ runId: run.id, userId: x.ctx.userId }, context);
  await job.run(
    { runId: run.id, userId: x.ctx.userId },
    {
      ...context,
      job: { id: randomUUID(), attempt: 1 },
    },
  );
  expect(request).toHaveBeenCalledTimes(2);
  expect(await getRun(db, x.ctx, run.id)).toMatchObject({
    state: "partial_ready",
    lastError: null,
  });
  const latest = await getLatestVersion(db, x.ctx, x.session.id);
  expect(latest?.model.coverage).toEqual({ complete: false, missingSourceIds: [source.assetId] });
  expect(latest?.model.summary[0]).toMatchObject({ evidence: "audio", speakerRole: "unknown" });
  expect(latest?.model.summary[0]?.sourceRefs[0]?.locator).toEqual({
    kind: "text",
    blockId: `${run.id}-0-text`,
    start: 0,
    end: Array.from(text).length,
  });
  const saved = sourceSnapshotSchema.parse(await selectSourceSnapshot(db, x.ctx, x.session.id))
    .sources[0];
  expect(saved?.blocks[0]?.text).toBe(text);
  expect(saved?.units).toEqual([
    {
      id: `${run.id}-0`,
      kind: "document",
      start: 1,
      status: "partial",
      reason: "timestamps_unavailable",
    },
  ]);
  const attempts = await db
    .selectFrom("proc.provider_attempt as attempt")
    .innerJoin("quota.cost_hold as hold", "hold.id", "attempt.hold_id")
    .select(["attempt.state", "attempt.provider_request_id", "hold.closed_at"])
    .where("attempt.run_id", "=", run.id)
    .orderBy("attempt.started_at")
    .execute();
  expect(attempts).toEqual([
    {
      state: "succeeded",
      provider_request_id: "synthetic-timing-stt",
      closed_at: expect.any(Date),
    },
    {
      state: "succeeded",
      provider_request_id: "synthetic-timing-knowledge",
      closed_at: expect.any(Date),
    },
  ]);
  const costs = await db
    .selectFrom("quota.provider_cost")
    .select("amount_micros")
    .where("run_id", "=", run.id)
    .orderBy("created_at")
    .execute();
  expect(costs.map((cost) => Number(cost.amount_micros))).toEqual([2, 3]);
});
