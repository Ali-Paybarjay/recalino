import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { createObject, MemoryObjectStore, sha256Hex, writeOwnedObject } from "@recalino/core/plt";
import { cancelRun, expireAwaitingUploads, getRun } from "@recalino/core/proc";
import { allowance } from "@recalino/core/quota";
import { beginTemporaryAudioUpload } from "@recalino/core/src";
import { IDBFactory } from "fake-indexeddb";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { pendingCopy } from "../ui/pending-copy";
import { type WorkspaceRequestError, workspaceRequest } from "../ui/workspace/api";
import { uploadAutomaticAudio } from "../ui/workspace/automatic-learning";
import { ManualAudioManager } from "../ui/workspace/manual-audio-manager";
import { IndexedManualAudioStore } from "../ui/workspace/manual-audio-store";
import { AudioUploadProblem, audioUploadProblem } from "../ui/workspace/upload-problems";
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
import { getProcessingDefinition } from "./processing-jobs";
import { sourceAudioJobDefinition } from "./source-jobs";

// The designated test store (FR-PLT-014 rule 2), the synthetic provider and a decoder stand in
// for the three external services; every route, table and job definition is the real one.
const synthetic = vi.hoisted(() => ({
  store: null as MemoryObjectStore | null,
  provider: null as unknown,
  durationMs: 4000,
  beforePut: null as null | ((url: string) => Promise<void>),
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
    await synthetic.beforePut?.(url);
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
  synthetic.beforePut = null;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal(
    "fetch",
    auditFetch(db, () => currentUser),
  );
});
afterEach(() => vi.unstubAllGlobals());

const bytes = auditAudio(3);
const api = (path: string, method: string, body?: unknown, key?: string) =>
  workspaceRequest<Record<string, unknown>>(path, method, body, key);
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error as WorkspaceRequestError,
  );
async function uploadRows(assetId: string) {
  return db
    .selectFrom("src.audio_upload")
    .select(["id", "state", "reservation_id", "transcribed_at", "expires_at", "verified_at"])
    .where("asset_id", "=", assetId)
    .orderBy("created_at")
    .execute();
}
async function verifyQueued(expected: { assetId: string; uploadId: string; runId: string }) {
  const jobs = await db
    .selectFrom("plt.job")
    .select(["id", "payload", "singleton_key"])
    .where("kind", "=", "src.verify_audio")
    .where("singleton_key", "=", `audio:${expected.uploadId}`)
    .execute();
  expect(jobs).toHaveLength(1);
  const payload = jobs[0]?.payload as {
    userId: string;
    assetId: string;
    uploadId: string;
    runId: string;
  };
  expect(payload).toMatchObject(expected);
  const definition = sourceAudioJobDefinition();
  if (!definition) throw new Error("verifier unavailable");
  await definition.run(payload, auditJobContext(db));
}
async function finishRun(ctx: { userId: string; requestId: string }, runId: string) {
  const processing = getProcessingDefinition();
  if (!processing) throw new Error("processing unavailable");
  return auditProcess(db, ctx, runId, (payload, context) => processing.run(payload, context));
}

