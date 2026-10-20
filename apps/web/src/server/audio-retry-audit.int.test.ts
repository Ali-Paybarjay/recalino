import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { MemoryObjectStore, writeOwnedObject } from "@recalino/core/plt";
import {
  expireAwaitingUploads,
  failAwaitingUploadRun,
  getRun,
  requestAutomaticLearning,
  requestAutomaticProcessing,
  updateAutomaticLearningProgress,
} from "@recalino/core/proc";
import { allowance } from "@recalino/core/quota";
import { IDBFactory } from "fake-indexeddb";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { workspaceRequest } from "../ui/workspace/api";
import {
  type AutomaticLearningStatus,
  uploadAutomaticAudio,
} from "../ui/workspace/automatic-learning";
import { automaticLearningRecovery } from "../ui/workspace/automatic-learning-recovery";
import { sessionNextStep } from "../ui/workspace/session-state";
import { uploadCopy } from "../ui/workspace/upload-copy";
import {
  auditAudio,
  auditClass,
  auditConfirmedRun,
  auditContract,
  auditFetch,
  auditJobContext,
  auditLearner,
  auditProcess,
  auditProvider,
  auditRecordings,
  auditSource,
} from "./audio-audit-support";
import { automaticLearningSync } from "./automatic-learning";
import { getProcessingDefinition } from "./processing-jobs";
import { sourceAudioJobDefinition } from "./source-jobs";

// Same stand-ins as audio-upload-audit.int.test.ts: the store, the provider, the decoder and
// the PUT transport. Routes, tables, jobs and the automatic learning service are real.
const synthetic = vi.hoisted(() => ({
  store: null as MemoryObjectStore | null,
  provider: null as unknown,
  durationMs: 4000,
}));
vi.mock("./storage", () => ({ getObjectStore: () => synthetic.store }));
vi.mock("./jobs", () => ({
  PROCESSING_WAKE: { budgetSeconds: 600, functionSeconds: 800 },
  runJobsSoon: () => {},
}));
vi.mock("./ai", () => ({ getAiProvider: () => synthetic.provider }));
vi.mock("./audio-preparer", async (original) => ({
  ...(await original<object>()),
  audioVerifier: () => ({
    inspect: async () => ({ durationMs: synthetic.durationMs, audioOnly: true }),
  }),
  prepareAudio: async ({
    db,
    store,
    ctx,
    runId,
    source,
    now,
  }: {
    db: Parameters<typeof writeOwnedObject>[0];
    store: MemoryObjectStore;
    ctx: { userId: string; requestId: string };
    runId: string;
    source: { sourceId: string };
    now: Date;
  }) => [
    {
      id: `${runId}-0`,
      sourceId: source.sourceId,
      objectId: await writeOwnedObject(db, store, ctx, {
        module: "src",
        retention: "temporary",
        contentType: "audio/mpeg",
        bytes: auditAudio(3),
        now,
      }),
      offsetMs: 0,
      durationMs: synthetic.durationMs,
      format: "mp3",
    },
  ],
}));
vi.mock("../ui/workspace/upload-progress", () => ({
  uploadWithProgress: async (
    url: string,
    body: Blob,
    contentType: string,
    onProgress: (sent: number, total: number) => void,
  ) => {
    const bytes = new Uint8Array(await body.arrayBuffer());
    const status = synthetic.store?.upload(url, bytes, contentType) ?? 503;
    if (status === 200) onProgress(bytes.length, bytes.length);
    return { ok: status === 200, status };
  },
}));

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
afterAll(() => db.destroy());
let currentUser: string | null = null;
beforeEach(() => {
  synthetic.store = new MemoryObjectStore();
  synthetic.provider = auditProvider();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal(
    "fetch",
    auditFetch(db, () => currentUser),
  );
});
afterEach(() => vi.unstubAllGlobals());
const bytes = auditAudio(3);

