import type { VoiceCandidate, VoiceEnrollment } from "./contracts";

export function voiceCosine(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || !left.length) return null;
  let dot = 0,
    a = 0,
    b = 0;
  for (let i = 0; i < left.length; i++) {
    const x = left[i] ?? Number.NaN,
      y = right[i] ?? Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    a += x * x;
    b += y * y;
  }
  return a > 0 && b > 0 ? Math.max(-1, Math.min(1, dot / Math.sqrt(a * b))) : null;
}
/** Identity evidence is acoustic only; talking time, loudness and transcript clues cannot verify it. */
export function rankVoiceCandidates(
  candidates: VoiceCandidate[],
  vectors: { speakerId: string; vector: number[] }[],
  enrollment: VoiceEnrollment,
  modelVersion: string,
): VoiceCandidate[] {
  return candidates
    .map((candidate) => {
      const vector = vectors.find((item) => item.speakerId === candidate.id)?.vector;
      const scores = vector
        ? enrollment.embeddings
            .filter((item) => item.modelVersion === modelVersion)
            .flatMap((entry) => {
              const value = voiceCosine(vector, entry.vector);
              return value === null ? [] : [value];
            })
        : [];
      // Average across confirmed examples avoids one accidental high score deciding the match.
      return {
        ...candidate,
        score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      };
    })
    .sort((a, b) => (b.score ?? -2) - (a.score ?? -2) || a.id.localeCompare(b.id));
}
export interface VoiceCalibration {
  modelVersion: string;
  acceptScore: number;
  minMargin: number;
  positiveCount: number;
  negativeCount: number;
}
export function calibrateVoiceAcceptance(
  modelVersion: string,
  feedback: { sessionId: string; score: number | null; margin: number | null; accepted: boolean }[],
): VoiceCalibration | null {
  // Reprocessing one lesson is not independent calibration evidence. Retain its hardest scores.
  const lessons = new Map<string, { score: number; margin: number | null; accepted: boolean }>();
  for (const item of feedback) {
    if (
      !item.sessionId ||
      item.score === null ||
      !Number.isFinite(item.score) ||
      item.score < -1 ||
      item.score > 1 ||
      (item.accepted && (item.margin === null || !Number.isFinite(item.margin) || item.margin <= 0))
    )
      continue;
    const key = `${item.accepted}:${item.sessionId}`,
      prior = lessons.get(key);
    lessons.set(key, {
      accepted: item.accepted,
      score: prior
        ? item.accepted
          ? Math.min(prior.score, item.score)
          : Math.max(prior.score, item.score)
        : item.score,
      margin: item.accepted ? Math.min(prior?.margin ?? 2, item.margin ?? 0) : item.margin,
    });
  }
  const observations = [...lessons.values()];
  const positives = observations.filter((item) => item.accepted && item.margin !== null);
  const negatives = observations.filter((item) => !item.accepted);
  // Coverage minimum, not a borrowed acoustic score. Mixed/insufficient observations never autoaccept.
  if (positives.length < 20 || negatives.length < 20) return null;
  const lowPositive = Math.min(...positives.map((item) => item.score ?? -1));
  const highNegative = Math.max(...negatives.map((item) => item.score ?? 1));
  const minMargin = Math.min(...positives.map((item) => item.margin ?? 0));
  if (lowPositive <= highNegative || minMargin <= 0) return null;
  return {
    modelVersion,
    acceptScore: lowPositive,
    minMargin,
    positiveCount: positives.length,
    negativeCount: negatives.length,
  };
}
export function autoAcceptVoice(
  candidates: VoiceCandidate[],
  calibration: VoiceCalibration | null,
  modelVersion: string,
  confirmedLessons: number,
): string | null {
  const [first, second] = candidates;
  if (
    !calibration ||
    calibration.modelVersion !== modelVersion ||
    !confirmedLessons ||
    !first ||
    !second ||
    first.cleanSpeechMs < 20000 ||
    first.score === null ||
    second.score === null
  )
    return null;
  return first.score >= calibration.acceptScore &&
    first.score - second.score >= calibration.minMargin
    ? first.id
    : null;
}
