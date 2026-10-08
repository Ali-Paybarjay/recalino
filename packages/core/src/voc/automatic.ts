import type { Tx } from "../db";

/**
 * Automatic matches rest on the references that existed when they were made. When a reference
 * or the sample is withdrawn or replaced, every automatic match of the account asks again.
 */
export async function invalidateAutomaticVoice(
  tx: Tx,
  userId: string,
  now: Date,
  exceptId?: string,
): Promise<Set<string>> {
  let query = tx
    .updateTable("voc.analysis")
    .set((eb) => ({
      version: eb("version", "+", 1),
      status: "unverified",
      verified_speaker_id: null,
      verification_method: null,
      reason: "voice_reference_revoked",
      updated_at: now,
    }))
    .where("user_id", "=", userId)
    .where("verification_method", "=", "automatic");
  if (exceptId) query = query.where("id", "!=", exceptId);
  return new Set((await query.returning("id").execute()).map((entry) => entry.id));
}