describe("audit 1: D59 end to end through the real route handlers", () => {
  it("class B with class A's paid audio (hold audio=0) uploads through ManualAudioManager, verifies, transcribes and publishes without a second charge", async () => {
    const learner = await auditLearner(db);
    currentUser = learner.userId;
    const contract = await auditContract(db);
    const provider = auditProvider();
    const processing = getProcessingDefinition();
    if (!processing) throw new Error("processing unavailable");
    const options = { provider, job: processing };
    async function sendThroughManager(sessionId: string) {
      const source = await auditSource(db, learner.ctx, sessionId, bytes);
      const run = await auditConfirmedRun(db, learner.ctx, sessionId, options);
      const recordings = auditRecordings(learner.userId, sessionId, [
        { sourceId: source.assetId, bytes },
      ]);
      const manager = new ManualAudioManager(
        learner.userId,
        new IndexedManualAudioStore(),
        recordings as never,
        { allowed: () => true },
      );
      const started = vi.spyOn(manager, "kick").mockResolvedValue();
      const snapshot = (await api(`/api/runs/${run.id}?includeSnapshot=1`, "GET"))
        .snapshot as Parameters<ManualAudioManager["enqueue"]>[1];
      await manager.enqueue(run, snapshot, contract);
      started.mockRestore();
      await manager.kick();
      const saved = manager.snapshot().find((entry) => entry.runId === run.id);
      // Uploaded and completed; the activation waits for the verifier (upload: incomplete).
      expect(saved).toMatchObject({ phase: "verifying", problem: null });
      const rows = await uploadRows(source.assetId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: "pending", reservation_id: run.reservationId });
      await verifyQueued({ assetId: source.assetId, uploadId: rows[0]?.id ?? "", runId: run.id });
      expect((await getRun(db, learner.ctx, run.id)).state).toBe("queued");
      // The queue is re-checked after the server's own activation: the saved entry settles.
      await manager.kick();
      expect(manager.snapshot().some((entry) => entry.runId === run.id)).toBe(false);
      const finished = await finishRun(learner.ctx, run.id);
      expect(finished).toMatchObject({ state: "ready", lastError: null });
      const [upload] = await uploadRows(source.assetId);
      expect(upload).toMatchObject({ state: "verified" });
      // D29: the server copy is marked transcribed and expires within 24 hours of that.
      expect(upload?.transcribed_at).toBeInstanceOf(Date);
      expect(
        (upload?.expires_at.getTime() ?? 0) - (upload?.transcribed_at?.getTime() ?? 0),
      ).toBeLessThanOrEqual(24 * 3600 * 1000);
      return { run, source };
    }
    const first = await sendThroughManager(learner.session.id);
    const charged = (await allowance(db, learner.ctx)).consumed.audio;
    expect(charged).toBe(4);
    const classB = await auditClass(db, learner.ctx);
    const second = await sendThroughManager(classB.id);
    const reserved = await db
      .selectFrom("proc.processing_run")
      .select("requested_amounts")
      .where("id", "=", second.run.id)
      .executeTakeFirstOrThrow();
    expect(reserved.requested_amounts).toMatchObject({ audio: 0 });
    expect(await uploadRows(second.source.assetId)).toHaveLength(1);
    expect((await allowance(db, learner.ctx)).consumed.audio).toBe(charged);
    expect(first.run.id).not.toBe(second.run.id);
  });

  it("still refuses another learner's hold, a closed hold, a run that is not awaiting upload and a source outside the run", async () => {
    const alice = await auditLearner(db);
    const bob = await auditLearner(db);
    const provider = auditProvider();
    const processing = getProcessingDefinition();
    if (!processing) throw new Error("processing unavailable");
    const options = { provider, job: processing };
    const aliceSource = await auditSource(db, alice.ctx, alice.session.id, bytes);
    const aliceRun = await auditConfirmedRun(db, alice.ctx, alice.session.id, options);
    const bobSource = await auditSource(db, bob.ctx, bob.session.id, bytes);
    const bobRun = await auditConfirmedRun(db, bob.ctx, bob.session.id, options);
    const parts = [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }];
    const start = (assetId: string, runId: string, reservationId: string) =>
      failure(
        api(`/api/sources/${assetId}/audio`, "POST", {
          action: "start",
          runId,
          reservationId,
          parts,
        }),
      );
    currentUser = alice.userId;
    // Another learner's hold: the run binds its own hold, so the start is refused as invalid.
    expect(await start(aliceSource.assetId, aliceRun.id, bobRun.reservationId)).toMatchObject({
      status: 400,
      fields: { audio: ["confirmed_processing_required"] },
    });
    await expect(
      beginTemporaryAudioUpload(db, alice.ctx, aliceSource.assetId, {
        reservationId: bobRun.reservationId,
        parts,
      }),
    ).rejects.toMatchObject({
      details: { fields: { reservation: ["confirmed_processing_required"] } },
    });
    // A source the run never confirmed.
    const other = await auditSource(db, alice.ctx, alice.session.id, auditAudio(5));
    expect(await start(other.assetId, aliceRun.id, aliceRun.reservationId)).toMatchObject({
      status: 400,
      fields: { audio: ["confirmed_processing_required"] },
    });
    // Another learner's run and source: hidden, never refused with a reason.
    currentUser = bob.userId;
    expect(await start(aliceSource.assetId, aliceRun.id, aliceRun.reservationId)).toMatchObject({
      status: 404,
    });
    expect(await start(bobSource.assetId, aliceRun.id, aliceRun.reservationId)).toMatchObject({
      status: 404,
    });
    // A closed hold: cancelling the run releases it, and the run leaves awaiting_upload.
    currentUser = alice.userId;
    await cancelRun(db, alice.ctx, aliceRun.id);
    expect(await start(aliceSource.assetId, aliceRun.id, aliceRun.reservationId)).toMatchObject({
      status: 400,
      fields: { audio: ["confirmed_processing_required"] },
    });
    await expect(
      beginTemporaryAudioUpload(db, alice.ctx, aliceSource.assetId, {
        reservationId: aliceRun.reservationId,
        parts,
      }),
    ).rejects.toMatchObject({
      details: { fields: { reservation: ["confirmed_processing_required"] } },
    });
    expect(await uploadRows(aliceSource.assetId)).toEqual([]);
  });
});

