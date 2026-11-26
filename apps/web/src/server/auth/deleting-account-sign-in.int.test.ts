import { randomBytes, randomUUID } from "node:crypto";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "@recalino/core/acc";
import { createDatabase, type Database } from "@recalino/core/db";
import { appendEncryptedDeletionJournal, readEncryptedDeletionJournals } from "@recalino/core/ops";
import { createSession } from "@recalino/core/org";
import {
  type ClaimedJob,
  claimJobs,
  completeJob,
  enqueueJob,
  isTestOnlyJobContext,
  type JobContext,
  jobState,
  MemoryObjectStore,
  type RunSummary,
  readPltSettings,
  renewJobLease,
  runDueJobs,
  runJobStep,
  sweepJobs,
} from "@recalino/core/plt";
import {
  type DeletionJournalRecordOptions,
  getPrivacyDeletionRequest,
  type PrivacyDependencies,
  persistDeletionJournal,
  privacyCleanupJob,
  requestSessionDeletion,
} from "@recalino/core/priv";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createAuthUser } from "../../../../../packages/core/test/auth-users";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { privacyDeletionJournal } from "../privacy-journal";

// P12-09 AC-4, AC-7 (d) and AC-12 (P12-03 F-9, R2-P1209-01): the privacy cleanup writes its
// journal, its cleanup steps and its request state only with its job's authority. These tests are
// here because a test under packages/core/src/ops may not import PRIV (capability-map-ops); they
// drive the privacy cleanup through the real job layer. The AC-12 tests write the journal through
// the production adapter (privacy-journal.ts) and the real journal write, with a synthetic key and
// a memory store, so no fake journal hides a refusal further down.

const web = vi.hoisted(() => ({
  database: undefined as Database | undefined,
  store: undefined as MemoryObjectStore | undefined,
}));
vi.mock("../db", () => ({ getDatabase: () => web.database }));
vi.mock("../storage", () => ({ getObjectStore: () => web.store }));
vi.mock("@recalino/core/ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@recalino/core/ops")>();
  return {
    ...actual,
    appendEncryptedDeletionJournal: vi.fn(actual.appendEncryptedDeletionJournal),
  };
});

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(async () => {
  await db.destroy();
});

/** Requests are made far ahead, so no other test's privacy runner finds their queued job due. */
const FAR_MS = 60 * 365 * 24 * 3600 * 1000;

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

/** Waits for the lease to end on the database clock, as when a worker stalls, then sweeps. */
async function sweepUntilReturned(jobId: string) {
  for (let tries = 0; tries < 80; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await sweepJobs(db, new Date());
    if ((await jobState(db, jobId)) === "retry_scheduled") return;
  }
  throw new Error("The synthetic lease did not end");
}

