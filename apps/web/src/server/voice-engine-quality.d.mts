export type QualifiedVoiceSegment = {
  speakerId: string;
  startMs: number;
  endMs: number;
  overlap: boolean;
  boundaryUnsafe: boolean;
};
export function normalizeEmbedding(values: ArrayLike<number>): number[];
export function cosineSimilarity(left: number[], right: number[]): number;
export function poolEmbeddings(entries: { embedding: number[]; weight: number }[]): number[];
export function qualifySegments(
  raw: { start: number; end: number; speaker: number }[],
  durationMs: number,
  offsetMs?: number,
  boundaries?: number[],
): QualifiedVoiceSegment[];
export function embeddingSpans(
  segments: QualifiedVoiceSegment[],
  speakerId: string,
  mode?: "whole-turns" | "clean-parts",
): { startMs: number; endMs: number }[];
export function markOverlaps(segments: QualifiedVoiceSegment[]): QualifiedVoiceSegment[];
export function mergeVoices(
  segments: QualifiedVoiceSegment[],
  embedSpan: (span: { startMs: number; endMs: number }) => number[],
  threshold: number,
  minSpeechMs?: number,
): QualifiedVoiceSegment[];
