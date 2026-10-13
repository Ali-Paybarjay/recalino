import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { OpenRouterProvider, type ProviderSettings } from "../aip";
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
  beginStagedAudioUpload,
  confirmTemporaryAudioPart,
  createSource,
  markSourceAudioTranscribed,
  temporaryAudioPartLink,
  verifyTemporaryAudio,
} from "../src";
import {
  captureTranscriptionActive,
  captureTranscriptionJob,
  scheduleCaptureTranscription,
} from "./capture-transcription";
import { sourceSnapshotSchema } from "./contracts";
import { createProcessingRun, getRun, listRuns, selectProcessingSourceSnapshot } from "./runs";
import { type AudioPreparer, processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "synthetic-capture-transcription",
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
const CHUNK_MS = 2000;

async function stagedPartFixture(audio = 60) {
  const x = await studyFixture(db);
  const stt = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          text: "Synthetic sentence from part one",
          language: "en",
          segments: [{ start: 0, end: 1.5, text: "Synthetic sentence from part one" }],
          usage: { seconds: 2, cost: 0.000002 },
        }),
        { headers: { "X-Generation-Id": `synthetic-capture-${randomUUID()}` } },
      ),
  );
  const provider = new OpenRouterProvider("synthetic-private-key", settings, stt);
  const store = new MemoryObjectStore();
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio, regeneration: 1 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic capture transcription integration",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-capture-transcription",
      currency: "USD",
      killSwitch: false,
      limits: { session: 1e8, userMonth: 1e8, systemDay: 1e8, systemMonth: 1e8 },
    },
    { actorId: "synthetic", reason: "Synthetic capture transcription integration" },
  );
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 7]);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/webm",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Session recording 2026-10-12 · Part 1",
    durationMs: 2 * CHUNK_MS,
    parts: [],
    operationKey: `recorded-source:${randomUUID()}`,
  });
  const parts = [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }];
  const staged = await beginStagedAudioUpload(db, x.ctx, source.assetId, { parts });
  const link = await temporaryAudioPartLink(
    db,
    store,
    x.ctx,
    source.assetId,
    staged.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  expect(store.upload(link.url, bytes, "audio/webm")).toBe(200);
  await confirmTemporaryAudioPart(db, store, x.ctx, source.assetId, staged.uploadId, 0);
  await verifyTemporaryAudio(db, store, x.ctx, source.assetId, staged.uploadId, {
    inspect: async () => ({ durationMs: 2 * CHUNK_MS, audioOnly: true }),
  });
  const prepareAudio: AudioPreparer = async ({ runId, source: selected, ctx, now }) =>
    Promise.all(
      [0, 1].map(async (index) => ({
        id: `${runId}-${index}`,
        sourceId: selected.sourceId,
        objectId: await writeOwnedObject(db, store, ctx, {
          module: "src",
          retention: "temporary",
          contentType: "audio/mpeg",
          bytes: new Uint8Array([0x49, 0x44, 0x33, index]),
          now,
        }),
        offsetMs: index * CHUNK_MS,
        durationMs: CHUNK_MS,
        format: "mp3" as const,
      })),
    );
  const dependencies = {
    provider,
    store,
    prepareAudio,
    onTranscribed: markSourceAudioTranscribed,
  };
  const context = (): JobContext => ({
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  });
  return { ...x, source, staged, stt, store, provider, dependencies, context };
}

