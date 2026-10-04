import type { AccountState } from "../acc";
import { getAccountState, lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import {
  errors,
  isValidIdempotencyKey,
  type LearnerContext,
  readPltSettings,
  runIdempotent,
  sha256Hex,
} from "../plt";

export interface CreateOptions {
  key: string;
  now?: Date;
}

export async function requireReadyAccount(
  db: Database | Tx,
  ctx: LearnerContext,
  recording = false,
): Promise<AccountState> {
  const state = await getAccountState(db, ctx.userId);
  if (!state) throw errors.notFound();
  if (!state.setupComplete) throw errors.validationFailed({ profile: ["setup_incomplete"] });
  if (recording && state.pending.recordingConsent) {
    throw errors.validationFailed({ recordingConsent: ["acceptance_required"] });
  }
  return state;
}

/** Account locking serializes names/default creation and empty-container checks per owner. */
export async function lockOrgAccount(tx: Tx, ctx: LearnerContext): Promise<void> {
  await lockAccount(tx, ctx.userId);
}

/** Keep replayed and first responses identical: public timestamps are ISO strings. */
export function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export async function createOnce<T>(
  db: Database,
  ctx: LearnerContext,
  route: string,
  input: unknown,
  options: CreateOptions,
  handler: (tx: Tx, now: Date) => Promise<T>,
): Promise<T> {
  if (!isValidIdempotencyKey(options.key)) {
    throw errors.validationFailed({ idempotencyKey: ["invalid_key"] });
  }
  const now = options.now ?? new Date();
  const result = await runIdempotent(
    db,
    {
      userId: ctx.userId,
      key: options.key,
      route,
      requestHash: sha256Hex(JSON.stringify(input)),
      ttlSeconds: readPltSettings().idempotencyTtlSeconds,
      now,
      beforeKey: (tx) => lockOrgAccount(tx, ctx),
    },
    async (tx) => {
      await lockOrgAccount(tx, ctx);
      return { status: 201, body: await handler(tx, now) };
    },
  );
  return result.body as T;
}

/** Unique indexes are the final safety net even when external writes bypass app locking. */
export function nameError(error: unknown): never {
  if (error !== null && typeof error === "object" && "code" in error && error.code === "23505") {
    throw errors.validationFailed({ name: ["already_exists"] });
  }
  throw error;
}
