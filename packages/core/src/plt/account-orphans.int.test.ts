import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { createAuthUser } from "../../test/auth-users";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { type ExistingAccountIds, sweepAccountOrphans } from "./account-orphans";

// P4-01 (E123 b) on the local database. PLT may not import ACC (capability map), so this test
// stands in ACC's read-only `existingAccountIds` with the same query: any account row, active or
// tombstoned, counts as existing. The sweep is global, so assertions cover this test's rows only.

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());

// P5-02: with ACC's `accountRowOf` stood in as well, the subquery the DELETE requires not to exist.
const existing: ExistingAccountIds = Object.assign(
  async (handle: Parameters<ExistingAccountIds>[0], userIds: readonly string[]) => {
    if (!userIds.length) return new Set<string>();
    const rows = await handle
      .selectFrom("acc.user_account")
      .select("id")
      .where("id", "in", [...userIds])
      .execute();
    return new Set(rows.map((row) => row.id));
  },
  {
    accountRow: ((handle, userId) =>
      handle
        .selectFrom("acc.user_account")
        .select("acc.user_account.id")
        .where("acc.user_account.id", "=", userId)) as ExistingAccountIds["accountRow"],
  },
);

async function account(deletedAt: Date | null): Promise<string> {
  const id = await createAuthUser();
  await db
    .insertInto("acc.user_account")
    .values({ id, adult_declared_at: new Date(), deleted_at: deletedAt })
    .execute();
  return id;
}

async function seed(userId: string) {
  await db
    .insertInto("plt.push_subscription")
    .values({
      user_id: userId,
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      p256dh: "a".repeat(87),
      auth: "b".repeat(22),
    })
    .execute();
  await db
    .insertInto("plt.notification")
    .values({
      user_id: userId,
      deduplication_key: `orphan-test:${randomUUID()}`,
      kind: "processing_ready",
      href: `/classes/${randomUUID()}/notes`,
    })
    .execute();
}

async function remaining(userIds: string[]) {
  const [subscriptions, notifications] = await Promise.all([
    db
      .selectFrom("plt.push_subscription")
      .select("user_id")
      .where("user_id", "in", userIds)
      .execute(),
    db.selectFrom("plt.notification").select("user_id").where("user_id", "in", userIds).execute(),
  ]);
  return {
    subscriptions: subscriptions.map((row) => row.user_id).sort(),
    notifications: notifications.map((row) => row.user_id).sort(),
  };
}

it("counts by default, removes only rows without an account with apply, and repeats harmlessly", async () => {
  const active = await account(null);
  const tombstoned = await account(new Date());
  const gone = randomUUID();
  const ours = [active, tombstoned, gone];
  for (const id of ours) await seed(id);
  const all = await remaining(ours);

  const dryRun = await sweepAccountOrphans(db, existing);
  expect(dryRun.mode).toBe("dry_run");
  expect(dryRun.found.pushSubscriptions).toBeGreaterThanOrEqual(1);
  expect(dryRun.found.notifications).toBeGreaterThanOrEqual(1);
  expect(dryRun.removed).toEqual({ pushSubscriptions: 0, notifications: 0 });
  expect(await remaining(ours)).toEqual(all);

  // Other tests' rows without an account may sit ahead of ours, so sweep until nothing is left.
  for (let run = 0; run < 20; run += 1) {
    const applied = await sweepAccountOrphans(db, existing, { apply: true, limit: 1000 });
    expect(applied.removed.pushSubscriptions + applied.removed.notifications).toBeLessThanOrEqual(
      1000,
    );
    if (applied.removed.pushSubscriptions + applied.removed.notifications === 0) break;
  }
  const kept = [active, tombstoned].sort();
  expect(await remaining(ours)).toEqual({ subscriptions: kept, notifications: kept });

  // Running it again leaves the rows of an active or tombstoned account where they are.
  await sweepAccountOrphans(db, existing, { apply: true });
  expect(await remaining(ours)).toEqual({ subscriptions: kept, notifications: kept });
});

it("keeps rows of an account the earlier checks missed, as the DELETE checks for it itself (P5-02)", async () => {
  // Both earlier checks answer "no account" for every id, as if the accounts were created and
  // committed after them; only the DELETE's own `not exists` can still see the account rows.
  const active = await account(null);
  const tombstoned = await account(new Date());
  const gone = randomUUID();
  const ours = [active, tombstoned, gone];
  for (const id of ours) await seed(id);
  const stale: ExistingAccountIds = Object.assign(async () => new Set<string>(), {
    accountRow: existing.accountRow,
  });
  const applied = await sweepAccountOrphans(db, stale, { apply: true, limit: 5000 });
  expect(applied.mode).toBe("apply");
  const kept = [active, tombstoned].sort();
  const left = await remaining([active, tombstoned]);
  expect(left).toEqual({ subscriptions: kept, notifications: kept });
  await db.deleteFrom("plt.push_subscription").where("user_id", "=", gone).execute();
  await db.deleteFrom("plt.notification").where("user_id", "=", gone).execute();
});

it("removes at most the limit in one run", async () => {
  const gone = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of gone) await seed(id);
  const applied = await sweepAccountOrphans(db, existing, { apply: true, limit: 2 });
  expect(applied.removed.pushSubscriptions + applied.removed.notifications).toBe(2);
  await db.deleteFrom("plt.push_subscription").where("user_id", "in", gone).execute();
  await db.deleteFrom("plt.notification").where("user_id", "in", gone).execute();
});