it("D61: transcribes a staged part in the background and the class run after Stop reuses it", async () => {
  const x = await stagedPartFixture();
  const runId = await scheduleCaptureTranscription(db, x.ctx, x.source.assetId, x.dependencies);
  expect(runId).toBeTruthy();
  expect(await captureTranscriptionActive(db, x.ctx, x.session.id)).toBe(true);
  // An auxiliary run never appears as a class run or as processing history.
  expect(await listRuns(db, x.ctx, x.session.id)).toEqual([]);
  await captureTranscriptionJob(x.dependencies).run(
    { runId: runId as string, userId: x.ctx.userId, subjectId: x.source.assetId },
    x.context(),
  );
  expect(x.stt).toHaveBeenCalledTimes(2);
  expect(await captureTranscriptionActive(db, x.ctx, x.session.id)).toBe(false);
  // Re-running the part's transcription calls the provider again for nothing (idempotent checkpoints).
  await captureTranscriptionJob(x.dependencies).run(
    { runId: runId as string, userId: x.ctx.userId, subjectId: x.source.assetId },
    x.context(),
  );
  expect(x.stt).toHaveBeenCalledTimes(2);
  expect(
    await db
      .selectFrom("proc.provider_attempt")
      .select("id")
      .where("run_id", "=", runId as string)
      .execute(),
  ).toHaveLength(2);
  // Nothing reserved or charged: the hold of the background run settles empty.
  const reservation = await db
    .selectFrom("proc.processing_run as run")
    .innerJoin("quota.reservation as hold", "hold.id", "run.reservation_id")
    .select(["run.state", "run.kind", "hold.amounts", "hold.settled_amounts"])
    .where("run.id", "=", runId as string)
    .executeTakeFirstOrThrow();
  expect(reservation).toMatchObject({
    state: "ready",
    kind: "auxiliary",
    amounts: amounts({}),
    settled_amounts: amounts({}),
  });
  // The class run sees a transcribed part: no upload, no second transcription.
  const snapshot = sourceSnapshotSchema.parse(
    await selectProcessingSourceSnapshot(db, x.ctx, x.session.id),
  );
  const part = snapshot.sources.find((source) => source.sourceId === x.source.assetId);
  expect(part?.contentVersionId).toBeTruthy();
  expect(part?.blocks.map((block) => block.text)).toEqual([
    "Synthetic sentence from part one",
    "Synthetic sentence from part one",
  ]);
  const run = await createProcessingRun(
    db,
    x.ctx,
    { sessionId: x.session.id, operationKey: randomUUID() },
    { provider: x.provider, job: processingJob({ provider: x.provider, store: x.store }) },
  );
  expect(run.state).toBe("queued");
  // The class run still reserves the part's seconds once (D59).
  expect((await getRun(db, x.ctx, run.id)).state).toBe("queued");
  const held = await db
    .selectFrom("proc.processing_run")
    .select("requested_amounts")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  expect(held.requested_amounts).toEqual(amounts({ audio: 4, regeneration: 1 }));
  // Running the class run sends no audio to the provider again (its lesson call may fail here).
  const sttCalls = () =>
    x.stt.mock.calls.filter(([url]) => String(url).endsWith("/audio/transcriptions")).length;
  expect(sttCalls()).toBe(2);
  await processingJob({ provider: x.provider, store: x.store })
    .run({ runId: run.id, userId: x.ctx.userId }, x.context())
    .catch(() => {});
  expect(sttCalls()).toBe(2);
  // D29: the staged copy now expires within 24 hours of the transcription.
  const upload = await db
    .selectFrom("src.audio_upload")
    .select(["transcribed_at", "expires_at"])
    .where("id", "=", x.staged.uploadId)
    .executeTakeFirstOrThrow();
  expect(upload.transcribed_at).toBeTruthy();
  expect(upload.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000);
});

it("D61: schedules nothing twice, nor without allowance for the part", async () => {
  const x = await stagedPartFixture();
  const first = await scheduleCaptureTranscription(db, x.ctx, x.source.assetId, x.dependencies);
  expect(await scheduleCaptureTranscription(db, x.ctx, x.source.assetId, x.dependencies)).toBe(
    first,
  );
  const poor = await stagedPartFixture(1);
  expect(
    await scheduleCaptureTranscription(db, poor.ctx, poor.source.assetId, poor.dependencies),
  ).toBeNull();
  expect(poor.stt).not.toHaveBeenCalled();
});

it("D61: a failed background transcription leaves the part to the class run", async () => {
  const x = await stagedPartFixture();
  x.stt.mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: { message: "synthetic refusal" } }), { status: 400 }),
  );
  const runId = (await scheduleCaptureTranscription(
    db,
    x.ctx,
    x.source.assetId,
    x.dependencies,
  )) as string;
  await captureTranscriptionJob(x.dependencies).run(
    { runId, userId: x.ctx.userId, subjectId: x.source.assetId },
    x.context(),
  );
  expect(await getRun(db, x.ctx, runId)).toMatchObject({ state: "failed" });
  expect(await captureTranscriptionActive(db, x.ctx, x.session.id)).toBe(false);
  const snapshot = sourceSnapshotSchema.parse(
    await selectProcessingSourceSnapshot(db, x.ctx, x.session.id),
  );
  const part = snapshot.sources.find((source) => source.sourceId === x.source.assetId);
  expect(part?.contentVersionId).toBeNull();
  expect(part?.objectId).toBeTruthy();
});
