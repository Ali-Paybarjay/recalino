// P4-01 (E123 option b; CWE-459 from P2-06): push subscriptions and notifications keep a plain
// user id since P2-06, so a hard delete of an account outside the privacy flow leaves them behind.
// This maintenance sweep finds rows whose user has no account row at all. PLT may not read ACC's
// tables (ADR-0002 rule 4) nor import ACC (capability map), so the caller passes ACC's read-only
// `existingAccountIds`. A dry run is the default: it counts and logs counts only. Rows are removed
// only with `apply: true`, at most `limit` per run, and never for an active or tombstoned account.
import type { Expression } from "kysely";
import type { Database, Tx } from "../db";
import type { JobDefinition } from "./jobs";
import type { Logger } from "./log";
import { type EmptyPayload, emptyPayload } from "./maintenance";

/** Which of the given user ids still have an account row, active or tombstoned (ACC's export). */
export interface ExistingAccountIds {
  (db: Database | Tx, userIds: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * P5-02 (CWE-367): the account row of `userId`, active or tombstoned, as a subquery (ACC's
   * `accountRowOf`). The removal requires `not exists` of it in the DELETE itself, so an account
   * created and committed after the earlier checks still keeps its rows.
   */
  accountRow(db: Database | Tx, userId: Expression<string>): Expression<unknown>;
}

export interface AccountOrphanOptions {
  /** Removes rows only when exactly `true`; anything else is a dry run. */
  apply?: boolean;
  /** At most this many rows removed per run, over both tables. */
  limit?: number;
  log?: Logger;
}

export interface AccountOrphanCounts {
  pushSubscriptions: number;
  notifications: number;
}

export interface AccountOrphanSummary {
  mode: "dry_run" | "apply";
  /** Rows without an account found in this run (before any removal). */
  found: AccountOrphanCounts;
  removed: AccountOrphanCounts;
}

export const ACCOUNT_ORPHAN_DEFAULT_LIMIT = 500;
export const ACCOUNT_ORPHAN_MAX_LIMIT = 5000;
/** Distinct user ids read, and checked against ACC, per statement. */
const PAGE = 500;

type OrphanTable = "plt.push_subscription" | "plt.notification";
const TABLES: ReadonlyArray<{ table: OrphanTable; key: keyof AccountOrphanCounts; name: string }> =
  [
    { table: "plt.push_subscription", key: "pushSubscriptions", name: "push_subscription" },
    { table: "plt.notification", key: "notifications", name: "notification" },
  ];

/** The next page of distinct user ids of `table`, in id order. */
async function userIdPage(
  db: Database,
  table: OrphanTable,
  after: string | null,
): Promise<string[]> {
  let query = db
    .selectFrom(table as "plt.notification")
    .select("user_id")
    .distinct()
    .orderBy("user_id")
    .limit(PAGE);
  if (after !== null) query = query.where("user_id", ">", after);
  return (await query.execute()).map((row) => row.user_id);
}

async function countRows(db: Database, table: OrphanTable, userIds: string[]): Promise<number> {
  const row = await db
    .selectFrom(table as "plt.notification")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("user_id", "in", userIds)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/**
 * Removes up to `limit` rows of these users, in one transaction that first checks again that
 * they still have no account row. The DELETE itself also requires that no account row exists
 * for each row's user (P5-02, CWE-367), so an account created and committed between that check
 * and the DELETE keeps its rows too.
 */
async function removeRows(
  db: Database,
  existing: ExistingAccountIds,
  table: OrphanTable,
  userIds: string[],
  limit: number,
): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const still = await existing(tx, userIds);
    const orphans = userIds.filter((id) => !still.has(id));
    if (!orphans.length) return 0;
    const rows = await tx
      .selectFrom(table as "plt.notification")
      .select("id")
      .where("user_id", "in", orphans)
      .orderBy("id")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
    if (!rows.length) return 0;
    const ids = rows.map((row) => row.id);
    const result = await tx
      .deleteFrom(table as "plt.notification")
      .where("id", "in", ids)
      .where("user_id", "in", orphans)
      .where((eb) =>
        eb.not(
          eb.exists(
            existing.accountRow(tx, eb.ref(`${table}.user_id` as "plt.notification.user_id")),
          ),
        ),
      )
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  });
}

function checkLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > ACCOUNT_ORPHAN_MAX_LIMIT)
    throw new Error("Invalid account orphan limit");
  return limit;
}

/**
 * Counts (dry run, the default) or removes (`apply: true`, up to `limit`) push subscriptions and
 * notifications whose user id has no account row. Logs counts per table, never ids or content.
 * Running it again after a full removal finds nothing and changes nothing.
 */
export async function sweepAccountOrphans(
  db: Database,
  existing: ExistingAccountIds,
  options: AccountOrphanOptions = {},
): Promise<AccountOrphanSummary> {
  const apply = options.apply === true;
  let remaining = checkLimit(options.limit ?? ACCOUNT_ORPHAN_DEFAULT_LIMIT);
  const summary: AccountOrphanSummary = {
    mode: apply ? "apply" : "dry_run",
    found: { pushSubscriptions: 0, notifications: 0 },
    removed: { pushSubscriptions: 0, notifications: 0 },
  };
  for (const { table, key, name } of TABLES) {
    let after: string | null = null;
    for (;;) {
      const page = await userIdPage(db, table, after);
      if (!page.length) break;
      const known = await existing(db, page);
      const orphans = page.filter((id) => !known.has(id));
      if (orphans.length) {
        summary.found[key] += await countRows(db, table, orphans);
        if (apply && remaining > 0) {
          const removed = await removeRows(db, existing, table, orphans, remaining);
          summary.removed[key] += removed;
          remaining -= removed;
        }
      }
      if (page.length < PAGE) break;
      after = page[page.length - 1] as string;
    }
    options.log?.("info", "account_orphans_swept", {
      module: "plt",
      kind: name,
      state: summary.mode,
      measured: summary.found[key],
      dropped: summary.removed[key],
    });
  }
  return summary;
}

/**
 * A periodic job definition that only counts: a scheduled run never removes rows. Removal is a
 * separate, explicit `sweepAccountOrphans(db, existing, { apply: true })` call.
 */
export function accountOrphansJob(existing: ExistingAccountIds): JobDefinition<EmptyPayload> {
  return {
    kind: "plt.count_account_orphans",
    version: 1,
    payload: emptyPayload,
    run: async (_payload, ctx) => {
      await sweepAccountOrphans(ctx.db, existing, ctx.log ? { log: ctx.log } : {});
    },
  };
}