describe("audit 2: every rejection on the start, part and complete paths", () => {
  async function awaiting() {
    const learner = await auditLearner(db);
    currentUser = learner.userId;
    const provider = auditProvider();
    const processing = getProcessingDefinition();
    if (!processing) throw new Error("processing unavailable");
    const source = await auditSource(db, learner.ctx, learner.session.id, bytes);
    const run = await auditConfirmedRun(db, learner.ctx, learner.session.id, {
      provider,
      job: processing,
    });
    const parts = [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }];
    const path = `/api/sources/${source.assetId}/audio`;
    const start = (manifest: unknown = parts) =>
      api(path, "POST", {
        action: "start",
        runId: run.id,
        reservationId: run.reservationId,
        parts: manifest,
      });
    return { learner, source, run, parts, path, start };
  }

  it("start: malformed body, unknown run, missing store, invalid manifests and a changed manifest", async () => {
    const x = await awaiting();
    const contract = await auditContract(db);
    expect(await failure(x.start([]))).toMatchObject({ status: 400 });
    expect(
      await failure(
        api(x.path, "POST", {
          action: "start",
          runId: randomUUID(),
          reservationId: x.run.reservationId,
          parts: x.parts,
        }),
      ),
    ).toMatchObject({ status: 404 });
    const store = synthetic.store;
    synthetic.store = null;
    // Server configuration, never a client state: no file store is connected.
    expect(await failure(x.start())).toMatchObject({
      status: 400,
      fields: { storage: ["unavailable"] },
    });
    synthetic.store = store;
    for (const manifest of [
      [{ index: 0, sizeBytes: bytes.length + 1, sha256: sha256Hex(bytes) }],
      [{ index: 1, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }],
      [
        { index: 0, sizeBytes: 1, sha256: sha256Hex(bytes.subarray(0, 1)) },
        { index: 1, sizeBytes: bytes.length - 1, sha256: sha256Hex(bytes.subarray(1)) },
      ],
      [{ index: 0, sizeBytes: contract.partBytes + 1, sha256: sha256Hex(bytes) }],
    ])
      expect(await failure(x.start(manifest))).toMatchObject({
        status: 400,
        fields: { parts: ["invalid_manifest"] },
      });
    const started = (await x.start()) as { uploadId: string };
    // The same start twice is one upload; a different manifest for the same hold is refused.
    expect(await x.start()).toMatchObject({ uploadId: started.uploadId });
    const changed = await failure(
      x.start([{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(auditAudio(3).fill(1)) }]),
    );
    expect(changed).toMatchObject({ status: 422, code: "idempotency_mismatch" });
    expect(audioUploadProblem(changed)).toMatchObject({ reason: "integrity_mismatch" });
    expect(await uploadRows(x.source.assetId)).toHaveLength(1);
  });

  it("start: a deleted original, a cancelled run and a hidden source", async () => {
    const x = await awaiting();
    await db
      .updateTable("src.asset")
      .set({ original_deleted_at: new Date() })
      .where("id", "=", x.source.assetId)
      .execute();
    const deleted = await failure(x.start());
    expect(deleted).toMatchObject({ status: 409, code: "conflict" });
    // The client names it as a closed upload, with no retry that would hit the same answer.
    expect(audioUploadProblem(deleted)).toMatchObject({
      reason: "upload_closed",
      message: pendingCopy.uploadReliability.audio.uploadClosed,
    });
    await db
      .updateTable("src.asset")
      .set({ original_deleted_at: null })
      .where("id", "=", x.source.assetId)
      .execute();
    await cancelRun(db, x.learner.ctx, x.run.id);
    const cancelled = await failure(x.start());
    expect(cancelled).toMatchObject({
      status: 400,
      fields: { audio: ["confirmed_processing_required"] },
    });
    expect(audioUploadProblem(cancelled)).toMatchObject({ reason: "upload_closed" });
    currentUser = randomUUID();
    expect(await failure(x.start())).toMatchObject({ status: 404 });
  });

  it("part: missing bytes, corrupted bytes, a fresh link after the corruption, index out of range, a finished or expired upload", async () => {
    const x = await awaiting();
    const started = (await x.start()) as { uploadId: string };
    const confirm = () =>
      api(x.path, "POST", {
        action: "confirm_part",
        runId: x.run.id,
        uploadId: started.uploadId,
        index: 0,
      });
    // Before any PUT: not an error, the client sends the part.
    expect(await confirm()).toEqual({ confirmed: false });
    expect(
      await failure(api(`${x.path}?uploadId=${started.uploadId}&index=7`, "GET")),
    ).toMatchObject({ status: 404 });
    const link = (await api(`${x.path}?uploadId=${started.uploadId}&index=0`, "GET")) as {
      url: string;
    };
    // Bytes corrupted in transit: the same size and type, another checksum.
    expect(synthetic.store?.upload(link.url, auditAudio(3).fill(9), "audio/mpeg")).toBe(200);
    const corrupt = await failure(confirm());
    expect(corrupt).toMatchObject({ status: 400, fields: { audio: ["part_integrity_mismatch"] } });
    // Retryable by design: the client asks for a fresh link and sends the part again.
    expect(audioUploadProblem(corrupt)).toBe(corrupt);
    const fresh = (await api(`${x.path}?uploadId=${started.uploadId}&index=0`, "GET")) as {
      url: string;
    };
    expect(synthetic.store?.upload(fresh.url, bytes, "audio/mpeg")).toBe(200);
    expect(await confirm()).toEqual({ confirmed: true });
    expect(await confirm()).toEqual({ confirmed: true });
    await api(x.path, "POST", { action: "complete", runId: x.run.id, uploadId: started.uploadId });
    await verifyQueued({ assetId: x.source.assetId, uploadId: started.uploadId, runId: x.run.id });
    // A verified upload issues no more write links; the client reads "verified" and skips it.
    const done = await failure(api(`${x.path}?uploadId=${started.uploadId}&index=0`, "GET"));
    expect(done).toMatchObject({ status: 409 });
    expect(await api(`${x.path}?uploadId=${started.uploadId}`, "GET")).toMatchObject({
      state: "verified",
    });
    // An expired upload (24 h) is closed for parts and completion alike.
    const y = await awaiting();
    const late = (await y.start()) as { uploadId: string };
    await db
      .updateTable("src.audio_upload")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("id", "=", late.uploadId)
      .execute();
    const expired = await failure(api(`${y.path}?uploadId=${late.uploadId}&index=0`, "GET"));
    expect(expired).toMatchObject({ status: 409 });
    expect(audioUploadProblem(expired)).toMatchObject({ reason: "upload_closed" });
  });

  it("complete: a staged capture copy, a missing verifier, a repeated completion and a hidden upload", async () => {
    const x = await awaiting();
    const started = (await x.start()) as { uploadId: string };
    const link = (await api(`${x.path}?uploadId=${started.uploadId}&index=0`, "GET")) as {
      url: string;
    };
    expect(synthetic.store?.upload(link.url, bytes, "audio/mpeg")).toBe(200);
    const complete = () =>
      api(x.path, "POST", { action: "complete", runId: x.run.id, uploadId: started.uploadId });
    const store = synthetic.store;
    synthetic.store = null;
    expect(await failure(complete())).toMatchObject({
      status: 400,
      fields: { audio: ["verifier_unavailable"] },
    });
    synthetic.store = store;
    const first = (await complete()) as { jobId: string | null };
    expect(first.jobId).toEqual(expect.any(String));
    // Completing again queues nothing new: one verification job per upload.
    expect(((await complete()) as { jobId: string | null }).jobId).toBeNull();
    expect(
      await db
        .selectFrom("plt.job")
        .select("id")
        .where("kind", "=", "src.verify_audio")
        .where("singleton_key", "=", `audio:${started.uploadId}`)
        .execute(),
    ).toHaveLength(1);
    // A staged capture copy (D60) has no hold; this route never completes it. The row is written
    // directly: staging itself needs a capture lease, which the recording workstream covers.
    const stagedObject = await createObject(db, {
      module: "src",
      ownerUserId: x.learner.userId,
      retention: "temporary",
      contentType: "audio/mpeg",
      sizeBytes: bytes.length,
      now: new Date(),
    });
    const staged = await db
      .insertInto("src.audio_upload")
      .values({
        user_id: x.learner.userId,
        asset_id: x.source.assetId,
        reservation_id: null,
        staged_at: new Date(),
        object_id: stagedObject.id,
        expires_at: new Date(Date.now() + 3600_000),
        created_at: new Date(),
      } as never)
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(
      await failure(
        api(x.path, "POST", { action: "complete", runId: x.run.id, uploadId: staged.id }),
      ),
    ).toMatchObject({ status: 400, fields: { audio: ["confirmed_processing_required"] } });
    currentUser = randomUUID();
    expect(await failure(complete())).toMatchObject({ status: 404 });
    expect(await failure(api(`${x.path}?uploadId=${started.uploadId}`, "GET"))).toMatchObject({
      status: 404,
    });
  });
});

