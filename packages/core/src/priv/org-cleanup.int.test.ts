import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, expect, it, onTestFinished, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { createDatabase } from "../db";
import { getSession, updateSession } from "../org";
import {
  type ClaimedJob,
  claimJobs,
  completeJob,
  enqueueJob,
  type JobContext,
  readPltSettings,
  renewJobLease,
  runJobStep,
} from "../plt";
import {
  getPrivacyDeletionRequest,
  type PrivacyDependencies,
  privacyCleanupJob,
  requestSessionDeletion,
} from "./deletion";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());

/**
 * P12-09 AC-14: a real claim of a job of its own queue kind for this receipt, so the handler runs
 * with a valid lease from the job layer; the claim ends when the test finishes.
 */
async function claimedCleanup(
  dependencies: PrivacyDependencies,
  payload: { userId: string; requestId: string },
): Promise<ClaimedJob> {
  const kind = `priv.synthetic_${randomUUID().replaceAll("-", "")}`;
  const jobId = await db
    .transaction()
    .execute((tx) =>
      enqueueJob(
        tx,
        { ...privacyCleanupJob(dependencies), kind, options: { leaseSeconds: 300 } },
        { payload, now: new Date(), defaults: readPltSettings().jobs },
      ),
    );
  const [claimed] = await claimJobs(db, [kind], 1, new Date());
  if (!jobId || !claimed || claimed.id !== jobId)
    throw new Error("Expected the cleanup job's claim");
  const claimedPayload = claimed.payload as Partial<typeof payload>;
  if (claimedPayload.userId !== payload.userId || claimedPayload.requestId !== payload.requestId)
    throw new Error("Expected the cleanup job's payload");
  onTestFinished(async () => {
    await completeJob(db, claimed, new Date());
  });
  return claimed;
}

/** What the runner gives a handler for this claim (runDueJobs builds the same context). */
function contextOf(claimed: ClaimedJob): JobContext {
  if (claimed.generation === undefined) throw new Error("Expected a lease generation");
  return {
    db,
    now: () => new Date(),
    job: { id: claimed.id, attempt: claimed.attempt },
    lease: { id: claimed.id, token: claimed.token, generation: claimed.generation },
    step: (name, effect) => runJobStep(db, claimed, name, effect, new Date()),
  };
}

/** A live runner renews its lease before the next run (ADR-0004 rule 5). */
async function renewClaim(claimed: ClaimedJob) {
  if (!(await renewJobLease(db, claimed, new Date())))
    throw new Error("Expected the cleanup job's lease to renew");
}

it("PRD-DEL-01 and FR-PLT-002: the ORG finalizer retries an older registry without erasing another owner", async () => {
  const own = await studyFixture(db, { count: 0 });
  const other = await studyFixture(db, { count: 0 });
  await updateSession(db, own.ctx, own.session.id, {
    title: "Private historical deletion title",
    classDate: "2026-10-01",
  });
  await updateSession(db, other.ctx, other.session.id, { title: "Other owner's private class" });
  const cleanup = vi.fn(async () => {});
  const journal = vi.fn(async () => {});
  // Completed historical module checkpoints do not include the new ORG finalizer.
  const dependencies: PrivacyDependencies = {
    deletionJournal: { record: journal },
    hooks: [
      {
        module: "legacy",
        async tombstoneSession() {},
        cleanupSession: cleanup,
        async cleanupAccount() {},
      },
    ],
  };
  const receipt = await requestSessionDeletion(
    db,
    own.ctx,
    own.session.id,
    randomUUID(),
    dependencies,
  );
  const claimed = await claimedCleanup(dependencies, {
    userId: own.ctx.userId,
    requestId: receipt.id,
  });
  const job = contextOf(claimed);
  // Simulate inconsistent stored receipt metadata, never an allowed learner mutation.
  await db
    .updateTable("priv.deletion_request")
    .set({ subject_id: other.session.id })
    .where("id", "=", receipt.id)
    .execute();
  await expect(
    privacyCleanupJob(dependencies).run({ userId: own.ctx.userId, requestId: receipt.id }, job),
  ).rejects.toMatchObject({ code: "not_found" });
  expect((await getPrivacyDeletionRequest(db, own.ctx, receipt.id)).state).toBe("needs_operator");
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(journal).toHaveBeenCalled();
  expect((await getSession(db, other.ctx, other.session.id)).title).toBe(
    "Other owner's private class",
  );
  expect(
    await db
      .selectFrom("org.class_session")
      .select("title")
      .where("id", "=", own.session.id)
      .executeTakeFirstOrThrow(),
  ).toEqual({ title: "Private historical deletion title" });
  await db
    .updateTable("priv.deletion_request")
    .set({ subject_id: own.session.id })
    .where("id", "=", receipt.id)
    .execute();
  await renewClaim(claimed);
  await privacyCleanupJob(dependencies).run({ userId: own.ctx.userId, requestId: receipt.id }, job);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect((await getPrivacyDeletionRequest(db, own.ctx, receipt.id)).state).toBe("completed");
  expect(
    await db
      .selectFrom("org.class_session")
      .select(["title", "course_id", "unit_id", sql<string>`class_date::text`.as("classDate")])
      .where("id", "=", own.session.id)
      .executeTakeFirstOrThrow(),
  ).toEqual({ title: null, course_id: null, unit_id: null, classDate: "1970-01-01" });
  expect((await getSession(db, other.ctx, other.session.id)).title).toBe(
    "Other owner's private class",
  );
});
