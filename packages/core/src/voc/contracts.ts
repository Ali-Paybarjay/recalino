import { z } from "zod";

export const VOICE_CONSENT_VERSION = "voice-v1";
export const voiceEmbeddingSchema = z.array(z.number().finite()).min(16).max(1024);
export const voiceClipSchema = z
  .strictObject({
    startMs: z.int().nonnegative(),
    endMs: z.int().positive(),
    text: z.string().max(4000),
  })
  .refine((value) => value.endMs > value.startMs);
export const voiceUtteranceSchema = z.strictObject({
  id: z.string().min(1).max(200),
  speakerId: z.string().min(1).max(200),
  startMs: z.int().nonnegative(),
  endMs: z.int().positive(),
  text: z.string().min(1).max(10000),
  eligible: z.boolean(),
  /**
   * Similarity of this turn's own clean speech to the learner's sample (target-speaker turns,
   * draft FR-VOC v3); absent when the turn was not scored. A proposal, never an identity.
   */
  targetScore: z.number().min(-1).max(1).optional(),
});
export const spokenMistakeSchema = z.strictObject({
  utteranceId: z.string().min(1).max(200),
  said: z.string().min(1).max(2000),
  correct: z.string().min(1).max(2000),
  whyFa: z.string().min(1).max(2000),
  /** Server-stamped explanation locale; missing on legacy Persian suggestions. */
  explanationLanguage: z
    .string()
    .min(2)
    .max(35)
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
    .optional(),
  kind: z.enum(["grammar", "word-choice", "collocation", "preposition", "word-order", "register"]),
  teacherCorrected: z.literal(false),
});
export type SpokenMistake = z.infer<typeof spokenMistakeSchema>;
export type VoiceUtterance = z.infer<typeof voiceUtteranceSchema>;
export const voiceCandidateSchema = z.strictObject({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(100),
  score: z.number().min(-1).max(1).nullable(),
  cleanSpeechMs: z.int().nonnegative(),
  clips: z.array(voiceClipSchema).max(3),
  lines: z.array(z.string().max(4000)).max(4),
});
export type VoiceCandidate = z.infer<typeof voiceCandidateSchema>;
export interface VoiceProfileView {
  version?: number;
  enabled: boolean;
  consentVersion: string | null;
  enrolled: boolean;
  sampleDurationMs: number | null;
  modelVersion: string | null;
  confirmedLessons: number;
  engineAvailable: boolean;
  /**
   * Readiness for the current model revision: the sample, the confirmed classes that became
   * references, and whether later classes can be matched automatically.
   */
  readiness?: {
    sample: boolean;
    references: number;
    automatic: "off" | "needs_sample" | "needs_class" | "unavailable" | "ready";
  };
}
/**
 * Coverage a class voice check discloses: planned distributed sampling of a long selection,
 * excerpts the decoder skipped or cut short, or both. Correction failures keep the marker
 * inside their reason (`voice_correction_<coverage>_<cause>`).
 */
export type VoiceCoverage = "sampled_audio" | "partial_audio" | "sampled_partial_audio";
export function voiceCoverage(reason: string | null | undefined): VoiceCoverage | null {
  if (!reason) return null;
  for (const marker of ["sampled_partial_audio", "sampled_audio", "partial_audio"] as const)
    if (reason.includes(marker)) return marker;
  return null;
}
export function voiceCoverageReason(sampled: boolean, partial: boolean): VoiceCoverage | null {
  return sampled && partial
    ? "sampled_partial_audio"
    : sampled
      ? "sampled_audio"
      : partial
        ? "partial_audio"
        : null;
}

/**
 * Why a class was not matched automatically. Stored with the analysis so the learner sees the
 * real reason for a question; never a probability or a confidence figure.
 */
export const VOICE_MATCH_REASONS = [
  "policy_unavailable",
  "no_sample",
  "no_reference",
  "few_voices",
  "no_clear_match",
  "similar_voices",
] as const;
export type VoiceMatchReason = (typeof VOICE_MATCH_REASONS)[number];

/** What a manual confirmation contributed to later automatic matching. */
export const VOICE_REFERENCE_STATUSES = [
  "added",
  "short",
  "expired",
  "missing",
  "mismatch",
] as const;
export type VoiceReferenceStatus = (typeof VOICE_REFERENCE_STATUSES)[number];

