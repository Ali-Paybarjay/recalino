import { randomBytes, randomUUID } from "node:crypto";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "@recalino/core/acc";
import { createDatabase } from "@recalino/core/db";
import { appendEncryptedDeletionJournal, readEncryptedDeletionJournals } from "@recalino/core/ops";
import { createSession } from "@recalino/core/org";
import {
  type ClaimedJob,
  claimJobs,
  enqueueJob,
  type JobContext,
  jobState,
  MemoryObjectStore,
  type RunSummary,
  readPltSettings,
  runDueJobs,
  runJobStep,
  sweepJobs,
} from "@recalino/core/plt";
import {
  type DeletionJournalRecordOptions,
  getPrivacyDeletionRequest,
  type PrivacyDependencies,
  privacyCleanupJob,
  requestAccountDeletion,
  requestSessionDeletion,
} from "@recalino/core/priv";
import { amounts, grantEntitlement, reserveAllowance } from "@recalino/core/quota";
import { sql } from "kysely";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spendTotals } from "../../../../../packages/core/src/quota/costs";
import { createAuthUser } from "../../../../../packages/core/test/auth-users";
import {
  LOCAL_ADMIN_DATABASE_URL,
  testDatabaseUrl,
} from "../../../../../packages/core/test/local-db";
import { defineRoute } from "../api";
import { ROUTES } from "../routes";
import { fakeAuth, flowDeps, memoryJar, routeDeps } from "../test-support";
import { callbackHandler, startHandler } from "./flow";
import { type AuthGateway, supabaseAuth } from "./gateway";

// P12-09 AC-5, AC-6 and AC-8 (P12-04 F-4): signing in again to an account in deletion
// soft-deletes its Auth identity instead of removing it, so the cascade from auth.users never
// removes the account row, its cost rows, its holds, its reservation or its ledger, and the
// system's spend totals do not drop. A user without any account is removed exactly as before.
// The last test is P12-09 AC-4 and AC-7 (d), here because a test under packages/core/src/ops may
// not import PRIV (capability-map-ops); it drives the privacy cleanup through the real job layer.

const adminAuth = vi.hoisted(() => ({ deleteUser: vi.fn() }));
vi.mock("./supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./supabase")>()),
  createAuthAdmin: () => ({ deleteUser: adminAuth.deleteUser }),
}));

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
const admin = createDatabase(LOCAL_ADMIN_DATABASE_URL);
afterAll(async () => {
  await db.destroy();
  await admin.destroy();
});
beforeEach(() => {
  adminAuth.deleteUser.mockReset();
  adminAuth.deleteUser.mockResolvedValue({ error: null });
});

const ORIGIN = "http://localhost:3000";
/** Requests are made far ahead, so no other test's privacy runner finds their queued job due. */
const FAR_MS = 60 * 365 * 24 * 3600 * 1000;
const fixtureHooks: PrivacyDependencies["hooks"] = [
  {
    module: "synthetic_sign_in",
    tombstoneSession: async () => {},
    cleanupSession: async () => {},
    cleanupAccount: async () => {},
  },
];

/**
 * The Auth admin as Supabase behaves for this flow: a hard delete removes the auth.users row, and
 * the cascade from it removes the account row and every row keyed to the account; a soft delete
 * keeps the row.
 */
function supabaseLikeAuth() {
  const base = fakeAuth();
  const deleteUser = vi.fn(async (id: string, options?: { soft: true }) => {
    if (options?.soft !== true) await sql`delete from auth.users where id = ${id}`.execute(admin);
  });
  const gateway: AuthGateway = { ...base.gateway, deleteUser };
  return { ...base, gateway, deleteUser };
}

function signInFlow(gateway: AuthGateway) {
  const jar = memoryJar();
  const deps = flowDeps(gateway, jar);
  const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  return {
    start: () =>
      defineRoute(
        ROUTES.authStart,
        startHandler(deps),
        routeDeps(db),
      )(
        new Request(`${ORIGIN}/auth/start`, {
          method: "POST",
          body: new URLSearchParams({ adult: "on", terms: "on" }).toString(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "sec-fetch-site": "same-origin",
            "x-real-ip": ip,
          },
        }),
      ),
    callback: (query: string) =>
      defineRoute(
        ROUTES.authCallback,
        callbackHandler(deps),
        routeDeps(db),
      )(new Request(`${ORIGIN}/auth/callback?${query}`)),
  };
}

async function authUserExists(id: string) {
  const { rows } = await sql<{
    n: number;
  }>`select count(*)::int as n from auth.users where id = ${id}`.execute(admin);
  return rows[0]?.n === 1;
}

/** A synthetic currency of this run only, so the system totals below count these rows alone. */
function syntheticCurrency() {
  const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `X${letter()}${letter()}`;
}

