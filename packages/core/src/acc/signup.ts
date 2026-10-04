import { randomBytes } from "node:crypto";
import { type Database, type Tx, withTransaction } from "../db";
import type { DocumentVersions } from "./documents";

export interface SignupIntent {
  id: string;
  expiresAt: Date;
}

/**
 * FR-ACC-001, step 1: the learner ticked "I am 18 or older" and accepted the Terms and the
 * Privacy Notice on the sign-in page. The declarations are stored before Google is involved and
 * found again only through the random id, which the caller keeps in an httpOnly cookie.
 */
export async function createSignupIntent(
  db: Database,
  options: { versions: DocumentVersions; ttlSeconds: number; now: Date },
): Promise<SignupIntent> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(options.now.getTime() + options.ttlSeconds * 1000);
  await db
    .insertInto("acc.signup_intent")
    .values({
      id,
      adult_declared_at: options.now,
      terms_version: options.versions.terms,
      privacy_version: options.versions.privacy,
      created_at: options.now,
      expires_at: expiresAt,
    })
    .execute();
  return { id, expiresAt };
}

export type SignInOutcome =
  /** A new account, made from the declarations of this sign-in. */
  | { kind: "created" }
  /** An existing account; any fresh declarations were recorded. */
  | { kind: "signed_in" }
  /** No account and no valid declarations: nothing is created (FR-ACC-001). */
  | { kind: "no_account" };

/**
 * FR-ACC-001 and FR-ACC-002, back from Google with a verified Auth user. In one transaction:
 * the intent is locked and used at most once, the account is created only from a valid intent,
 * and a second callback for the same sign-in finds the account instead of making another.
 */
export async function completeSignIn(
  db: Database,
  input: { userId: string; intentId: string | null; now: Date },
): Promise<SignInOutcome> {
  return withTransaction(db, async (tx) => {
    const intent = input.intentId === null ? undefined : await lockIntent(tx, input.intentId);
    const usable =
      intent !== undefined &&
      intent.consumed_at === null &&
      intent.expires_at.getTime() > input.now.getTime();

    const existing = await tx
      .selectFrom("acc.user_account")
      .select(["id", "deleted_at"])
      .where("id", "=", input.userId)
      .forUpdate()
      .executeTakeFirst();

    if (existing?.deleted_at) return { kind: "no_account" };
    if (existing === undefined && !usable) return { kind: "no_account" };

    if (existing === undefined && intent !== undefined) {
      await tx
        .insertInto("acc.user_account")
        .values({
          id: input.userId,
          adult_declared_at: intent.adult_declared_at,
          created_at: input.now,
        })
        .execute();
      await tx
        .insertInto("acc.learning_profile")
        .values({ user_id: input.userId, updated_at: input.now })
        .execute();
    }

    if (usable && intent !== undefined) {
      // A returning learner accepts the current texts on the sign-in page too.
      await tx
        .insertInto("acc.consent")
        .values([
          {
            user_id: input.userId,
            document: "terms",
            version: intent.terms_version,
            accepted_at: intent.adult_declared_at,
          },
          {
            user_id: input.userId,
            document: "privacy",
            version: intent.privacy_version,
            accepted_at: intent.adult_declared_at,
          },
        ])
        .onConflict((conflict) => conflict.columns(["user_id", "document", "version"]).doNothing())
        .execute();
      await tx
        .updateTable("acc.signup_intent")
        .set({ consumed_at: input.now, consumed_by: input.userId })
        .where("id", "=", intent.id)
        .execute();
    }

    return { kind: existing === undefined ? "created" : "signed_in" };
  });
}

function lockIntent(tx: Tx, id: string) {
  return tx
    .selectFrom("acc.signup_intent")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
}

/** Intents past their expiry, used or not; the periodic job runs it (FR-PLT-005, M4). */
export async function purgeExpiredSignupIntents(db: Database, now: Date): Promise<number> {
  const result = await db
    .deleteFrom("acc.signup_intent")
    .where("expires_at", "<", now)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
