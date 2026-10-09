import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";
import { calibrateVoiceAcceptance, type VoiceCalibration } from "./matching";

/**
 * The account's own calibration (FR-VOC-003): at least 20 independent confirmed and 20 rejected
 * classes of one model revision, plus a manually confirmed class. Rejections always count;
 * a confirmation counts only while that class is still verified by the learner.
 */
export async function accountVoiceCalibration(
  db: Database | Tx,
  ctx: LearnerContext,
  modelVersion: string,
): Promise<{
  calibration: VoiceCalibration | null;
  confirmedLessons: number;
  rejectedScores: number[];
}> {
  const rows = await db
    .selectFrom("voc.feedback as feedback")
    .innerJoin("voc.analysis as analysis", "analysis.id", "feedback.analysis_id")
    .select([
      "feedback.score",
      "feedback.margin",
      "feedback.accepted",
      "feedback.speaker_id as speakerId",
      "analysis.session_id as sessionId",
      "analysis.status",
      "analysis.verified_speaker_id as verifiedSpeakerId",
      "analysis.verification_method as method",
    ])
    .where("feedback.user_id", "=", ctx.userId)
    .where("analysis.user_id", "=", ctx.userId)
    .where("feedback.model_version", "=", modelVersion)
    .execute();
  const feedback = rows.filter(
    (item) =>
      !item.accepted ||
      (item.status === "verified" &&
        item.method === "manual" &&
        item.verifiedSpeakerId === item.speakerId),
  );
  const confirmed = await db
    .selectFrom("voc.analysis")
    .select("session_id")
    .distinct()
    .where("user_id", "=", ctx.userId)
    .where("verification_method", "=", "manual")
    .where("status", "=", "verified")
    .execute();
  return {
    calibration: calibrateVoiceAcceptance(modelVersion, feedback),
    confirmedLessons: confirmed.length,
    rejectedScores: feedback.flatMap((item) =>
      !item.accepted && item.score !== null ? [item.score] : [],
    ),
  };
}
