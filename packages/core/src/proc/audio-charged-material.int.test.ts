import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { OpenRouterProvider, type ProviderSettings } from "../aip";
import { createDatabase } from "../db";
import { getLatestVersion } from "../lkm";
import { createSession } from "../org";
import { DEFAULT_PLT_SETTINGS, MemoryObjectStore, sha256Hex, writeOwnedObject } from "../plt";
import { allowance, amounts, configureCostPolicy, grantEntitlement } from "../quota";
import {
  acceptSourceNotice,
  beginTemporaryAudioUpload,
  confirmTemporaryAudioPart,
  createSource,
  readInputContract,
  sourceAudioVerificationJob,
  temporaryAudioManifest,
  temporaryAudioPartLink,
} from "../src";
import { expireAwaitingUploads } from "./maintenance";
import { activateProcessingRun, createProcessingRun, getRun, validateAudioUploadRun } from "./runs";
import { processingJob } from "./worker";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
const settings: ProviderSettings = {
  version: "synthetic-d59-audio",
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
const text = "We practised the present perfect with synthetic sentences.";

/** Synthetic STT and lesson responses; no network request leaves the test. */
function syntheticProvider() {
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/audio/transcriptions"))
      return new Response(
        JSON.stringify({
          text,
          language: "en",
          segments: [{ start: 0, end: 2, text }],
          usage: { seconds: 2, cost: 0.000002 },
        }),
        { headers: { "X-Generation-Id": `synthetic-d59-stt-${randomUUID()}` } },
      );
    const body = JSON.parse(String(init?.body));
    const source = JSON.parse(body.messages[1].content[0].text).sources[0];
    return new Response(
      JSON.stringify({
        id: `synthetic-d59-lesson-${randomUUID()}`,
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
                    text: "We practised the present perfect.",
                    origin: "from_class",
                    creation: "ai_generation",
                    evidence: "audio",
                    sourceRefs: [source.allowedSourceRefs[0]],
                    speakerRole: "unknown",
                    uncertain: false,
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
  return new OpenRouterProvider("synthetic-private-key", settings, request);
}

it("D59 regression: the same audio in another class of the period uploads, transcribes and publishes without a second audio charge", async () => {
  const x = await studyFixture(db);
  const provider = syntheticProvider();
  const store = new MemoryObjectStore();
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 10, regeneration: 2 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic D59 audio regression",
  });
  await configureCostPolicy(
    db,
    {
      version: "synthetic-d59-audio",
      currency: "USD",
      killSwitch: false,
      limits: {
        session: 100000000,
        userMonth: 100000000,
        systemDay: 100000000,
        systemMonth: 100000000,
      },
    },
    { actorId: "synthetic", reason: "Synthetic D59 audio regression" },
  );
  const bytes = new Uint8Array([0x49, 0x44, 0x33]);
  const job = processingJob({
    provider,
    store,
    prepareAudio: async ({ runId, source, ctx, now }) => [
      {
        id: `${runId}-0`,
        sourceId: source.sourceId,
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
  const verification = sourceAudioVerificationJob(
    store,
    { inspect: async () => ({ durationMs: 2000, audioOnly: true }) },
    async (database, ctx, runId) => {
      await activateProcessingRun(database, ctx, runId, job);
    },
  );
  const context = () => ({
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  });

  /** The client path of `POST /api/sources/{id}/audio`: start, confirm_part, complete. */
  async function processClassAudio(sessionId: string) {
    const source = await createSource(db, x.ctx, {
      sessionId,
      kind: "audio",
      mimeType: "audio/mpeg",
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      displayName: "Synthetic shared class.mp3",
      durationMs: 2000,
      parts: [],
      operationKey: randomUUID(),
    });
    const run = await createProcessingRun(
      db,
      x.ctx,
      { sessionId, operationKey: randomUUID() },
      { provider, job },
    );
    expect(run.state).toBe("awaiting_upload");
    await validateAudioUploadRun(db, x.ctx, run.id, source.assetId, run.reservationId);
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
    const manifest = await temporaryAudioManifest(db, x.ctx, source.assetId, upload.uploadId);
    await validateAudioUploadRun(db, x.ctx, run.id, source.assetId, manifest.reservationId);
    expect(
      await confirmTemporaryAudioPart(db, store, x.ctx, source.assetId, upload.uploadId, 0),
    ).toBe("verified");
    await verification.run(
      { userId: x.ctx.userId, assetId: source.assetId, uploadId: upload.uploadId, runId: run.id },
      context(),
    );
    for (let step = 0; step < 6; step++) {
      const current = await getRun(db, x.ctx, run.id);
      if (!["queued", "processing"].includes(current.state)) break;
      await job.run({ runId: run.id, userId: x.ctx.userId }, context());
    }
    return { run, source, upload };
  }

  const first = await processClassAudio(x.session.id);
  expect(await getRun(db, x.ctx, first.run.id)).toMatchObject({ state: "ready", lastError: null });
  const charged = (await allowance(db, x.ctx)).consumed.audio;
  expect(charged).toBe(2);

  const copy = await createSession(db, x.ctx, {}, { key: randomUUID() });
  const second = await processClassAudio(copy.id);
  const reserved = await db
    .selectFrom("proc.processing_run")
    .select("requested_amounts")
    .where("id", "=", second.run.id)
    .executeTakeFirstOrThrow();
  // D59: the paid content is not reserved again, so the confirmed hold has no audio seconds.
  expect(reserved.requested_amounts).toMatchObject({ audio: 0 });
  expect(
    await db
      .selectFrom("src.audio_upload")
      .select("state")
      .where("id", "=", second.upload.uploadId)
      .executeTakeFirst(),
  ).toEqual({ state: "verified" });
  expect(await getRun(db, x.ctx, second.run.id)).toMatchObject({ state: "ready", lastError: null });
  expect((await getLatestVersion(db, x.ctx, copy.id))?.model.summary[0]).toMatchObject({
    evidence: "audio",
  });
  expect((await allowance(db, x.ctx)).consumed.audio).toBe(charged);
});

it("D59 keeps the upload bound to the run's own open reservation", async () => {
  const x = await studyFixture(db);
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  const bytes = new Uint8Array([0x49, 0x44, 0x33]);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    kind: "audio",
    mimeType: "audio/mpeg",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Synthetic unconfirmed.mp3",
    durationMs: 2000,
    parts: [],
    operationKey: randomUUID(),
  });
  // A reservation id that is not an open hold of this learner still refuses the start.
  await expect(
    beginTemporaryAudioUpload(db, x.ctx, source.assetId, {
      reservationId: randomUUID(),
      parts: [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }],
    }),
  ).rejects.toMatchObject({
    code: "validation_failed",
    details: { fields: { reservation: ["confirmed_processing_required"] } },
  });
});

it("FR-SRC-007 names an expired awaiting run by what reached the server, not as rejected audio", async () => {
  const x = await studyFixture(db);
  await acceptSourceNotice(db, x.ctx, "0.1", true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 3600000),
    amounts: amounts({ audio: 10, regeneration: 2 }),
    operationKey: randomUUID(),
    actorId: "synthetic",
    reason: "Synthetic upload expiry codes",
  });
  const provider = syntheticProvider();
  const job = processingJob({ provider, store: new MemoryObjectStore() });
  const bytes = new Uint8Array([0x49, 0x44, 0x33]);
  async function awaiting(started: boolean) {
    const session = await createSession(db, x.ctx, {}, { key: randomUUID() });
    const source = await createSource(db, x.ctx, {
      sessionId: session.id,
      kind: "audio",
      mimeType: "audio/mpeg",
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      displayName: "Synthetic expiry.mp3",
      durationMs: 2000,
      parts: [],
      operationKey: randomUUID(),
    });
    const run = await createProcessingRun(
      db,
      x.ctx,
      { sessionId: session.id, operationKey: randomUUID() },
      { provider, job },
    );
    if (started)
      await beginTemporaryAudioUpload(db, x.ctx, source.assetId, {
        reservationId: run.reservationId,
        parts: [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }],
      });
    return run;
  }
  const never = await awaiting(false);
  const partial = await awaiting(true);
  const contract = await readInputContract(db, "1");
  await expireAwaitingUploads(db, new Date(Date.now() + contract.uploadTtlSeconds * 1000 + 1000));
  expect(await getRun(db, x.ctx, never.id)).toMatchObject({
    state: "needs_input",
    lastError: "audio_upload_not_started",
  });
  expect(await getRun(db, x.ctx, partial.id)).toMatchObject({
    state: "needs_input",
    lastError: "audio_upload_incomplete",
  });
});
