import type {
  VoiceCandidate,
  VoiceEnrollment,
  VoiceMatchReason,
  VoiceReferenceStatus,
} from "./contracts";
import { voiceCosine } from "./matching";

/**
 * An offline-evaluated acceptance rule for one exact model revision. The numbers are
 * cosine-similarity cut-offs chosen on a frozen calibration split and tested on a separate
 * holdout (tools/voice/evaluation); they are not probabilities.
 */
export interface VoiceAcceptancePolicy {
  id: string;
  modelVersion: string;
  /** Lowest similarity a voice must reach against BOTH the sample and the confirmed classes. */
  acceptScore: number;
  /** Required lead over the closest other voice's best similarity to either reference. */
  minMargin: number;
  /** Lowest similarity between a newly confirmed class voice and the sample to keep it. */
  referenceConsistency: number;
  minCleanSpeechMs: number;
  /** Automatic acceptance is a separate switch; the reference check applies regardless. */
  autoAccept: boolean;
}

export interface VoiceReferences {
  sample: number[] | null;
  lessons: number[][];
}

/** The separately recorded sample and the confirmed class voices of one model revision. */
export function voiceReferences(
  enrollment: VoiceEnrollment,
  modelVersion: string,
): VoiceReferences {
  const current = enrollment.embeddings.filter((entry) => entry.modelVersion === modelVersion);
  return {
    sample: current.find((entry) => entry.analysisId === null)?.vector ?? null,
    lessons: current.filter((entry) => entry.analysisId !== null).map((entry) => entry.vector),
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * Similarity to each independent reference. `agreement` needs both the sample and the
 * confirmed classes; `best` is the strongest resemblance to either, used for the runner-up.
 */
export function voiceAgreement(vector: readonly number[], references: VoiceReferences) {
  const sample = references.sample ? voiceCosine(vector, references.sample) : null;
  const lessons = mean(
    references.lessons.flatMap((reference) => {
      const value = voiceCosine(vector, reference);
      return value === null ? [] : [value];
    }),
  );
  return {
    sample,
    lessons,
    agreement: sample !== null && lessons !== null ? Math.min(sample, lessons) : null,
    best:
      sample !== null || lessons !== null
        ? Math.max(sample ?? Number.NEGATIVE_INFINITY, lessons ?? Number.NEGATIVE_INFINITY)
        : null,
  };
}

/**
 * A confirmed class voice that does not resemble the learner's own sample is kept out of the
 * references, so one wrong confirmation cannot teach the system someone else's voice.
 */
export function voiceReferenceConsistency(
  vector: readonly number[],
  references: VoiceReferences,
  policy: VoiceAcceptancePolicy | null,
): "consistent" | "mismatch" | "unchecked" {
  if (!policy || !references.sample) return "unchecked";
  const similarity = voiceCosine(vector, references.sample);
  return similarity !== null && similarity >= policy.referenceConsistency
    ? "consistent"
    : "mismatch";
}

/**
 * What one manual confirmation can teach. Too little clean speech, an expired private
 * vector, no vector at all, or a voice unlike the sample each leave the references unchanged.
 */
export function voiceReferenceOutcome(input: {
  /** False for transcript-label analyses, which never computed an acoustic vector. */
  acoustic: boolean;
  vector: readonly number[] | undefined;
  cleanSpeechMs: number;
  expired: boolean;
  references: VoiceReferences;
  policy: VoiceAcceptancePolicy | null;
}): VoiceReferenceStatus {
  if (!input.acoustic) return "missing";
  if (input.cleanSpeechMs < VOICE_REFERENCE_MIN_SPEECH_MS) return "short";
  if (input.expired) return "expired";
  if (!input.vector) return "missing";
  return voiceReferenceConsistency(input.vector, input.references, input.policy) === "mismatch"
    ? "mismatch"
    : "added";
}
/** Clean speech a class voice needs before its vector can serve as a reference. */
export const VOICE_REFERENCE_MIN_SPEECH_MS = 20000;

export interface VoiceMatchDecision {
  acceptedId: string | null;
  reason: VoiceMatchReason | null;
}

/**
 * Automatic acceptance after one sample and one confirmed class. Every condition must hold;
 * any doubt leaves the class for the learner to confirm.
 */
export function decideVoiceMatch(input: {
  candidates: readonly Pick<VoiceCandidate, "id" | "cleanSpeechMs" | "score">[];
  vectors: readonly { speakerId: string; vector: number[] }[];
  enrollment: VoiceEnrollment;
  modelVersion: string;
  policy: VoiceAcceptancePolicy | null;
  /** Ranking scores of voices this learner rejected before, for the same model revision. */
  rejectedScores?: readonly number[];
}): VoiceMatchDecision {
  const { policy } = input;
  const ask = (reason: VoiceMatchReason): VoiceMatchDecision => ({ acceptedId: null, reason });
  // What the learner can act on comes first: a sample, then one confirmed class.
  const references = voiceReferences(input.enrollment, input.modelVersion);
  if (!references.sample) return ask("no_sample");
  if (!references.lessons.length) return ask("no_reference");
  if (!policy?.autoAccept || policy.modelVersion !== input.modelVersion)
    return ask("policy_unavailable");
  // Every voice with a voiceprint competes, even one too short to be accepted itself.
  const scored = input.candidates.flatMap((candidate) => {
    const vector = input.vectors.find((item) => item.speakerId === candidate.id)?.vector;
    if (!vector) return [];
    const similarity = voiceAgreement(vector, references);
    return similarity.agreement === null || similarity.best === null
      ? []
      : [{ candidate, agreement: similarity.agreement, best: similarity.best }];
  });
  // A lone voice cannot be told apart from anyone; at least two clear voices are compared.
  if (scored.length < 2) return ask("few_voices");
  scored.sort((a, b) => b.agreement - a.agreement || a.candidate.id.localeCompare(b.candidate.id));
  const [top, ...others] = scored;
  if (
    !top ||
    top.candidate.cleanSpeechMs < policy.minCleanSpeechMs ||
    top.agreement < policy.acceptScore
  )
    return ask("no_clear_match");
  const closest = Math.max(...others.map((item) => item.best));
  if (top.agreement - closest < policy.minMargin) return ask("similar_voices");
  // A voice this learner already said was not theirs, scoring like this one, keeps them asked.
  const rejected = (input.rejectedScores ?? []).filter((score) => Number.isFinite(score));
  if (
    rejected.length &&
    (top.candidate.score === null || top.candidate.score - Math.max(...rejected) < policy.minMargin)
  )
    return ask("similar_voices");
  return { acceptedId: top.candidate.id, reason: null };
}
