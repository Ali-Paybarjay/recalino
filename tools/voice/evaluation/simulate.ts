/**
 * Pure simulation of the learner journey on cached features (PROTOCOL.md §3–§7). Every
 * identity decision is made by the production functions in packages/core/src/voc.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  VoiceCandidate,
  VoiceEnrollment,
  VoiceMatchReason,
  VoiceReferenceStatus,
} from "../../../packages/core/src/voc/contracts.ts";
import { rankVoiceCandidates, voiceCosine } from "../../../packages/core/src/voc/matching.ts";
import {
  decideVoiceMatch,
  type VoiceAcceptancePolicy,
  voiceAgreement,
  voiceReferenceOutcome,
} from "../../../packages/core/src/voc/policy.ts";
import {
  AMI_FEATURES,
  type AmiGroup,
  amiParticipants,
  CONDITIONS,
  type Condition,
  groupsOf,
  type Split,
} from "./ami.ts";
import { pipelineSettings } from "./freeze.ts";

export interface EnrollmentFeature {
  pipeline: ReturnType<typeof pipelineSettings>;
  group: string;
  participant: string;
  speechMs: number;
  pieces: number;
  bytes: number;
  embedding: number[] | null;
  failure: string | null;
  modelRevision: string | null;
}
export interface CandidateFeature {
  id: string;
  cleanSpeechMs: number;
  clips: number;
  vector: number[] | null;
  /** Annotated speech (ms) of each participant inside the turns that formed the vector. */
  shares: Record<string, number>;
  basisMs: number;
  spanMs: number;
  spanCheck: boolean | null;
}
export interface ClassFeature {
  pipeline: ReturnType<typeof pipelineSettings>;
  meeting: string;
  condition: Condition;
  durationMs: number;
  failure: string | null;
  sampled: boolean;
  partial: boolean;
  modelRevision: string;
  timing: {
    wallMs: number;
    cpuUserMs: number;
    cpuSystemMs: number;
    maxRssKb: number;
    compositeMs: number | null;
  };
  windowSpeechMs: Record<string, number>;
  candidates: CandidateFeature[];
}

/** Pre-registered identity rule (PROTOCOL.md §5.3). */
export const PURITY = { learnerShare: 0.8, annotatedShare: 0.5 } as const;
export type Identity = "learner" | "learner_majority" | "other";
export function identityOf(candidate: CandidateFeature, learner: string): Identity {
  const annotated = Object.values(candidate.shares).reduce((sum, value) => sum + value, 0);
  const own = candidate.shares[learner] ?? 0;
  if (
    annotated > 0 &&
    own / annotated >= PURITY.learnerShare &&
    annotated >= PURITY.annotatedShare * candidate.basisMs
  )
    return "learner";
  return annotated > 0 && own / annotated > 0.5 ? "learner_majority" : "other";
}
export function majorityIsLearner(candidate: CandidateFeature, learner: string) {
  return identityOf(candidate, learner) !== "other";
}

const cache = new Map<string, unknown>();
function load<T extends { pipeline: unknown }>(file: string): T {
  if (!cache.has(file)) {
    const feature = JSON.parse(readFileSync(join(AMI_FEATURES, file), "utf8")) as T;
    // A cached feature from other pipeline settings would silently mix two pipelines.
    if (JSON.stringify(feature.pipeline) !== JSON.stringify(pipelineSettings()))
      throw new Error(`${file} was extracted with other pipeline settings`);
    cache.set(file, feature);
  }
  return cache.get(file) as T;
}
export const classFeature = (meeting: string, condition: Condition) =>
  load<ClassFeature>(`class.${meeting}.${condition}.json`);
export const enrollmentFeature = (group: string, participant: string) =>
  load<EnrollmentFeature>(`enrol.${group}.${participant}.json`);

export function enrollmentOf(
  modelVersion: string,
  sample: number[],
  lessons: number[][],
): VoiceEnrollment {
  return {
    version: 1,
    enabled: true,
    modelVersion,
    embeddings: [
      ...lessons.map((vector, index) => ({
        vector,
        modelVersion,
        analysisId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        createdAt: "2026-10-08T00:00:00.000Z",
      })),
      { vector: sample, modelVersion, analysisId: null, createdAt: "2026-10-08T00:00:00.000Z" },
    ],
  };
}

