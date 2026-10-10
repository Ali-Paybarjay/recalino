import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { OpenRouterProvider, ProviderError, type ProviderSettings } from "../aip";
import { createDatabase } from "../db";
import {
  DEFAULT_PLT_SETTINGS,
  type JobContext,
  MemoryObjectStore,
  sha256Hex,
  writeOwnedObject,
} from "../plt";
import { amounts, configureCostPolicy, grantEntitlement } from "../quota";
import {
  acceptSourceNotice,
  beginTemporaryAudioUpload,
  createSource,
  temporaryAudioPartLink,
  verifyTemporaryAudio,
} from "../src";
import { activateProcessingRun, createProcessingRun, getRun } from "./runs";
import { processingJob, TRANSCRIPTION_CONCURRENCY } from "./worker";

// Synthetic audio and provider responses only; no network request leaves the test.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "synthetic-parallel",
  llmModel: "synthetic/llm",
  visionModel: "synthetic/vision",
  sttModel: "synthetic/stt",
  ttsModel: "synthetic/tts",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 20000,
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
const CHUNKS = 6;
const CHUNK_MS = 2000;

function knowledgeResponse(init?: RequestInit) {
  const body = JSON.parse(String(init?.body));
  const source = JSON.parse(body.messages[1].content[0].text).sources[0];
  return new Response(
    JSON.stringify({
      id: "synthetic-parallel-knowledge",
      model: settings.llmModel,
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              schemaVersion: "1",
              title: "Synthetic parallel class",
              language: { learning: "en", explanation: "en" },
              summary: [
                {
                  id: "synthetic-summary",
                  text: "We practised a synthetic sentence.",
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
}

/** One synthetic class whose audio the fixture preparer cuts into CHUNKS chunks. */
async function parallelClass(
  transcribe: (index: number) => Promise<Response>,
  options: { concurrency?: number } = {},
) {
  const x = await studyFixture(db);
  const calls: number[] = [];
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/audio/transcriptions")) {
      const index = Number(
        Buffer.from(JSON.parse(String(init?.body)).input_audio.data, "base64").at(-1),
      );
      calls.push(index);
      return transcribe(index);
    }
    return knowledgeResponse(init);
  });
  const provider = new OpenRouterProvider("synthetic-private-key", settings, request);
  const store = new MemoryObjectStore();
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 60, regeneration: 1 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic parallel transcription integration",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-parallel",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic", reason: "Synthetic parallel transcription integration" },
  );
  const bytes = new Uint8Array([0x49, 0x44, 0x33]);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/mpeg",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Synthetic parallel.mp3",
    durationMs: CHUNKS * CHUNK_MS,
    parts: [],
    operationKey: randomUUID(),
  });
  const chunkObjects: string[] = [];
  const job = processingJob({
    provider,
    store,
    ...(options.concurrency ? { transcriptionConcurrency: options.concurrency } : {}),
    prepareAudio: async ({ runId, source: selected, ctx, now }) =>
      Promise.all(
        Array.from({ length: CHUNKS }, async (_, index) => {
          // The last byte names the chunk, so the provider mock can tell them apart.
          const objectId = await writeOwnedObject(db, store, ctx, {
            module: "src",
            retention: "temporary",
            contentType: "audio/mpeg",
            bytes: new Uint8Array([0x49, 0x44, 0x33, index]),
            now,
          });
          chunkObjects[index] = objectId;
          return {
            id: `${runId}-${index}`,
            sourceId: selected.sourceId,
            objectId,
            offsetMs: index * CHUNK_MS,
            durationMs: CHUNK_MS,
            format: "mp3" as const,
          };
        }),
      ),
  });
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
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
    inspect: async () => ({ durationMs: CHUNKS * CHUNK_MS, audioOnly: true }),
  });
  await activateProcessingRun(db, x.ctx, run.id, job);
  const invoke = (overrides: Partial<JobContext> = {}) =>
    job.run(
      { runId: run.id, userId: x.ctx.userId },
      {
        db,
        now: () => new Date(),
        job: { id: randomUUID(), attempt: 1 },
        step: async () => "ran" as const,
        ...overrides,
      },
    );
  const objectStates = async () =>
    (
      await db
        .selectFrom("plt.storage_object")
        .select(["id", "state"])
        .where("id", "in", chunkObjects)
        .execute()
    ).map((row) => row.state);
  return { x, run, calls, request, invoke, objectStates };
}