/** Class A pays for the audio once (D59); every later class in the period reserves audio=0. */
async function paidOnce(learner: Awaited<ReturnType<typeof auditLearner>>) {
  const processing = getProcessingDefinition();
  if (!processing) throw new Error("processing unavailable");
  const options = { provider: auditProvider(), job: processing };
  const source = await auditSource(db, learner.ctx, learner.session.id, bytes);
  const run = await auditConfirmedRun(db, learner.ctx, learner.session.id, options);
  await deviceUpload(learner, learner.session.id, source.assetId, run.id);
  await verifyAndProcess(learner, run.id);
  expect((await getRun(db, learner.ctx, run.id)).state).toBe("ready");
  const charged = (await allowance(db, learner.ctx)).consumed.audio;
  expect(charged).toBe(4);
  return { options, charged };
}
async function deviceUpload(
  learner: Awaited<ReturnType<typeof auditLearner>>,
  sessionId: string,
  sourceId: string,
  runId: string,
) {
  const read = await workspaceRequest<{
    run: Parameters<typeof uploadAutomaticAudio>[0];
    snapshot: Parameters<typeof uploadAutomaticAudio>[1];
  }>(`/api/runs/${runId}?includeSnapshot=1`, "GET");
  await uploadAutomaticAudio(read.run, read.snapshot, await auditContract(db), {
    userId: learner.userId,
    store: auditRecordings(learner.userId, sessionId, [{ sourceId, bytes }]),
  });
}
async function verifyAndProcess(learner: Awaited<ReturnType<typeof auditLearner>>, runId: string) {
  const jobs = await db
    .selectFrom("plt.job")
    .select("payload")
    .where("kind", "=", "src.verify_audio")
    .where("state", "=", "queued")
    .execute();
  const definition = sourceAudioJobDefinition();
  if (!definition) throw new Error("verifier unavailable");
  for (const job of jobs) {
    const payload = job.payload as {
      userId: string;
      assetId: string;
      uploadId: string;
      runId: string;
    };
    if (payload.runId !== runId) continue;
    await definition.run(payload, auditJobContext(db));
    await db
      .updateTable("plt.job")
      .set({ state: "succeeded" })
      .where("kind", "=", "src.verify_audio")
      .where("payload", "=", JSON.stringify(payload))
      .execute()
      .catch(() => {});
  }
  const processing = getProcessingDefinition();
  if (!processing) throw new Error("processing unavailable");
  return auditProcess(db, learner.ctx, runId, (payload, context) =>
    processing.run(payload, context),
  );
}
const learning = (sessionId: string) =>
  workspaceRequest<AutomaticLearningStatus>(`/api/classes/${sessionId}/learning`, "GET");
const retry = (sessionId: string) =>
  workspaceRequest<AutomaticLearningStatus>(
    `/api/classes/${sessionId}/learning`,
    "POST",
    { action: "retry" },
    randomUUID(),
  );