/** A ready account with one class, and that class's deletion request; its own job is far ahead. */
async function sessionDeletion(dependencies: PrivacyDependencies) {
  const userId = await createAuthUser();
  const ctx = { userId, requestId: randomUUID() };
  const now = new Date();
  const intent = await createSignupIntent(db, {
    versions: CURRENT_VERSIONS,
    ttlSeconds: 60,
    now,
  });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  // A ready account, as packages/core/src/org/org.int.test.ts:35-57 prepares one: a session can
  // be created only once the setup is complete (requireReadyAccount, org/common.ts:18-26).
  await updateProfile(db, ctx, { field: "first_language", firstLanguage: "fa" }, { now });
  await updateProfile(
    db,
    ctx,
    { field: "explanation_language", explanationLanguage: "english" },
    { now },
  );
  await updateProfile(db, ctx, { field: "level_goal", level: null, goal: null }, { now });
  await updateProfile(db, ctx, { field: "timezone", timezone: "Europe/London" }, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  const session = await createSession(db, ctx, {}, { key: randomUUID(), now });
  const request = await requestSessionDeletion(
    db,
    ctx,
    session.id,
    randomUUID(),
    dependencies,
    new Date(Date.now() + FAR_MS),
  );
  return { userId, ctx, session, request, payload: { requestId: request.id, userId } };
}

/** The request's cleanup on a queue kind of its own, so no other runner claims it. */
async function cleanupJobOf(
  dependencies: PrivacyDependencies,
  payload: { requestId: string; userId: string },
  leaseSeconds: number,
) {
  const kind = `priv.synthetic_${randomUUID().replaceAll("-", "")}`;
  const jobId = await db
    .transaction()
    .execute((tx) =>
      enqueueJob(
        tx,
        { ...privacyCleanupJob(dependencies), kind, options: { leaseSeconds, maxAttempts: 5 } },
        { payload, now: new Date(), defaults: readPltSettings().jobs },
      ),
    );
  if (!jobId) throw new Error("Expected the cleanup job");
  return { kind, jobId };
}

async function claimOf(kind: string, jobId: string): Promise<ClaimedJob> {
  const [claimed] = await claimJobs(db, [kind], 1, new Date());
  if (!claimed || claimed.id !== jobId) throw new Error("Expected the cleanup job's claim");
  return claimed;
}

describe("privacy cleanup under the job's authority (P12-09 AC-4, AC-7)", () => {
  it("privacy cleanup: a stale worker cannot move a completed request to needs_operator", async () => {
    const store = new MemoryObjectStore();
    const encryption = { keyId: "synthetic-stale-cleanup", key: randomBytes(32) };
    const recorded: (DeletionJournalRecordOptions | undefined)[] = [];
    let queue: { kind: string; jobId: string } | undefined;
    let reclaimed: RunSummary | undefined;
    let cleanups = 0;
    const dependencies: PrivacyDependencies = {
      deletionJournal: {
        async record(entry, options) {
          recorded.push(options);
          await appendEncryptedDeletionJournal(db, store, encryption, entry, undefined, options);
        },
      },
      hooks: [
        {
          module: "synthetic_stale_cleanup",
          tombstoneSession: async () => {},
          cleanupAccount: async () => {},
          async cleanupSession() {
            cleanups += 1;
            if (cleanups > 1 || !queue) return;
            // Worker A stalls in its module cleanup: its lease ends, the sweep returns the job,
            // and worker B claims and completes it through the runner. Then A's module fails.
            await sweepUntilReturned(queue.jobId);
            const definition = { ...privacyCleanupJob(dependencies), kind: queue.kind };
            reclaimed = await runDueJobs(db, [definition], {
              kinds: [queue.kind],
              deadline: new Date(Date.now() + 10_000),
            });
            throw new Error("Synthetic module failure after the job was reclaimed");
          },
        },
      ],
    };
    const { userId, ctx, session, request, payload } = await sessionDeletion(dependencies);
    // The request's cleanup on a queue kind of its own, with a short lease, claimed by A.
    const { kind, jobId } = await cleanupJobOf(dependencies, payload, 3);
    queue = { kind, jobId };
    const claimA = await claimOf(kind, jobId);
    const workerA = contextOf(claimA);

    await expect(privacyCleanupJob(dependencies).run(payload, workerA)).rejects.toMatchObject({
      name: "JobLeaseLost",
    });
    expect(cleanups).toBe(2);
    expect(reclaimed).toMatchObject({ succeeded: 1, failed: 0, retried: 0 });
    expect(await jobState(db, jobId)).toBe("succeeded");
    // B completed the request; A's failure changed nothing after it.
    const after = await getPrivacyDeletionRequest(db, ctx, request.id);
    expect(after).toMatchObject({ state: "completed", lastError: null });
    expect(after.completedAt).not.toBeNull();
    // A wrote the journal while its claim held, with its own job (AC-1); B found it recorded.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.job).toBe(workerA);
    expect(
      await readEncryptedDeletionJournals(store, new Map([[encryption.keyId, encryption.key]])),
    ).toEqual([
      {
        requestId: request.id,
        userId,
        kind: "session",
        subjectId: session.id,
        relatedSessions: [],
        requestedAt: request.requestedAt,
      },
    ]);
  });
});

// P12-09 AC-12 (R2-P1209-01): the journal store and key of the production adapter below.
const journalStore = new MemoryObjectStore();
const journalKey = { keyId: "synthetic-cleanup-authority", key: randomBytes(32) };
web.database = db;
web.store = journalStore;
const journalEnv = {
  RECALINO_BACKUP_KEY_ID: journalKey.keyId,
  RECALINO_BACKUP_KEY_BASE64: Buffer.from(journalKey.key).toString("base64"),
};

/**
 * The server's privacy journal adapter as production builds it, with one synthetic module. Each
 * `record` call's options are kept, by identity, before the real adapter runs.
 */
function authorityDependencies() {
  const production = privacyDeletionJournal(journalEnv);
  const recorded: (DeletionJournalRecordOptions | undefined)[] = [];
  const cleanups: string[] = [];
  const dependencies: PrivacyDependencies = {
    deletionJournal: {
      async record(entry, options) {
        recorded.push(options);
        await production.record(entry, options);
      },
    },
    hooks: [
      {
        module: "synthetic_cleanup_authority",
        tombstoneSession: async () => {},
        cleanupAccount: async () => {},
        async cleanupSession(_db, _ctx, sessionId) {
          cleanups.push(sessionId);
        },
      },
    ],
  };
  return { dependencies, recorded, cleanups };
}

/** Every effect of this card for one request: journal row and object, steps, request state. */
async function cleanupEffects(requestId: string) {
  const journal = await db
    .selectFrom("ops.deletion_journal")
    .select(["state", "object_id"])
    .where("request_id", "=", requestId)
    .executeTakeFirst();
  const object = journal?.object_id
    ? await db
        .selectFrom("plt.storage_object")
        .select("state")
        .where("id", "=", journal.object_id)
        .executeTakeFirst()
    : undefined;
  const steps = await db
    .selectFrom("priv.cleanup_step")
    .select("module")
    .where("request_id", "=", requestId)
    .execute();
  const request = await db
    .selectFrom("priv.deletion_request")
    .select(["state", "last_error", "completed_at"])
    .where("id", "=", requestId)
    .executeTakeFirstOrThrow();
  const stored = (
    await readEncryptedDeletionJournals(journalStore, new Map([[journalKey.keyId, journalKey.key]]))
  ).filter((entry) => entry.requestId === requestId);
  const appends = vi
    .mocked(appendEncryptedDeletionJournal)
    .mock.calls.filter((call) => (call[3] as { requestId?: string }).requestId === requestId);
  return {
    journal: journal ? { state: journal.state, object: object?.state ?? null } : null,
    stored: stored.length,
    appends,
    steps: steps.map((step) => step.module),
    request,
  };
}

/** Real renewals while `work` runs, as a live runner keeps its short lease (ADR-0004 rule 5). */
async function whileRenewing<T>(claimed: ClaimedJob, work: () => Promise<T>): Promise<T> {
  let renewal: Promise<boolean> = Promise.resolve(true);
  const timer = setInterval(() => {
    renewal = renewJobLease(db, claimed, new Date());
  }, 1000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    await renewal;
  }
}

describe("privacy cleanup refuses a context without authority (P12-09 AC-12, R2-P1209-01)", () => {
  it("privacy cleanup: a Job context without a lease is refused before it writes the journal, the cleanup step or the state", async () => {
    const { dependencies, recorded, cleanups } = authorityDependencies();
    const { payload } = await sessionDeletion(dependencies);
    // A context made by hand: no lease and no test-only mark, as the old direct calls built it.
    const withoutLease: JobContext = {
      db,
      now: () => new Date(),
      job: { id: randomUUID(), attempt: 1 },
      step: async (_name, effect) => {
        await db.transaction().execute(effect);
        return "ran";
      },
    };
    expect(withoutLease.lease).toBeUndefined();
    expect(isTestOnlyJobContext(withoutLease)).toBe(false);
    const before = await cleanupEffects(payload.requestId);
    expect(before).toMatchObject({ journal: null, stored: 0, appends: [], steps: [] });

    await expect(privacyCleanupJob(dependencies).run(payload, withoutLease)).rejects.toMatchObject({
      name: "JobLeaseLost",
    });
    // Nothing was recorded, cleaned, stepped or moved; the failure wrote no needs_operator.
    expect(recorded).toEqual([]);
    expect(cleanups).toEqual([]);
    const after = await cleanupEffects(payload.requestId);
    expect(after).toEqual(before);
    expect(after.request.state).not.toBe("needs_operator");
    expect(after.request.state).not.toBe("completed");
  });

  it("privacy cleanup: the API path without a Job still records its journal", async () => {
    const { dependencies, recorded, cleanups } = authorityDependencies();
    const { ctx, request } = await sessionDeletion(dependencies);
    const before = await cleanupEffects(request.id);
    expect(before.journal).toBeNull();

    // The API acknowledgement, outside any job: no context is made, faked or stripped.
    await persistDeletionJournal(db, ctx, request.id, dependencies);
    expect(recorded).toEqual([undefined]);
    const after = await cleanupEffects(request.id);
    expect(after.journal).toEqual({ state: "ready", object: "verified" });
    expect(after.stored).toBe(1);
    // The production adapter wrote with no job: the job-less API write, as before.
    expect(after.appends).toHaveLength(1);
    expect(after.appends[0]?.[5]).toEqual({});
    // Recording the journal is not the cleanup: no step and the same request state.
    expect(cleanups).toEqual([]);
    expect(after.steps).toEqual([]);
    expect(after.request).toEqual(before.request);
  });

  it("privacy cleanup: a valid claim records the journal with its Job and completes the request", async () => {
    const { dependencies, recorded, cleanups } = authorityDependencies();
    const { ctx, session, request, payload } = await sessionDeletion(dependencies);
    const { kind, jobId } = await cleanupJobOf(dependencies, payload, 60);
    const claimed = await claimOf(kind, jobId);
    const worker = contextOf(claimed);

    await privacyCleanupJob(dependencies).run(payload, worker);
    // The very context the job layer gave reaches record and, through the adapter, the write.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.job).toBe(worker);
    const after = await cleanupEffects(request.id);
    expect(after.appends).toHaveLength(1);
    expect((after.appends[0]?.[5] as { job?: unknown } | undefined)?.job).toBe(worker);
    expect(after.journal).toEqual({ state: "ready", object: "verified" });
    expect(after.stored).toBe(1);
    expect(cleanups).toEqual([session.id]);
    expect(after.steps).toEqual(["synthetic_cleanup_authority"]);
    expect(await getPrivacyDeletionRequest(db, ctx, request.id)).toMatchObject({
      state: "completed",
      lastError: null,
    });
    expect(await completeJob(db, claimed, new Date())).toBe(true);
  });

  it("privacy cleanup: a stale claim records no journal, no cleanup step and no state", async () => {
    const { dependencies, recorded, cleanups } = authorityDependencies();
    const { ctx, session, request, payload } = await sessionDeletion(dependencies);
    const { kind, jobId } = await cleanupJobOf(dependencies, payload, 3);
    const claimA = await claimOf(kind, jobId);
    const workerA = contextOf(claimA);
    // A stalls until its lease ends; the sweep returns the job and worker B claims it.
    await sweepUntilReturned(jobId);
    const claimB = await claimOf(kind, jobId);
    expect(claimB.attempt).toBe(2);
    const before = await cleanupEffects(request.id);
    expect(before).toMatchObject({ journal: null, stored: 0, appends: [], steps: [] });

    await expect(privacyCleanupJob(dependencies).run(payload, workerA)).rejects.toMatchObject({
      name: "JobLeaseLost",
    });
    expect(recorded).toEqual([]);
    expect(cleanups).toEqual([]);
    expect(await cleanupEffects(request.id)).toEqual(before);

    // Positive control: the same path with the fresh claim writes all of it.
    const workerB = contextOf(claimB);
    await whileRenewing(claimB, () => privacyCleanupJob(dependencies).run(payload, workerB));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.job).toBe(workerB);
    const after = await cleanupEffects(request.id);
    expect(after.journal).toEqual({ state: "ready", object: "verified" });
    expect(after.stored).toBe(1);
    expect(cleanups).toEqual([session.id]);
    expect(after.steps).toEqual(["synthetic_cleanup_authority"]);
    expect(await getPrivacyDeletionRequest(db, ctx, request.id)).toMatchObject({
      state: "completed",
      lastError: null,
    });
    expect(await renewJobLease(db, claimB, new Date())).toBe(true);
    expect(await completeJob(db, claimB, new Date())).toBe(true);
  });
});
