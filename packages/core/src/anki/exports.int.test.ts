import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { MemoryObjectStore, readOwnedObject } from "../plt";
import {
  ankiExportJob,
  cleanupAnkiExports,
  getAnkiExport,
  requestAnkiExport,
  tombstoneAccountAnkiExports,
} from "./exports";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());
const settings = { version: "test-1", maxBytes: 1000000, maxItems: 1000, retentionSeconds: 3600 };
it("exports a pinned card snapshot without scheduling, checks ownership and cleans private package bytes", async () => {
  const [x, other] = await Promise.all([studyFixture(db), studyFixture(db)]);
  const input = {
    sessionId: x.session.id,
    cardIds: x.cards.map((c) => c.id),
    tags: ["synthetic"],
    includeMedia: false,
  };
  const key = randomUUID();
  const artifact = await requestAnkiExport(db, x.ctx, input, { key, settings });
  expect(await requestAnkiExport(db, x.ctx, input, { key, settings })).toEqual(artifact);
  await expect(
    requestAnkiExport(db, other.ctx, input, { key: randomUUID(), settings }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(getAnkiExport(db, other.ctx, artifact.id)).rejects.toMatchObject({
    code: "not_found",
  });
  const store = new MemoryObjectStore();
  await ankiExportJob(store).run(
    { userId: x.ctx.userId, artifactId: artifact.id },
    { db, now: () => new Date(), job: { id: randomUUID(), attempt: 1 }, step: async () => "ran" },
  );
  expect((await getAnkiExport(db, x.ctx, artifact.id)).state).toBe("ready");
  const row = await db
    .selectFrom("anki.export_artifact")
    .selectAll()
    .where("id", "=", artifact.id)
    .executeTakeFirstOrThrow();
  if (!row.object_id) throw new Error("Ready export object is missing");
  expect(
    unzipSync(await readOwnedObject(db, store, x.ctx, row.object_id))["collection.anki2"],
  ).toBeDefined();
  expect(JSON.stringify(row.snapshot)).not.toMatch(/fsrs|due_at|review_event|scheduling/);
  await db.transaction().execute((tx) => tombstoneAccountAnkiExports(tx, x.ctx));
  await cleanupAnkiExports(db, store, x.ctx);
  await expect(getAnkiExport(db, x.ctx, artifact.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(readOwnedObject(db, store, x.ctx, row.object_id)).rejects.toMatchObject({
    code: "not_found",
  });
});
