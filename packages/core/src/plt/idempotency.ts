import { type Database, type Tx, withTransaction } from "../db";
import { errors } from "./errors";

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotentRequest {
  userId: string;
  key: string;
  route: string;
  requestHash: string;
  ttlSeconds: number;
  now?: Date;
  /** Acquire the domain owner lock before the key row, including on cached replay. */
  beforeKey?: (tx: Tx) => Promise<void>;
}

export interface IdempotentResult extends StoredResponse {
  replayed: boolean;
}

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,200}$/;

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * FR-PLT-004. The key row and the handler's effects commit in one transaction:
 * - a concurrent request with the same key waits on the primary key until the first commits,
 *   then replays its response; if the first rolls back, the second runs;
 * - the same key with a different route or body is `idempotency_mismatch`, with no effect;
 * - an expired key no longer protects anything and the request runs again.
 */
export async function runIdempotent(
  db: Database,
  request: IdempotentRequest,
  handler: (tx: Tx) => Promise<StoredResponse>,
): Promise<IdempotentResult> {
  const now = request.now ?? new Date();
  return withTransaction(db, async (tx) => {
    await request.beforeKey?.(tx);
    await tx
      .deleteFrom("plt.idempotency_key")
      .where("user_id", "=", request.userId)
      .where("key", "=", request.key)
      .where("expires_at", "<=", now)
      .execute();

    const inserted = await tx
      .insertInto("plt.idempotency_key")
      .values({
        user_id: request.userId,
        key: request.key,
        route: request.route,
        request_hash: request.requestHash,
        expires_at: new Date(now.getTime() + request.ttlSeconds * 1000),
      })
      .onConflict((conflict) => conflict.columns(["user_id", "key"]).doNothing())
      .returning("key")
      .executeTakeFirst();

    if (inserted === undefined) {
      const existing = await tx
        .selectFrom("plt.idempotency_key")
        .select(["route", "request_hash", "response_status", "response_body"])
        .where("user_id", "=", request.userId)
        .where("key", "=", request.key)
        .executeTakeFirstOrThrow();
      if (existing.route !== request.route || existing.request_hash !== request.requestHash) {
        throw errors.idempotencyMismatch();
      }
      // Rows commit together with their response, so this only guards against manual edits.
      if (existing.response_status === null) throw errors.conflict();
      return { status: existing.response_status, body: existing.response_body, replayed: true };
    }

    const response = await handler(tx);
    await tx
      .updateTable("plt.idempotency_key")
      .set({
        response_status: response.status,
        // Sent as JSON text so arrays and objects both land as jsonb.
        response_body: JSON.stringify(response.body ?? null),
      })
      .where("user_id", "=", request.userId)
      .where("key", "=", request.key)
      .execute();
    return { ...response, replayed: false };
  });
}

/** Deletes expired keys in batches; scheduling arrives with the job queue (M2). */
export async function purgeExpiredIdempotencyKeys(
  db: Database,
  now: Date = new Date(),
): Promise<number> {
  const result = await db
    .deleteFrom("plt.idempotency_key")
    .where("expires_at", "<=", now)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

/**
 * PRD-PRIV-01/06: revoke cached private responses at the same tombstone transaction.
 * Keep the key/hash until expiry so a stale retry cannot execute a deleted operation again.
 * A null status deliberately makes that retry return conflict instead of cached content.
 */
export async function redactUserIdempotencyResponses(
  db: Database | Tx,
  userId: string,
): Promise<void> {
  await db
    .updateTable("plt.idempotency_key")
    .set({ response_status: null, response_body: null })
    .where("user_id", "=", userId)
    .execute();
}
