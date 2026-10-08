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