/** The ranking the learner sees and the policy decision, both from production code. */
export function decide(
  feature: ClassFeature,
  enrollment: VoiceEnrollment,
  policy: VoiceAcceptancePolicy | null,
) {
  const candidates: VoiceCandidate[] = feature.candidates.map((candidate, index) => ({
    id: candidate.id,
    label: `Voice ${index + 1}`,
    score: null,
    cleanSpeechMs: candidate.cleanSpeechMs,
    clips: [],
    lines: [],
  }));
  const vectors = feature.candidates.flatMap((candidate) =>
    candidate.vector ? [{ speakerId: candidate.id, vector: candidate.vector }] : [],
  );
  const ranked = rankVoiceCandidates(candidates, vectors, enrollment, feature.modelRevision);
  const decision = decideVoiceMatch({
    candidates: ranked,
    vectors,
    enrollment,
    modelVersion: feature.modelRevision,
    policy,
  });
  return { ranked, decision };
}

export interface Target {
  split: Split;
  group: AmiGroup;
  participant: string;
  sample: number[] | null;
  enrolmentFailure: string | null;
  /** The voice an attentive learner confirms in session b: the one mostly theirs. */
  confirmed: CandidateFeature | null;
  /** The voice a mistaken learner confirms: the most-heard voice that is mostly someone else. */
  mistaken: CandidateFeature | null;
}

export function targets(split: Split): Target[] {
  return groupsOf(split).flatMap((group) =>
    [...amiParticipants(`${group}a`).values()].map((participant): Target => {
      const enrolled = enrollmentFeature(group, participant);
      const first = classFeature(`${group}b`, "headset");
      const ownShare = (candidate: CandidateFeature) => candidate.shares[participant] ?? 0;
      const confirmed =
        first.candidates
          .filter((candidate) => majorityIsLearner(candidate, participant))
          .sort((a, b) => ownShare(b) - ownShare(a) || b.cleanSpeechMs - a.cleanSpeechMs)[0] ??
        null;
      const mistaken =
        first.candidates
          .filter((candidate) => candidate.vector && !majorityIsLearner(candidate, participant))
          .sort((a, b) => b.cleanSpeechMs - a.cleanSpeechMs)[0] ?? null;
      return {
        split,
        group,
        participant,
        sample: enrolled.embedding,
        enrolmentFailure: enrolled.failure,
        confirmed,
        mistaken,
      };
    }),
  );
}

export interface Trial {
  kind: "later" | "no_learner";
  meeting: string;
  condition: Condition;
}
/** Sessions c and d in all conditions, plus three meetings of other groups (PROTOCOL.md §3.4). */
export function trialsFor(target: Target): Trial[] {
  const groups = groupsOf(target.split);
  const at = (offset: number) =>
    groups[(groups.indexOf(target.group) + offset) % groups.length] as string;
  return [
    ...["c", "d"].flatMap((session) =>
      CONDITIONS.map((condition) => ({
        kind: "later" as const,
        meeting: `${target.group}${session}`,
        condition,
      })),
    ),
    { kind: "no_learner", meeting: `${at(1)}c`, condition: "headset" },
    { kind: "no_learner", meeting: `${at(2)}d`, condition: "farfield" },
    { kind: "no_learner", meeting: `${at(3)}c`, condition: "opus" },
  ];
}

export function referenceStatus(
  target: Target,
  candidate: CandidateFeature | null,
  policy: VoiceAcceptancePolicy | null,
  modelVersion: string,
): VoiceReferenceStatus | "no_candidate" | "no_sample" {
  if (!target.sample) return "no_sample";
  if (!candidate) return "no_candidate";
  return voiceReferenceOutcome({
    acoustic: true,
    vector: candidate.vector ?? undefined,
    cleanSpeechMs: candidate.cleanSpeechMs,
    expired: false,
    references: { sample: target.sample, lessons: [] },
    policy: policy && { ...policy, modelVersion },
  });
}