const transcript = (index: number) =>
  new Response(
    JSON.stringify({
      text: `Synthetic chunk ${index}`,
      language: "en",
      segments: [{ start: 0, end: 1, text: `Synthetic chunk ${index}` }],
      usage: { seconds: 2, cost: 0.000002 },
    }),
    { headers: { "X-Generation-Id": `synthetic-parallel-stt-${index}` } },
  );

it("PRD-SEG-01 transcribes a long class's chunks a few at a time in one job, then publishes from the next", async () => {
  let inFlight = 0;
  let peak = 0;
  let overlapped = () => {};
  const overlap = new Promise<void>((resolve) => {
    overlapped = resolve;
  });
  const c = await parallelClass(async (index) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    if (inFlight > 1) overlapped();
    // A call waits for a second one, however long each start's database step takes; serial
    // calls would only reach the bound and fail the peak check below.
    await Promise.race([overlap, new Promise((resolve) => setTimeout(resolve, 2000))]);
    inFlight -= 1;
    return transcript(index);
  });
  await c.invoke();
  expect([...c.calls].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(TRANSCRIPTION_CONCURRENCY);
  // Every chunk's bytes are gone once its transcript is saved (D29).
  expect(await c.objectStates()).toEqual(Array(CHUNKS).fill("deleted"));
  await c.invoke();
  expect(c.request).toHaveBeenCalledTimes(CHUNKS + 1);
  expect(await getRun(db, c.x.ctx, c.run.id)).toMatchObject({ state: "ready", lastError: null });
  const attempts = await db
    .selectFrom("proc.provider_attempt")
    .select(["step", "state"])
    .where("run_id", "=", c.run.id)
    .execute();
  expect(attempts).toHaveLength(CHUNKS + 1);
  expect(attempts.every((attempt) => attempt.state === "succeeded")).toBe(true);
});

it("PRD-PROC-03 keeps finished chunks when one fails, and the retry transcribes only the failed chunk", async () => {
  let failures = 0;
  const c = await parallelClass(
    async (index) => {
      if (index === 2 && failures++ === 0)
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
        });
      return transcript(index);
    },
    { concurrency: 2 },
  );
  await expect(c.invoke()).rejects.toBeInstanceOf(ProviderError);
  // No chunk starts after the failure; the one in flight beside it settles and is kept.
  expect([...c.calls].sort()).toEqual([0, 1, 2, 3]);
  await c.invoke({ job: { id: randomUUID(), attempt: 2 } });
  expect(c.calls.slice(4).sort()).toEqual([2, 4, 5]);
  await c.invoke({ job: { id: randomUUID(), attempt: 2 } });
  expect(await getRun(db, c.x.ctx, c.run.id)).toMatchObject({ state: "ready" });
  const attempts = await db
    .selectFrom("proc.provider_attempt")
    .select(["step", "attempt", "state"])
    .where("run_id", "=", c.run.id)
    .where("step", "=", `stt:${c.run.id}-2`)
    .orderBy("attempt")
    .execute();
  expect(attempts.map((row) => row.state)).toEqual(["failed", "succeeded"]);
});

it("FR-PLT-005 starts only one chunk when the runner's deadline leaves time for one provider call", async () => {
  const c = await parallelClass(async (index) => transcript(index));
  await c.invoke({ deadline: new Date(Date.now() + settings.timeoutMs + 1000) });
  expect(c.calls).toHaveLength(1);
  await c.invoke();
  expect(c.calls).toHaveLength(CHUNKS);
});
