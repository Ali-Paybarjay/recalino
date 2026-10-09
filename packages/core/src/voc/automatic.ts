import type { Tx } from "../db";
import { voiceCoverage } from "./contracts";

/**
 * Automatic matches rest on the references that existed when they were made. When a reference
 * or the sample is withdrawn or replaced, every automatic match of the account asks again. A
 * sampled or partial coverage disclosure stays inside the new reason.
 */
export async function invalidateAutomaticVoice(
  tx: Tx,
  userId: string,
  now: Date,
  exceptId?: string,
): Promise<Set<string>> {
  let query = tx
    .selectFrom("voc.analysis")
    .select(["id", "reason"])
    .where("user_id", "=", userId)
    .where("verification_method", "=", "automatic");
  if (exceptId) query = query.where("id", "!=", exceptId);
  const rows = await query.execute();
  for (const row of rows) {
    const coverage = voiceCoverage(row.reason);
    await tx
      .updateTable("voc.analysis")
      .set((eb) => ({
        version: eb("version", "+", 1),
        status: "unverified",
        verified_speaker_id: null,
        verification_method: null,
        reason: coverage ? `voice_reference_revoked_${coverage}` : "voice_reference_revoked",
        updated_at: now,
      }))
      .where("id", "=", row.id)
      .where("user_id", "=", userId)
      .execute();
  }
  return new Set(rows.map((row) => row.id));
}
