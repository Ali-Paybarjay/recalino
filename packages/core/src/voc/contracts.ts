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
}
export interface VoiceAnalysisView {
  id: string;
  version: number;
  sourceId: string;
  status: "processing" | "unverified" | "verified" | "none" | "unavailable" | "failed";
  candidateId: string | null;
  verifiedSpeakerId: string | null;
  verificationMethod: "manual" | "automatic" | null;
  reason: string | null;
  candidates: VoiceCandidate[];
}
export interface ClassVoiceView {
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
  reason?: string;
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
