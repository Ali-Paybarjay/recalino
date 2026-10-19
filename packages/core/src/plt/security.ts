import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";
import type { Logger } from "./log";

export type SecurityEventKind =
  | "auth_failures"
  | "ownership_denied"
  | "rate_limited"
  | "job_tampered";

export interface SecurityEventInput {
  kind: SecurityEventKind;
  userId?: string | null;
  route?: string | null;
  requestId?: string | null;
}

/** FR-PLT-007: identifiers only, never content. */
export async function recordSecurityEvent(
  db: Database,
  event: SecurityEventInput,
  log?: Logger,
): Promise<void> {
  const row = {
    kind: event.kind,
    user_id: event.userId ?? null,
    route: event.route ?? null,
    request_id: event.requestId ?? null,
  };
  await db.insertInto("plt.security_event").values(row).execute();
  log?.("warn", "security_event", row);
}

export interface AuditInput {
  actorKind: "learner" | "system" | "operator";
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  reason?: string;
  requestId?: string;
}

/** FR-PLT-007: minimal audit trail for sensitive operations such as deletion. */
export async function recordAudit(db: Database, entry: AuditInput): Promise<void> {
  await db
    .insertInto("plt.audit_event")
    .values({
      actor_kind: entry.actorKind,
      actor_id: entry.actorId,
      action: entry.action,
      subject_type: entry.subjectType,
      subject_id: entry.subjectId,
      reason: entry.reason ?? null,
      request_id: entry.requestId ?? null,
    })
    .execute();
}

/** Metadata reader. Domain callers must authorize every subject before using this API. */
export async function latestSubjectAudit(
  db: Database | Tx,
  input: Pick<AuditInput, "actorKind" | "actorId" | "action" | "subjectType"> & {
    subjectIds: string[];
  },
) {
  if (!input.subjectIds.length) return null;
  const row = await db
    .selectFrom("plt.audit_event")
    .select(["subject_id", "occurred_at"])
    .where("actor_kind", "=", input.actorKind)
    .where("actor_id", "=", input.actorId)
    .where("action", "=", input.action)
    .where("subject_type", "=", input.subjectType)
    .where("subject_id", "in", input.subjectIds)
    .orderBy("occurred_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  return row ? { subjectId: row.subject_id, occurredAt: row.occurred_at.toISOString() } : null;
}

/**
 * OPS-02/OPS-05: records `entry` unless the same actor already recorded this action for this
 * subject, and says whether it did. A transaction lock on the key serialises concurrent callers,
 * so an alert raised by two runners at once is still written once.
 */
export async function recordAuditOnce(db: Database, entry: AuditInput): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    const key = `${entry.actorId}:${entry.action}:${entry.subjectType}:${entry.subjectId}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 1))`.execute(tx);
    if (await latestSubjectAudit(tx, { ...entry, subjectIds: [entry.subjectId] })) return false;
    await recordAudit(tx, entry);
    return true;
  });
}

/**
 * SEC-07 (audit 2026-10-18, D95): written in place of a deleted account's id. The audit row keeps
 * what happened; a trigger lets the application change `actor_id` to this value and nothing else
 * (migration 20261019120000_plt_event_retention).
 */
export const DELETED_ACCOUNT_ACTOR = "deleted_account";

/** SEC-07 (D95): security events are kept for the configured days, then removed. */
export async function purgeSecurityEvents(db: Database, before: Date): Promise<number> {
  const result = await db
    .deleteFrom("plt.security_event")
    .where("occurred_at", "<", before)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

const ANONYMISE_BATCH = 500;
const accountIds = z.array(z.uuid());

/**
 * SEC-07 (D95): removes these deleted accounts' ids from the audit trail. Only account ids are
 * accepted, so a system actor such as `ops.health_check` is never rewritten. Repeating it changes
 * nothing; returns the number of rows changed.
 */
export async function anonymiseAuditActors(
  db: Database,
  userIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(accountIds.parse(userIds))];
  let changed = 0;
  for (let index = 0; index < ids.length; index += ANONYMISE_BATCH) {
    const result = await db
      .updateTable("plt.audit_event")
      .set({ actor_id: DELETED_ACCOUNT_ACTOR })
      .where("actor_id", "in", ids.slice(index, index + ANONYMISE_BATCH))
      .executeTakeFirst();
    changed += Number(result.numUpdatedRows);
  }
  return changed;
}