describe("audit 7: invariants the route must keep", () => {
  it("idempotent start, part confirmation and completion when the client repeats a request", async () => {
    const learner = await auditLearner(db);
    currentUser = learner.userId;
    const provider = auditProvider();
    const processing = getProcessingDefinition();
    if (!processing) throw new Error("processing unavailable");
    const source = await auditSource(db, learner.ctx, learner.session.id, bytes);
    const run = await auditConfirmedRun(db, learner.ctx, learner.session.id, {
      provider,
      job: processing,
    });
    const recordings = auditRecordings(learner.userId, learner.session.id, [
      { sourceId: source.assetId, bytes },
    ]);
    const snapshot = (await api(`/api/runs/${run.id}?includeSnapshot=1`, "GET")).snapshot as never;
    const contract = await auditContract(db);
    const send = () =>
      uploadAutomaticAudio(run, snapshot, contract, { userId: learner.userId, store: recordings });
    await send();
    // The same client transfer again: the upload row, its part and its job are reused.
    await send();
    const rows = await uploadRows(source.assetId);
    expect(rows).toHaveLength(1);
    expect(
      await db
        .selectFrom("src.audio_upload_part")
        .select("part_index")
        .where("upload_id", "=", rows[0]?.id ?? "")
        .execute(),
    ).toHaveLength(1);
    expect(
      await db
        .selectFrom("plt.job")
        .select("id")
        .where("kind", "=", "src.verify_audio")
        .where("singleton_key", "=", `audio:${rows[0]?.id}`)
        .execute(),
    ).toHaveLength(1);
  });

  it("a lapsed upload is never charged, and a rejected copy expires at once for the sweep", async () => {
    const learner = await auditLearner(db);
    currentUser = learner.userId;
    const provider = auditProvider();
    const processing = getProcessingDefinition();
    if (!processing) throw new Error("processing unavailable");
    const source = await auditSource(db, learner.ctx, learner.session.id, bytes);
    const run = await auditConfirmedRun(db, learner.ctx, learner.session.id, {
      provider,
      job: processing,
    });
    const before = await allowance(db, learner.ctx);
    expect(before.reserved.audio).toBe(4);
    const contract = await auditContract(db);
    await expireAwaitingUploads(db, new Date(Date.now() + contract.uploadTtlSeconds * 1000 + 1000));
    expect(await getRun(db, learner.ctx, run.id)).toMatchObject({
      state: "needs_input",
      lastError: "audio_upload_not_started",
    });
    const after = await allowance(db, learner.ctx);
    expect(after.consumed.audio).toBe(before.consumed.audio);
    expect(after.reserved.audio).toBe(0);
    // A verifier rejection: the copy is marked rejected with an immediate expiry (FR-SRC-007).
    const other = await auditClass(db, learner.ctx);
    const rejectedSource = await auditSource(db, learner.ctx, other.id, bytes);
    const rejectedRun = await auditConfirmedRun(db, learner.ctx, other.id, {
      provider,
      job: processing,
    });
    const recordings = auditRecordings(learner.userId, other.id, [
      { sourceId: rejectedSource.assetId, bytes },
    ]);
    const snapshot = (await api(`/api/runs/${rejectedRun.id}?includeSnapshot=1`, "GET"))
      .snapshot as never;
    await uploadAutomaticAudio(rejectedRun, snapshot, contract, {
      userId: learner.userId,
      store: recordings,
    });
    const [upload] = await uploadRows(rejectedSource.assetId);
    synthetic.durationMs = Number.NaN;
    await expect(
      verifyQueued({
        assetId: rejectedSource.assetId,
        uploadId: upload?.id ?? "",
        runId: rejectedRun.id,
      }),
    ).rejects.toMatchObject({ code: "unsupported_media" });
    synthetic.durationMs = 4000;
    const [rejected] = await uploadRows(rejectedSource.assetId);
    expect(rejected?.state).toBe("rejected");
    expect(rejected?.expires_at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await getRun(db, learner.ctx, rejectedRun.id)).toMatchObject({
      state: "needs_input",
      lastError: "audio_upload_rejected",
    });
    expect((await allowance(db, learner.ctx)).consumed.audio).toBe(before.consumed.audio);
  });

  it("a server refusal the client cannot fix is an AudioUploadProblem, never a retry loop", async () => {
    const learner = await auditLearner(db);
    currentUser = learner.userId;
    const provider = auditProvider();
    const processing = getProcessingDefinition();
    if (!processing) throw new Error("processing unavailable");
    const source = await auditSource(db, learner.ctx, learner.session.id, bytes);
    const run = await auditConfirmedRun(db, learner.ctx, learner.session.id, {
      provider,
      job: processing,
    });
    const recordings = auditRecordings(learner.userId, learner.session.id, [
      { sourceId: source.assetId, bytes },
    ]);
    const snapshot = (await api(`/api/runs/${run.id}?includeSnapshot=1`, "GET")).snapshot as never;
    const contract = await auditContract(db);
    await cancelRun(db, learner.ctx, run.id);
    const problem = await uploadAutomaticAudio(run, snapshot, contract, {
      userId: learner.userId,
      store: recordings,
    }).catch((error: unknown) => error);
    expect(problem).toBeInstanceOf(AudioUploadProblem);
    expect(problem).toMatchObject({ reason: "upload_closed" });
    expect(await uploadRows(source.assetId)).toEqual([]);
  });
});
