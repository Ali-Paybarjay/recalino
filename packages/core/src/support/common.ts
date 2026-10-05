import { sql } from "kysely";
import { accountExists, lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import { canonicalJson, errors, type LearnerContext, sha256Hex } from "../plt";
import type { AdminSupportContext } from "./contracts";

export type SupportDb = Database | Tx;
export function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}
export async function transaction<T>(db: SupportDb, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.isTransaction ? work(db as Tx) : (db as Database).transaction().execute(work);
}
export async function requireAccount(db: SupportDb, userId: string): Promise<void> {
  if (!(await accountExists(db, userId))) throw errors.notFound();
}
export async function learnerLock(tx: Tx, ctx: LearnerContext): Promise<void> {
  await lockAccount(tx, ctx.userId);
  await requireAccount(tx, ctx.userId);
}
export function requireActor(ctx: AdminSupportContext): void {
  if (!ctx.actorId || ctx.actorId.length > 200) throw errors.unauthenticated();
}
export async function audit(
  db: SupportDb,
  ctx: AdminSupportContext,
  action: string,
  resourceId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  requireActor(ctx);
  await sql`insert into support.activity(actor_id,action,resource_id,detail) values(${ctx.actorId},${action},${resourceId},${JSON.stringify(detail)}::jsonb)`.execute(
    db,
  );
}
export function ensureHash(actual: string, expected: string): void {
  if (actual !== expected) throw errors.idempotencyMismatch();
}
