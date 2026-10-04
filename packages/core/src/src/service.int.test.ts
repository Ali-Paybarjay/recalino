import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../acc";
import { createDatabase } from "../db";
import { createSession } from "../org";
import { DEFAULT_PLT_SETTINGS, MemoryObjectStore } from "../plt";
import { allowance, amounts, grantEntitlement } from "../quota";
import { cleanupDeletedSource } from "./privacy";
import {
  acceptSourceNotice,
  appendContentVersion,
  attachSource,
  confirmUploadPart,
  createSource,
  deleteSource,
  detachSource,
  getSource,
  selectSourceSnapshot,
  sourceAssets,
  sourceContentVersions,
  sourceReadLink,
  updateSourceSelection,
  uploadPartLink,
  verifyUpload,
} from "./service";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
async function fixture() {
  const userId = await createAuthUser(),
    ctx = { userId, requestId: randomUUID() },
    now = new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 60, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  for (const change of [
    { field: "first_language", firstLanguage: "fa" },
    { field: "explanation_language", explanationLanguage: "english" },
    { field: "level_goal", level: null, goal: null },
    { field: "timezone", timezone: "Europe/London" },
  ] as const)
    await updateProfile(db, ctx, change, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  const session = await createSession(db, ctx, {}, { key: randomUUID() });
  await grantEntitlement(db, {
    userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ storage: 1000000 }),
    operationKey: randomUUID(),
    actorId: "synthetic-operator",
    reason: "SRC synthetic tests",
  });
  await acceptSourceNotice(db, ctx, "0.1", true);
  return { ctx, session };
}
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function upload() {
  const { ctx, session } = await fixture(),
    bytes = new TextEncoder().encode("Synthetic lesson\n\nA second paragraph."),
    raw = {
      sessionId: session.id,
      kind: "text",
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      sha256: hash(bytes),
      displayName: "lesson.txt",
      parts: [{ index: 0, sizeBytes: bytes.length, sha256: hash(bytes) }],
      operationKey: randomUUID(),
    };
  const source = await createSource(db, ctx, raw),
    store = new MemoryObjectStore();
  if (!source.uploadId) throw new Error("missing upload");
  const link = await uploadPartLink(
    db,
    store,
    ctx,
    source.uploadId,
    0,
    DEFAULT_PLT_SETTINGS.storage,
  );
  expect(store.upload(link.url, bytes, "text/plain")).toBe(200);
  await confirmUploadPart(db, store, ctx, source.uploadId, 0);
  await verifyUpload(db, store, ctx, source.uploadId);
  return { ctx, session, source, store, raw, bytes };
}
describe("source ownership history and private originals (FR-SRC-001,004,005,009,010,013)", () => {
  it("confirms an existing pending generic part while keeping expired and foreign requests denied", async () => {
    const x = await fixture(),
      foreign = await fixture(),
      store = new MemoryObjectStore();
    const bytes = new TextEncoder().encode("Synthetic existing upload part");
    const source = await createSource(db, x.ctx, {
      sessionId: x.session.id,
      kind: "text",
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      sha256: hash(bytes),
      displayName: "resume.txt",
      operationKey: randomUUID(),
      parts: [{ index: 0, sizeBytes: bytes.length, sha256: hash(bytes) }],
    });
    if (!source.uploadId) throw new Error("missing_upload");
    const link = await uploadPartLink(
      db,
      store,
      x.ctx,
      source.uploadId,
      0,
      DEFAULT_PLT_SETTINGS.storage,
    );
    expect(store.upload(link.url, bytes, "text/plain")).toBe(200);
    expect(await confirmUploadPart(db, store, x.ctx, source.uploadId, 0)).toBe("verified");
    expect(await confirmUploadPart(db, store, x.ctx, source.uploadId, 0)).toBe("verified");
    await expect(
      confirmUploadPart(db, store, foreign.ctx, source.uploadId, 0),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      confirmUploadPart(
        db,
        store,
        x.ctx,
        source.uploadId,
        0,
        new Date(Date.now() + 48 * 3600 * 1000),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("physically purges deleted source bytes and metadata without changing another owner's sources", async () => {
    const x = await upload(),
      other = await upload();
    const object = await getSource(db, x.ctx, x.source.assetId);
    const read = await sourceReadLink(
      db,
      x.store,
      x.ctx,
      x.source.assetId,
      DEFAULT_PLT_SETTINGS.storage,
    );
    await expect(
      cleanupDeletedSource(db, x.store, other.ctx, x.source.assetId),
    ).rejects.toMatchObject({ code: "not_found" });
    await deleteSource(db, x.ctx, x.source.assetId, "all");
    await cleanupDeletedSource(db, x.store, x.ctx, x.source.assetId);
    await cleanupDeletedSource(db, x.store, x.ctx, x.source.assetId);
    expect(x.store.download(read.url).status).toBe(404);
    expect(object.original_object_id).toBeTruthy();
    expect((await allowance(db, x.ctx)).remaining.storage).toBe(1000000);
    const erased = await db
      .selectFrom("src.asset")
      .selectAll()
      .where("id", "=", x.source.assetId)
      .executeTakeFirstOrThrow();
    expect(erased.display_name).toBe("Deleted source");
    expect(erased.sha256).toBe("0".repeat(64));
    expect(
      await db
        .selectFrom("src.content_version")
        .select("id")
        .where("asset_id", "=", erased.id)
        .execute(),
    ).toEqual([]);
    expect((await selectSourceSnapshot(db, other.ctx, other.session.id)).sources).toHaveLength(1);
  });
  it("charges one upload once, retries without duplication and emits immutable text versions", async () => {
    const x = await upload();
    expect((await allowance(db, x.ctx)).consumed.storage).toBe(x.bytes.length);
    expect((await createSource(db, x.ctx, x.raw)).assetId).toBe(x.source.assetId);
    await verifyUpload(db, x.store, x.ctx, x.source.uploadId as string);
    expect(await sourceContentVersions(db, x.ctx, x.source.assetId)).toHaveLength(1);
    expect(
      (await selectSourceSnapshot(db, x.ctx, x.session.id)).sources[0]?.contentVersionId,
    ).toBeTruthy();
    const link = await sourceReadLink(
      db,
      x.store,
      x.ctx,
      x.source.assetId,
      DEFAULT_PLT_SETTINGS.storage,
    );
    expect(x.store.download(link.url).bytes).toEqual(x.bytes);
  });
  it("hides every foreign asset, file URL, attachment and immutable version", async () => {
    const x = await upload(),
      other = await fixture();
    await expect(getSource(db, other.ctx, x.source.assetId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      sourceReadLink(db, x.store, other.ctx, x.source.assetId, DEFAULT_PLT_SETTINGS.storage),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      attachSource(db, other.ctx, other.session.id, x.source.assetId),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(sourceContentVersions(db, other.ctx, x.source.assetId)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await sourceAssets(db, other.ctx, x.raw.sha256)).toHaveLength(0);
  });
  it("retains snapshots when detached and keeps originals independent from content", async () => {
    const x = await upload(),
      before = await selectSourceSnapshot(db, x.ctx, x.session.id);
    await updateSourceSelection(db, x.ctx, x.session.id, x.source.assetId, {
      role: "user_notes",
      selected: true,
      ranges: [],
      timeStatus: "unknown",
      contentVersionId: before.sources[0]?.contentVersionId,
    });
    await deleteSource(db, x.ctx, x.source.assetId, "original");
    await expect(
      sourceReadLink(db, x.store, x.ctx, x.source.assetId, DEFAULT_PLT_SETTINGS.storage),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await sourceContentVersions(db, x.ctx, x.source.assetId)).toHaveLength(1);
    await detachSource(db, x.ctx, x.session.id, x.source.assetId);
    const stored = await db
      .selectFrom("src.source_snapshot")
      .select("sources")
      .where("session_id", "=", x.session.id)
      .where("sources_version", "=", before.sourcesVersion)
      .executeTakeFirst();
    expect(stored).toBeTruthy();
    const first = await deleteSource(db, x.ctx, x.source.assetId, "all"),
      second = await deleteSource(db, x.ctx, x.source.assetId, "all");
    expect(first).toEqual(second);
    await expect(getSource(db, x.ctx, x.source.assetId)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("preserves old content and rejects altered retries of the same origin", async () => {
    const x = await upload(),
      input = {
        originKey: randomUUID(),
        schemaVersion: "1",
        provenance: "user_correction",
        settings: {},
        units: [{ id: "d", kind: "document", start: 1 }],
        blocks: [{ id: "p", kind: "paragraph", text: "Corrected synthetic text", unitId: "d" }],
      };
    const id = await db
      .transaction()
      .execute((tx) => appendContentVersion(tx, x.ctx, x.source.assetId, input));
    expect(
      await db
        .transaction()
        .execute((tx) => appendContentVersion(tx, x.ctx, x.source.assetId, input)),
    ).toBe(id);
    await expect(
      db.transaction().execute((tx) =>
        appendContentVersion(tx, x.ctx, x.source.assetId, {
          ...input,
          blocks: [{ ...input.blocks[0], text: "Changed" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    expect(await sourceContentVersions(db, x.ctx, x.source.assetId)).toHaveLength(2);
  });
});