export interface TrialOutcome {
  target: string;
  group: string;
  kind: Trial["kind"];
  meeting: string;
  condition: Condition;
  failure: string | null;
  /** Voices with a voiceprint: what the policy compares. */
  voiceprints: number;
  learnerVector: boolean;
  learnerClip: boolean;
  topIsLearner: boolean | null;
  accepted: Identity | null;
  reason: VoiceMatchReason | null;
  /** Reached the score comparison: references ready and at least two clear voices. */
  opportunity: boolean;
  agreement: number | null;
}

export function runTrial(
  target: Target,
  trial: Trial,
  references: { sample: number[]; lessons: number[][] },
  policy: VoiceAcceptancePolicy,
): TrialOutcome {
  const feature = classFeature(trial.meeting, trial.condition);
  const learner = trial.kind === "later" ? target.participant : "__absent__";
  const enrollment = enrollmentOf(feature.modelRevision, references.sample, references.lessons);
  const { ranked, decision } = decide(feature, enrollment, policy);
  const accepted = decision.acceptedId
    ? feature.candidates.find((candidate) => candidate.id === decision.acceptedId)
    : undefined;
  const learnerCandidates = feature.candidates.filter(
    (candidate) => identityOf(candidate, learner) === "learner",
  );
  const top = ranked[0];
  const topFeature = feature.candidates.find((candidate) => candidate.id === top?.id);
  const voiceprints = feature.candidates.filter((candidate) => candidate.vector).length;
  return {
    target: `${target.group}:${target.participant}`,
    group: target.group,
    kind: trial.kind,
    meeting: trial.meeting,
    condition: trial.condition,
    failure: feature.failure,
    voiceprints,
    learnerVector: learnerCandidates.some((candidate) => Boolean(candidate.vector)),
    learnerClip: learnerCandidates.some((candidate) => candidate.clips > 0),
    topIsLearner:
      top?.score === null || !topFeature ? null : identityOf(topFeature, learner) === "learner",
    accepted: accepted ? identityOf(accepted, learner) : null,
    reason: decision.reason,
    opportunity:
      decision.reason === null ||
      decision.reason === "no_clear_match" ||
      decision.reason === "similar_voices",
    agreement: accepted?.vector
      ? voiceAgreement(accepted.vector, {
          sample: references.sample,
          lessons: references.lessons,
        }).agreement
      : null,
  };
}

/**
 * Agreement of every voice in the trials of one prepared target that has a voiceprint and enough
 * clean speech to be accepted, split into the learner and everyone else.
 */
export function impostorAgreements(
  target: Target,
  references: { sample: number[]; lessons: number[][] },
  minCleanSpeechMs: number,
): { genuine: number[]; impostor: number[] } {
  const genuine: number[] = [],
    impostor: number[] = [];
  for (const trial of trialsFor(target)) {
    const feature = classFeature(trial.meeting, trial.condition);
    const learner = trial.kind === "later" ? target.participant : "__absent__";
    for (const candidate of feature.candidates) {
      if (!candidate.vector || candidate.cleanSpeechMs < minCleanSpeechMs) continue;
      const value = voiceAgreement(candidate.vector, references).agreement;
      if (value === null) continue;
      (identityOf(candidate, learner) === "learner" ? genuine : impostor).push(value);
    }
  }
  return { genuine, impostor };
}

export function similarity(left: readonly number[], right: readonly number[]) {
  return voiceCosine(left, right);
}

/** Two-sided 95% Clopper–Pearson upper bound for x failures in n trials. */
export function clopperPearsonUpper(failures: number, trials: number): number | null {
  if (trials <= 0) return null;
  if (failures >= trials) return 1;
  const cdf = (p: number) => {
    let sum = 0,
      term = (1 - p) ** trials;
    for (let k = 0; k <= failures; k++) {
      sum += term;
      term *= ((trials - k) / (k + 1)) * (p / (1 - p));
    }
    return sum;
  };
  let low = failures / trials,
    high = 1;
  for (let step = 0; step < 100; step++) {
    const middle = (low + high) / 2;
    if (cdf(middle) > 0.025) low = middle;
    else high = middle;
  }
  return high;
}

export function quantiles(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted.length
      ? (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null)
      : null;
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p05: at(0.05),
    median: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1) ?? null,
  };
}
export const round = (value: number | null, digits = 4) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
