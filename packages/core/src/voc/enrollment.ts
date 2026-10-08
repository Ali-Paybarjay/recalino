import { randomUUID } from "node:crypto";
import { lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import { errors, isValidIdempotencyKey, type LearnerContext } from "../plt";
import { VOICE_CONSENT_VERSION } from "./contracts";

export interface VoiceEnrollmentAttempt {
  key: string;
  attemptId: string;
  profileVersion: number;
}
type EnrollmentStart =
  | { completed: true; profileVersion: number }
  | { completed: false; attempt: VoiceEnrollmentAttempt };
const LEASE_MS = 15 * 60_000;
async function transaction<T>(db: Database | Tx, effect: (tx: Tx) => Promise<T>): Promise<T> {
  return db.isTransaction ? effect(db as Tx) : db.transaction().execute(effect);
}

/** Claim before native inference; retries never resurrect consent from a previous profile epoch. */
export async function beginVoiceEnrollment(
  db: Database | Tx,
  ctx: LearnerContext,
  input: {
    key: string;
    requestHash: string;
    consentVersion: string;
    expectedVersion?: number;
  },
  now = new Date(),
): Promise<EnrollmentStart> {
  if (!isValidIdempotencyKey(input.key) || !/^[a-f0-9]{64}$/.test(input.requestHash))
    throw errors.validationFailed({ request: ["invalid_enrollment_key"] });
  if (input.consentVersion !== VOICE_CONSENT_VERSION)
    throw errors.validationFailed({ consent: ["current_voice_consent_required"] });
  return transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await tx
      .selectFrom("voc.enrollment_request")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("request_key", "=", input.key)
      .executeTakeFirst();
    const profile = await tx
      .selectFrom("voc.profile")
      .select(["version", "enabled"])
      .where("user_id", "=", ctx.userId)
      .executeTakeFirst();
    if (previous) {
      if (
        previous.state === "revoked" ||
        !profile?.enabled ||
        previous.profile_version !== profile.version
      )
        throw errors.validationFailed({ voice: ["enrollment_revoked"] });
      if (previous.request_hash !== input.requestHash) throw errors.conflict();
      if (previous.state === "completed")
        return { completed: true, profileVersion: profile.version };
      if (
        previous.state === "started" &&
        previous.lease_expires_at &&
        previous.lease_expires_at > now
      )
        throw errors.conflict();
    } else if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== (profile?.version ?? 0)
    ) {
      throw errors.validationFailed({ voice: ["voice_settings_changed"] });
    }
    let profileVersion = profile?.version ?? 0;
    if (!profile?.enabled) {
      profileVersion++;
      await tx
        .insertInto("voc.profile")
        .values({
          user_id: ctx.userId,
          version: profileVersion,
          enabled: true,
          consent_version: input.consentVersion,
          consented_at: now,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column("user_id").doUpdateSet({
            version: profileVersion,
            enabled: true,
            consent_version: input.consentVersion,
            consented_at: now,
            updated_at: now,
          }),
        )
        .execute();
    }
    const attemptId = randomUUID();
    await tx
      .insertInto("voc.enrollment_request")
      .values({
        user_id: ctx.userId,
        request_key: input.key,
        request_hash: input.requestHash,
        profile_version: profileVersion,
        state: "started",
        attempt_id: attemptId,
        lease_expires_at: new Date(now.getTime() + LEASE_MS),
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.columns(["user_id", "request_key"]).doUpdateSet({
          state: "started",
          attempt_id: attemptId,
          lease_expires_at: new Date(now.getTime() + LEASE_MS),
          updated_at: now,
        }),
      )
      .execute();
    return { completed: false, attempt: { key: input.key, attemptId, profileVersion } };
  });
}

/** Caller holds the account lock. A replaced/expired native worker cannot publish its result. */
export async function assertVoiceEnrollmentAttempt(
  tx: Tx,
  ctx: LearnerContext,
  attempt: VoiceEnrollmentAttempt,
  now = new Date(),
) {
  const row = await tx
    .selectFrom("voc.enrollment_request")
    .select(["state", "attempt_id", "profile_version", "lease_expires_at"])
    .where("user_id", "=", ctx.userId)
    .where("request_key", "=", attempt.key)
    .executeTakeFirst();
  const profile = await tx
    .selectFrom("voc.profile")
    .select(["version", "enabled"])
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  if (
    row?.state !== "started" ||
    row.attempt_id !== attempt.attemptId ||
    row.profile_version !== attempt.profileVersion ||
    !row.lease_expires_at ||
    row.lease_expires_at <= now ||
    !profile?.enabled ||
    profile.version !== attempt.profileVersion
  )
    throw errors.validationFailed({ voice: ["enrollment_revoked"] });
}

/** For audio enrollment, call in the transaction that publishes the sample and embedding. */
export async function completeVoiceEnrollment(
  db: Database | Tx,
  ctx: LearnerContext,
  attempt: VoiceEnrollmentAttempt,
  now = new Date(),
) {
  await transaction(db, async (tx) => {
    await lockAccount(tx, ctx.userId);
    await assertVoiceEnrollmentAttempt(tx, ctx, attempt, now);
    await tx
      .updateTable("voc.enrollment_request")
      .set({ state: "completed", attempt_id: null, lease_expires_at: null, updated_at: now })
      .where("user_id", "=", ctx.userId)
      .where("request_key", "=", attempt.key)
      .execute();
  });
}

export async function failVoiceEnrollment(
  db: Database,
  ctx: LearnerContext,
  attempt: VoiceEnrollmentAttempt,
  now = new Date(),
) {
  await db
    .updateTable("voc.enrollment_request")
    .set({ state: "failed", attempt_id: null, lease_expires_at: null, updated_at: now })
    .where("user_id", "=", ctx.userId)
    .where("request_key", "=", attempt.key)
    .where("state", "=", "started")
    .where("attempt_id", "=", attempt.attemptId)
    .execute();
}