export interface VoiceAnalysisView {
  id: string;
  version: number;
  sourceId: string;
  status: "processing" | "unverified" | "verified" | "none" | "unavailable" | "failed";
  candidateId: string | null;
  verifiedSpeakerId: string | null;
  verificationMethod: "manual" | "automatic" | null;
  reason: string | null;
  /**
   * What this manual confirmation contributed to later matching; null otherwise. `retired`: it
   * was added, but newer classes, a replaced sample or a deletion have since taken it out.
   */
  referenceStatus?: VoiceReferenceStatus | "retired" | null;
  /** Why an acoustic check asked instead of matching automatically; null otherwise. */
  matchReason?: VoiceMatchReason | null;
  /**
   * The owner's registered class recording: its name and length identify it, and its size and
   * SHA-256 let this device verify a re-selected original. No audio or link is included.
   */
  source?: {
    name: string;
    durationMs: number | null;
    sizeBytes: number;
    sha256: string;
    mimeType: string;
  } | null;
  candidates: VoiceCandidate[];
  /**
   * Voices below the suggestion minimum: no voiceprint, no usable excerpt or too little clean
   * speech. They are never suggested and are grouped as short voices rather than offered one by one.
   */
  shortCandidateIds?: string[];
  /**
   * Class voice of each linked speaker of this part (`classVoices` of the class view);
   * `ambiguous` when the voice resembled more than one voice of another part.
   */
  speakerLinks?: Record<string, { voiceId: string; ambiguous: boolean }>;
  /** Target-speaker lines: proposed lines and the learner's own line choices. */
  lines?: VoiceLineView[];
}
/** One transcript line of a part that the learner may mark as their own (draft FR-VOC v3). */
export interface VoiceLineView {
  utteranceId: string;
  speakerId: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Proposed because its own clean speech resembles the learner's sample. */
  proposed: boolean;
  choice: "mine" | "not_mine" | null;
}
/**
 * One voice of the whole class: the same person's speakers in different recording parts, linked
 * by their voiceprints (PRD-SPK-02). `ambiguous` keeps an uncertain link visible: the voice
 * resembled more than one voice of another part, so it was not joined to any of them.
 */
export interface ClassVoiceEntry {
  id: string;
  label: string;
  ambiguous: boolean;
  cleanSpeechMs: number;
  members: { analysisId: string; speakerId: string }[];
}
export interface ClassVoiceView {
  /** Which workstream-4 switches are on (VOICE_SETTINGS_JSON); absent means all off. */
  features?: { classConfirmation: boolean; lineChoices: boolean };
  /** Linked voices of the class, the suggested one first when there is a suggestion. */
  classVoices?: ClassVoiceEntry[];
  /** The class voice suggested for one confirmation per class; never a voice without a voiceprint. */
  classCandidateId?: string | null;
  processing?: boolean;
  /** The same input prerequisites checked before an explicit voice analysis is queued. */
  analysisBlockedReason?: VoiceAnalysisBlockedReason | null;
  enabled: boolean;
  engineAvailable: boolean;
  analyses: VoiceAnalysisView[];
}
export type VoiceAnalysisBlockedReason =
  | "consent_required"
  | "transcript_required"
  | "original_audio_required"
  | "sources_unavailable"
  | "explanation_language_missing";
export const voiceActionSchema = z.strictObject({
  action: z.enum(["confirm", "reject", "none", "revoke"]),
  analysisId: z.uuid(),
  expectedVersion: z.int().positive(),
  speakerId: z.string().min(1).max(200).optional(),
});
/** One choice for the whole class, applied to every current part in one transaction. */
export const voiceClassActionSchema = z.strictObject({
  scope: z.literal("class"),
  action: z.enum(["confirm", "reject", "none", "revoke"]),
  classVoiceId: z.string().min(1).max(200).optional(),
  /** Every current part and the version the learner saw; a changed part refuses the choice. */
  expected: z
    .array(z.strictObject({ analysisId: z.uuid(), version: z.int().positive() }))
    .min(1)
    .max(50),
});
/** The learner marks one transcript line as theirs or not (draft FR-VOC v3). */
export const voiceLineActionSchema = z.strictObject({
  scope: z.literal("line"),
  analysisId: z.uuid(),
  expectedVersion: z.int().positive(),
  utteranceId: z.string().min(1).max(200),
  choice: z.enum(["mine", "not_mine", "clear"]),
});
export const voiceEnrollmentSchema = z
  .strictObject({
    expectedVersion: z.int().nonnegative().optional(),
    consent: z.literal(true),
    consentVersion: z.literal(VOICE_CONSENT_VERSION),
    audioBase64: z
      .string()
      .min(4)
      .max(2800000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
    mimeType: z
      .enum(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"])
      .optional(),
  })
  .refine((value) => Boolean(value.audioBase64) === Boolean(value.mimeType));

export interface VoiceEnrollment {
  version: number;
  enabled: boolean;
  modelVersion: string | null;
  embeddings: {
    vector: number[];
    modelVersion: string;
    analysisId: string | null;
    createdAt: string;
  }[];
}
export interface VoiceAnalysisInput {
  sessionId: string;
  sourceId: string;
  sourceVersionId: string;
  runId: string;
  profileVersion: number;
  modelVersion: string;
  candidates: VoiceCandidate[];
  utterances: VoiceUtterance[];
  embeddings: { speakerId: string; vector: number[] }[];
  /**
   * Transient voiceprints of single clean turns, scored against the learner's sample when the
   * analysis is saved and never stored (target-speaker turns).
   */
  turnEmbeddings?: { utteranceId: string; vector: number[] }[];
  reason?: string;
  /** When the analysis of this source began; its save time is the end (NFR-07, D71). */
  startedAt?: Date;
}
export interface PrivateVoiceAnalysis {
  id: string;
  version: number;
  sourceId: string;
  sourceVersionId: string;
  runId: string;
  profileVersion: number;
  modelVersion: string;
  status: VoiceAnalysisView["status"];
  candidateId: string | null;
  reason: string | null;
  candidates: VoiceCandidate[];
  utterances: VoiceUtterance[];
  mistakes: Record<string, SpokenMistake[]>;
}
