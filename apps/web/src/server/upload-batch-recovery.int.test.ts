import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { type JobContext, MemoryObjectStore, readPltSettings, sha256Hex } from "@recalino/core/plt";
import {
  beginAutomaticLearningBatch,
  cancelAutomaticLearningBatch,
  getAutomaticLearningSession,
  registerAutomaticLearningFile,
} from "@recalino/core/proc";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import {
  acceptSourceNotice,
  confirmUploadPart,
  createSource,
  readInputContract,
  uploadPartLink,
} from "@recalino/core/src";
import { afterAll, expect, it, vi } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import { scheduleAutomaticLearning } from "./automatic-learning";
import { sourceUploadJobDefinition } from "./source-jobs";
import { sourcesHandler } from "./source-routes";

const memory = vi.hoisted(() => ({ store: null as MemoryObjectStore | null }));
vi.mock("./storage", () => ({ getObjectStore: () => memory.store }));
const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 3 });
afterAll(() => db.destroy());

it("recovers fully received bytes after a lost final upload request, verifies them, and seals the declared batch on the server", async () => {
  const x = await studyFixture(db),
    now = new Date(),
    batchId = randomUUID(),
    fileId = randomUUID();
  memory.store = new MemoryObjectStore();
  const contract = await readInputContract(db);
  await acceptSourceNotice(db, x.ctx, contract.noticeVersion, true);
  await grantEntitlement(db, {
    userId: x.ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 60_000),
    amounts: amounts({ storage: 10000 }),
    operationKey: randomUUID(),
    actorId: "synthetic-batch-operator",
    reason: "Local upload recovery test",
  });
  await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, now, [fileId]);
  const bytes = new TextEncoder().encode("Synthetic background handout"),
    sha256 = sha256Hex(bytes);
  const source = await createSource(db, x.ctx, {
    sessionId: x.session.id,
    operationKey: randomUUID(),
    kind: "text",
    mimeType: "text/plain",
    sizeBytes: bytes.length,
    sha256,
    displayName: "Background handout.txt",
    parts: [{ index: 0, sizeBytes: bytes.length, sha256 }],
  });
  if (!source.uploadId) throw new Error("Synthetic source upload missing");
  await registerAutomaticLearningFile(db, x.ctx, x.session.id, {
    batchId,
    fileId,
    sourceId: source.assetId,
  });
  const jobs = () =>
    db
      .selectFrom("plt.job")
      .select("id")
      .where("kind", "=", "src.verify_upload")
      .where("payload", "@>", JSON.stringify({ uploadId: source.uploadId }))
      .execute();
  await scheduleAutomaticLearning(db, x.ctx, x.session.id, { changed: false, now });
  expect(await jobs()).toEqual([]);
  const link = await uploadPartLink(
    db,
    memory.store,
    x.ctx,
    source.uploadId,
    0,
    readPltSettings().storage,
  );
  expect(memory.store.upload(link.url, bytes, "text/plain")).toBe(200);
  await confirmUploadPart(db, memory.store, x.ctx, source.uploadId, 0);
  // The browser closes here. It sends neither /upload/complete nor /learning complete.
  await scheduleAutomaticLearning(db, x.ctx, x.session.id, { changed: false, now });
  await scheduleAutomaticLearning(db, x.ctx, x.session.id, { changed: false, now });
  expect(await jobs()).toHaveLength(1);
  expect((await getAutomaticLearningSession(db, x.ctx, x.session.id))?.batchId).toBe(batchId);
  const definition = sourceUploadJobDefinition();
  if (!definition) throw new Error("Synthetic verifier missing");
  const context: JobContext = {
    db,
    now: () => now,
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran",
  };
  await definition.run({ userId: x.ctx.userId, uploadId: source.uploadId }, context);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toMatchObject({
    batchId: null,
    lastBatchId: batchId,
    requestedVersion: null,
  });
  // D105: a sealed upload group waits for the learner's Process this session; no lesson job.
  expect(
    await db
      .selectFrom("plt.job")
      .select("id")
      .where("kind", "=", "proc.automatic_learning")
      .where("payload", "@>", JSON.stringify({ sessionId: x.session.id }))
      .execute(),
  ).toEqual([]);
});

it("atomically binds source creation to a declared file and rolls back a late creation after cancellation", async () => {
  const x = await studyFixture(db),
    batchId = randomUUID(),
    fileId = randomUUID();
  await acceptSourceNotice(db, x.ctx, (await readInputContract(db)).noticeVersion, true);
  await beginAutomaticLearningBatch(db, x.ctx, x.session.id, batchId, new Date(), [fileId]);
  const create = (key: string) =>
    sourcesHandler()({
      db,
      ctx: { ...x.ctx, route: "sources" },
      request: new Request("https://recalino.test/api/sources", {
        method: "POST",
        headers: { "idempotency-key": key },
      }),
      input: {
        sessionId: x.session.id,
        batchId,
        fileId,
        kind: "audio",
        mimeType: "audio/webm",
        sizeBytes: 3,
        sha256: "a".repeat(64),
        displayName: "Synthetic audio.webm",
        durationMs: 1000,
        parts: [],
      },
    });
  const created = await create(randomUUID());
  expect(created.status).toBe(201);
  expect((await getAutomaticLearningSession(db, x.ctx, x.session.id))?.batchFiles).toEqual([
    expect.objectContaining({
      fileId,
      sourceId: (created.body as { assetId: string }).assetId,
      acknowledged: false,
    }),
  ]);
  await cancelAutomaticLearningBatch(db, x.ctx, x.session.id, batchId);
  const lateKey = randomUUID();
  await expect(create(lateKey)).rejects.toMatchObject({ code: "conflict" });
  expect(
    await db
      .selectFrom("src.asset")
      .select("id")
      .where("user_id", "=", x.ctx.userId)
      .where("operation_key", "=", lateKey)
      .execute(),
  ).toEqual([]);
  expect(await getAutomaticLearningSession(db, x.ctx, x.session.id)).toMatchObject({
    state: "blocked",
    lastError: "upload_batch_cancelled",
    batchId: null,
  });
});