/** An allowance, its reservation, one recorded provider cost and one open cost hold. */
async function costRows(ctx: { userId: string; requestId: string }) {
  const now = new Date();
  await grantEntitlement(db, {
    userId: ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ audio: 100 }),
    operationKey: randomUUID(),
    actorId: "synthetic-test",
    reason: "Synthetic sign-in cost rows",
  });
  const reservation = await db
    .transaction()
    .execute((tx) => reserveAllowance(tx, ctx, randomUUID(), amounts({ audio: 10 })));
  const sessionId = randomUUID();
  const currency = syntheticCurrency();
  await db
    .insertInto("quota.provider_cost")
    .values({
      user_id: ctx.userId,
      session_id: sessionId,
      operation_key: randomUUID(),
      provider: "synthetic",
      model: "synthetic-model",
      currency,
      amount_micros: 1234,
    })
    .execute();
  await db
    .insertInto("quota.cost_hold")
    .values({
      user_id: ctx.userId,
      session_id: sessionId,
      operation_key: randomUUID(),
      maximum_micros: 567,
      currency,
      reservation_id: reservation.id,
    })
    .execute();
  return { sessionId, currency };
}

/** Rows keyed to the account that the cascade from auth.users would remove. */
async function accountRows(userId: string) {
  const count = async (
    table: "quota.provider_cost" | "quota.cost_hold" | "quota.reservation" | "quota.ledger",
  ) =>
    Number(
      (
        await db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow()
      ).n,
    );
  const account = await db
    .selectFrom("acc.user_account")
    .select(["id", "deleted_at"])
    .where("id", "=", userId)
    .executeTakeFirst();
  return {
    account: account ? { tombstoned: account.deleted_at !== null } : null,
    costs: await count("quota.provider_cost"),
    holds: await count("quota.cost_hold"),
    reservations: await count("quota.reservation"),
    ledger: await count("quota.ledger"),
  };
}

describe("sign-in for an account in deletion (P12-09 AC-5, AC-6, AC-8)", () => {
  it("sign-in: an account in deletion is soft-deleted, not hard-deleted, and keeps its cost rows", async () => {
    const auth = supabaseLikeAuth();
    const flow = signInFlow(auth.gateway);
    const userId = await createAuthUser();
    auth.codes.set("first", userId);
    await flow.start();
    expect((await flow.callback("code=first")).headers.get("location")).toBe(`${ORIGIN}/setup`);
    const ctx = { userId, requestId: randomUUID() };
    const { sessionId, currency } = await costRows(ctx);
    const totals = () =>
      db.transaction().execute((tx) => spendTotals(tx, ctx, sessionId, currency, new Date()));
    const before = await totals();
    expect(before).toEqual({ session: 1801, userMonth: 1801, systemDay: 1801, systemMonth: 1801 });
    // The tombstone of the account-deletion request; its cleanup job has not run.
    await requestAccountDeletion(
      db,
      ctx,
      randomUUID(),
      { hooks: fixtureHooks },
      new Date(Date.now() + FAR_MS),
    );
    const kept = await accountRows(userId);
    expect(kept).toEqual({
      account: { tombstoned: true },
      costs: 1,
      holds: 1,
      reservations: 1,
      ledger: expect.any(Number),
    });

    auth.codes.set("again", userId);
    await flow.start();
    const response = await flow.callback("code=again");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?error=signin`);
    expect(auth.calls.signOut).toBe(1);
    // A soft delete, never a hard one: the identity row stays, and so does everything keyed to it.
    expect(auth.deleteUser.mock.calls).toEqual([[userId, { soft: true }]]);
    expect(await authUserExists(userId)).toBe(true);
    expect(await accountRows(userId)).toEqual(kept);
    expect(await totals()).toEqual(before);
    // The gateway asks Supabase for the same soft deletion as the privacy cleanup.
    await supabaseAuth.deleteUser(userId, { soft: true });
    expect(adminAuth.deleteUser.mock.calls).toEqual([[userId, true]]);
  });

  it("sign-in: a user with no account is cleaned up exactly as before", async () => {
    const auth = supabaseLikeAuth();
    const flow = signInFlow(auth.gateway);
    const userId = await createAuthUser();
    auth.codes.set("no-intent", userId);
    const response = await flow.callback("code=no-intent");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?error=signin`);
    expect(auth.calls.signOut).toBe(1);
    // The same call as before: the user's id alone, with no soft flag.
    expect(auth.deleteUser.mock.calls).toEqual([[userId]]);
    expect(auth.deleteUser.mock.calls[0]).toHaveLength(1);
    expect(await authUserExists(userId)).toBe(false);
    expect((await accountRows(userId)).account).toBeNull();
    // The gateway sends Supabase the same request as before: the id alone.
    await supabaseAuth.deleteUser(userId);
    expect(adminAuth.deleteUser.mock.calls).toEqual([[userId]]);
    expect(adminAuth.deleteUser.mock.calls[0]).toHaveLength(1);
  });
});

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
    // The request's cleanup on a queue kind of its own, with a short lease, claimed by A.
    const payload = { requestId: request.id, userId };
    const kind = `priv.synthetic_${randomUUID().replaceAll("-", "")}`;
    const jobId = await db.transaction().execute((tx) =>
      enqueueJob(
        tx,
        {
          ...privacyCleanupJob(dependencies),
          kind,
          options: { leaseSeconds: 3, maxAttempts: 5 },
        },
        { payload, now: new Date(), defaults: readPltSettings().jobs },
      ),
    );
    if (!jobId) throw new Error("Expected the cleanup job");
    queue = { kind, jobId };
    const [claimA] = await claimJobs(db, [kind], 1, new Date());
    if (!claimA || claimA.id !== jobId) throw new Error("Expected worker A's claim");
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