it("shape (a): a run the old sweep closed as audio_upload_rejected, with no upload row, reads as not started and Retry failed attempt brings the class to ready without a charge", async () => {
  const learner = await auditLearner(db);
  currentUser = learner.userId;
  const { options, charged } = await paidOnce(learner);
  const classB = await auditClass(db, learner.ctx);
  const source = await auditSource(db, learner.ctx, classB.id, bytes);
  const stuck = await auditConfirmedRun(db, learner.ctx, classB.id, options);
  // The production shape of 572dda3f / f36401c8 on 2026-10-12: needs_input + rejected, the
  // automatic class blocked with the same code, nothing in src.audio_upload.
  await failAwaitingUploadRun(db, learner.ctx, stuck.id, "audio_upload_rejected");
  await requestAutomaticLearning(db, learner.ctx, classB.id, { changed: true });
  // D105: the stuck run was the learner's request (Process this session).
  const intent = await requestAutomaticProcessing(db, learner.ctx, classB.id);
  await updateAutomaticLearningProgress(db, learner.ctx, classB.id, intent.requestVersion, {
    state: "blocked",
    lastError: "audio_upload_rejected",
    runId: stuck.id,
  });
  const before = await learning(classB.id);
  expect(before).toMatchObject({
    state: "blocked",
    lastError: "audio_upload_not_started",
    message: uploadCopy.automatic.notStarted,
  });
  expect(before.message).not.toMatch(/could not be verified/);
  expect(automaticLearningRecovery(before).retryLabel).toBe("Retry failed attempt");
  expect(sessionNextStep({ sessionId: classB.id, status: before }).primary).toMatchObject({
    id: "retry_processing",
    label: "Retry failed attempt",
  });
  // The learner presses Retry failed attempt: the real route creates the new run.
  const retried = await retry(classB.id);
  expect(retried).toMatchObject({ state: "waiting_upload" });
  const run = retried.run;
  if (run?.state !== "awaiting_upload") throw new Error("expected a new awaiting run");
  expect(run.id).not.toBe(stuck.id);
  const reserved = await db
    .selectFrom("proc.processing_run")
    .select("requested_amounts")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  expect(reserved.requested_amounts).toMatchObject({ audio: 0 });
  // The device starts the upload (the loop test proves the ≤ 6 s window) and the class finishes.
  await deviceUpload(learner, classB.id, source.assetId, run.id);
  await verifyAndProcess(learner, run.id);
  expect(await learning(classB.id)).toMatchObject({ state: "ready", notesReady: true });
  expect((await allowance(db, learner.ctx)).consumed.audio).toBe(charged);
  expect(
    await db
      .selectFrom("src.audio_upload")
      .select("id")
      .where("asset_id", "=", source.assetId)
      .execute(),
  ).toHaveLength(1);
});

it("shape (b): a run whose upload lapsed (not started, then incomplete) is retried from the UI path to ready", async () => {
  const learner = await auditLearner(db);
  currentUser = learner.userId;
  const { options, charged } = await paidOnce(learner);
  const contract = await auditContract(db);
  for (const started of [false, true]) {
    const klass = await auditClass(db, learner.ctx);
    const source = await auditSource(db, learner.ctx, klass.id, bytes);
    const lapsed = await auditConfirmedRun(db, learner.ctx, klass.id, options);
    if (started)
      await workspaceRequest(`/api/sources/${source.assetId}/audio`, "POST", {
        action: "start",
        runId: lapsed.id,
        reservationId: lapsed.reservationId,
        parts: [
          {
            index: 0,
            sizeBytes: bytes.length,
            sha256: (await import("@recalino/core/plt")).sha256Hex(bytes),
          },
        ],
      });
    await expireAwaitingUploads(db, new Date(Date.now() + contract.uploadTtlSeconds * 1000 + 1000));
    const code = started ? "audio_upload_incomplete" : "audio_upload_not_started";
    expect(await getRun(db, learner.ctx, lapsed.id)).toMatchObject({
      state: "needs_input",
      lastError: code,
    });
    // The reconciler records the stop on the class, as it does after every expiry. D105: the
    // lapsed run was the learner's request (Process this session).
    await requestAutomaticProcessing(db, learner.ctx, klass.id);
    const synced = await automaticLearningSync(db, learner.ctx, klass.id, {
      dependencies: { provider: () => options.provider, processing: () => options.job },
    });
    expect(synced).toMatchObject({ state: "blocked", lastError: code });
    const before = await learning(klass.id);
    expect(before.message).toBe(
      started ? uploadCopy.automatic.incomplete : uploadCopy.automatic.notStarted,
    );
    expect(sessionNextStep({ sessionId: klass.id, status: before }).primary).toMatchObject({
      id: "retry_processing",
    });
    const retried = await retry(klass.id);
    const run = retried.run;
    if (run?.state !== "awaiting_upload") throw new Error("expected a new awaiting run");
    await deviceUpload(learner, klass.id, source.assetId, run.id);
    await verifyAndProcess(learner, run.id);
    expect(await learning(klass.id)).toMatchObject({ state: "ready" });
    expect((await allowance(db, learner.ctx)).consumed.audio).toBe(charged);
  }
});
