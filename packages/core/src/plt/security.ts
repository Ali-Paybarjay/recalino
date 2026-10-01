import type { Database } from "../db";
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
