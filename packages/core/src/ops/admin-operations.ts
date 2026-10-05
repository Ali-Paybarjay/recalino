import { sql } from "kysely";
import { z } from "zod";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, isValidIdempotencyKey, recordAudit, sha256Hex } from "../plt";

function requestIdentity(actorId: string, key: string) {
  z.uuid().parse(actorId);
  z.string().min(8).max(128).parse(key);
  if (!isValidIdempotencyKey(key))
    throw errors.validationFailed({ "Idempotency-Key": ["invalid"] });
}

/** Reserve the complete submitted envelope durably, including channel, status and recipient choices. */
export async function claimAdminRequest(
  db: Database | Tx,
  actorId: string,
  key: string,
  input: unknown,
): Promise<void> {
  requestIdentity(actorId, key);
  const hash = sha256Hex(canonicalJson(input));
  await sql`insert into ops.admin_request(actor_id,operation_key,request_hash) values(${actorId}::uuid,${key},${hash}) on conflict(actor_id,operation_key) do nothing`.execute(
    db,
  );
  const receipt = (
    await sql<{
      request_hash: string;
    }>`select request_hash from ops.admin_request where actor_id=${actorId}::uuid and operation_key=${key}`.execute(
      db,
    )
  ).rows[0];
  if (!receipt || receipt.request_hash !== hash) throw errors.idempotencyMismatch();
}

/** Atomic effect/result receipt. External provider calls must run after this transaction commits. */
export async function adminOperation<T>(
  db: Database,
  actorId: string,
  key: string,
  input: unknown,
  action: string,
  reason: string,
  effect: (tx: Tx) => Promise<T>,
): Promise<T> {
  requestIdentity(actorId, key);
  z.string().trim().min(1).max(500).parse(reason);
  const hash = sha256Hex(canonicalJson({ action, input }));
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`admin:${actorId}:${key}`}))`.execute(tx);
    const row = (
      await sql<{
        request_hash: string;
        result: T;
      }>`select request_hash,result from ops.admin_operation where actor_id=${actorId}::uuid and operation_key=${key}`.execute(
        tx,
      )
    ).rows[0];
    if (row) {
      if (row.request_hash !== hash) throw errors.idempotencyMismatch();
      return row.result;
    }
    const result = await effect(tx);
    await sql`insert into ops.admin_operation(actor_id,operation_key,request_hash,result) values(${actorId}::uuid,${key},${hash},${JSON.stringify(result)}::jsonb)`.execute(
      tx,
    );
    await recordAudit(tx, {
      actorKind: "operator",
      actorId,
      action,
      subjectType: "admin_operation",
      subjectId: key,
      reason,
      requestId: key,
    });
    return result;
  });
}

export interface AdminPreferenceInput {
  actorId: string;
  language: "en" | "fa";
  theme: "system" | "light" | "dark";
}
export async function updateAdminPreferences(tx: Tx, value: AdminPreferenceInput): Promise<void> {
  const input = z
    .strictObject({
      actorId: z.uuid(),
      language: z.enum(["en", "fa"]),
      theme: z.enum(["system", "light", "dark"]),
    })
    .parse(value);
  await sql`insert into ops.admin_preference(user_id,language,theme) values(${input.actorId}::uuid,${input.language},${input.theme}) on conflict(user_id) do update set language=excluded.language,theme=excluded.theme,updated_at=now()`.execute(
    tx,
  );
}

export interface AdminTaskInput {
  taskId: string;
  state: "open" | "dismissed" | "snoozed";
  snoozedUntil?: string | null;
  reason: string;
}
export async function updateAdminTask(tx: Tx, value: AdminTaskInput): Promise<void> {
  const input = z
    .strictObject({
      taskId: z.string().min(1).max(300),
      state: z.enum(["open", "dismissed", "snoozed"]),
      snoozedUntil: z.iso.datetime().nullable().optional(),
      reason: z.string().trim().min(1).max(500),
    })
    .parse(value);
  if (input.state === "snoozed" && !input.snoozedUntil)
    throw errors.validationFailed({ snoozedUntil: ["required_for_snooze"] });
  const until =
    input.state === "snoozed" && input.snoozedUntil ? new Date(input.snoozedUntil) : null;
  await sql`insert into ops.task_preference(task_id,state,snoozed_until,reason) values(${input.taskId},${input.state},${until},${input.reason}) on conflict(task_id) do update set state=excluded.state,snoozed_until=excluded.snoozed_until,reason=excluded.reason,updated_at=now()`.execute(
    tx,
  );
}
