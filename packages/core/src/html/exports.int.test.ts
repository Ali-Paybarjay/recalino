import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { DEFAULT_PLT_SETTINGS, MemoryObjectStore, readOwnedObject } from "../plt";
import {
  cleanupHtmlExports,
  getHtmlExport,
  htmlExportJob,
  htmlExportReadLink,
  requestHtmlExport,
  tombstoneSessionHtmlExports,
} from "./exports";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());
const settings = { version: "test-1", maxBytes: 1000000, maxItems: 1000, retentionSeconds: 3600 };
it("pins immutable notebook content, isolates private artifacts and purges physical bytes after tombstone", async () => {
  const x = await studyFixture(db),
    other = await studyFixture(db),
    key = randomUUID(),
    store = new MemoryObjectStore();
  const input = { revisionId: x.notebook.current.id, mediaIds: [] };
  const artifact = await requestHtmlExport(db, x.ctx, input, { key, settings });
  expect(await requestHtmlExport(db, x.ctx, input, { key, settings })).toEqual(artifact);
  await expect(
    requestHtmlExport(
      db,
      x.ctx,
      { revisionId: other.notebook.current.id, mediaIds: [] },
      { key, settings },
    ),
  ).rejects.toMatchObject({ code: "idempotency_mismatch" });
  await expect(getHtmlExport(db, other.ctx, artifact.id)).rejects.toMatchObject({
    code: "not_found",
  });
  await htmlExportJob(store).run(
    { userId: x.ctx.userId, artifactId: artifact.id },
    { db, now: () => new Date(), job: { id: randomUUID(), attempt: 1 }, step: async () => "ran" },
  );
  const ready = await getHtmlExport(db, x.ctx, artifact.id);
  expect(ready.state).toBe("ready");
  expect(ready.actualBytes).toBeGreaterThan(0);
  const row = await db
    .selectFrom("html.export_artifact")
    .selectAll()
    .where("id", "=", artifact.id)
    .executeTakeFirstOrThrow();
  if (!row.object_id) throw new Error("Ready export object is missing");
  const bytes = await readOwnedObject(db, store, x.ctx, row.object_id);
  expect(new TextDecoder().decode(bytes)).toContain("Synthetic study fixture");
  await expect(
    htmlExportReadLink(db, store, other.ctx, artifact.id, DEFAULT_PLT_SETTINGS.storage),
  ).rejects.toMatchObject({ code: "not_found" });
  await db.transaction().execute((tx) => tombstoneSessionHtmlExports(tx, x.ctx, x.session.id));
  await cleanupHtmlExports(db, store, x.ctx, { sessionId: x.session.id });
  await expect(getHtmlExport(db, x.ctx, artifact.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(readOwnedObject(db, store, x.ctx, row.object_id)).rejects.toMatchObject({
    code: "not_found",
  });
  expect(
    (
      await db
        .selectFrom("html.export_artifact")
        .select("snapshot")
        .where("id", "=", artifact.id)
        .executeTakeFirstOrThrow()
    ).snapshot,
  ).toBeNull();
});
it("fails closed on absent media authorization and caller-supplied size overflow", async () => {
  const x = await studyFixture(db);
  await expect(
    requestHtmlExport(
      db,
      x.ctx,
      { revisionId: x.notebook.current.id, mediaIds: [randomUUID()] },
      { key: randomUUID(), settings },
    ),
  ).rejects.toMatchObject({ code: "validation_failed" });
  await expect(
    requestHtmlExport(
      db,
      x.ctx,
      { revisionId: x.notebook.current.id },
      { key: randomUUID(), settings: { ...settings, maxBytes: 10 } },
    ),
  ).rejects.toMatchObject({ code: "payload_too_large" });
});
