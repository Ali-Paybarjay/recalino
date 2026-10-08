import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import {
  createObject,
  DEFAULT_PLT_SETTINGS,
  deleteObject,
  issueWriteLink,
  MemoryObjectStore,
  runDueJobs,
} from "../plt";
import {
  getPrivacyDeletionRequest,
  type PrivacyDependencies,
  privacyCleanupJob,
  requestSessionDeletion,
} from "./deletion";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());

it("PRD-DEL-01 completes physical deletion only after old PUT leases expire and recreated bytes are removed", async () => {
  const f = await studyFixture(db);
  let now = f.now;
  const store = new MemoryObjectStore(() => now);
  const object = await createObject(db, {
    module: "src",
    ownerUserId: f.ctx.userId,
    retention: "temporary",
    contentType: "text/plain",
    sizeBytes: 9,
    now,
  });
  const link = await issueWriteLink(db, store, f.ctx, object.id, {
    now,
    settings: DEFAULT_PLT_SETTINGS.storage,
  });
  const bytes = new TextEncoder().encode("Synthetic");
  expect(store.upload(link.url, bytes, "text/plain")).toBe(200);
  const deps: PrivacyDependencies = {
    deletionJournal: { async record() {} },
    hooks: [
      {
        module: "src",
        async tombstoneSession() {},
        async cleanupSession(database, ctx, _session, time) {
          await deleteObject(database, store, ctx, object.id, time);
        },
        async cleanupAccount() {},
      },
    ],
  };
  const receipt = await requestSessionDeletion(db, f.ctx, f.session.id, randomUUID(), deps, now);
  await deleteObject(db, store, f.ctx, object.id, now);
  expect(store.upload(link.url, bytes, "text/plain")).toBe(200);
  const run = () =>
    runDueJobs(db, [privacyCleanupJob(deps)], {
      kinds: ["priv.cleanup"],
      now: () => now,
      deadline: new Date(now.getTime() + 1000),
    });
  await run();
  expect((await getPrivacyDeletionRequest(db, f.ctx, receipt.id)).state).toBe("pending");
  expect(await store.head(object.key)).not.toBeNull();
  now = new Date(link.validUntil.getTime() + 1);
  expect(store.upload(link.url, bytes, "text/plain")).toBe(403);
  await run();
  expect((await getPrivacyDeletionRequest(db, f.ctx, receipt.id)).state).toBe("completed");
  expect(await store.head(object.key)).toBeNull();
});
