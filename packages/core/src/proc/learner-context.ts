import { z } from "zod";
import { GOALS, LEVELS, type LearningProfile } from "../acc";
import { studyLexicalTarget, studyLexicalTargetMatches } from "../lkm";

/** D48: one bounded memory point, snapshotted at run start; evidence, never a diagnosis. */
export const practiceCandidateSchema = z.strictObject({
  target: z.string().min(1).max(200),
  reason: z.enum(["recall_difficulty", "asked_simpler"]),
  scope: z.enum(["this_class", "same_course"]),
  againCount: z.int().min(0).max(10000),
  lastEvidenceDate: z.iso.date(),
});
export type PracticeCandidate = z.infer<typeof practiceCandidateSchema>;
export const MAX_PRACTICE_CANDIDATES = 8;
export const MAX_PRACTICE_FOCUS = 5;

const declared = {
  declaredLevel: z.enum(LEVELS).optional(),
  goal: z.enum(GOALS).optional(),
};
export const learnerTeachingContextSchema = z.discriminatedUnion("version", [
  z.strictObject({ version: z.literal(1), ...declared }),
  z
    .strictObject({
      version: z.literal(2),
      ...declared,
      simplerExplanations: z.literal(true).optional(),
      practiceCandidates: z
        .array(practiceCandidateSchema)
        .min(1)
        .max(MAX_PRACTICE_CANDIDATES)
        .optional(),
    })
    // Version 2 exists only to carry an explicit choice or memory; otherwise snapshots stay v1.
    .refine((context) => context.simplerExplanations === true || !!context.practiceCandidates),
]);
export type LearnerTeachingContext = z.infer<typeof learnerTeachingContextSchema>;

/** The only learner context a model receives: declared choices and matched focus, no counts. */
export interface ModelTeachingContext {
  version: 1 | 2;
  declaredLevel?: (typeof LEVELS)[number];
  goal?: (typeof GOALS)[number];
  simplerExplanations?: true;
  practiceFocus?: { target: string; reason: PracticeCandidate["reason"] }[];
  /** Unmatched snapshot points never reach a model; this makes the raw snapshot unassignable. */
  practiceCandidates?: never;
}

/**
 * AC-D46-05 and D48: retain declared choices and bounded memory only. Without memory or a
 * simpler-explanation choice the snapshot stays version 1, identical to earlier releases.
 */
export function snapshotLearnerTeachingContext(
  profile: Pick<LearningProfile, "level" | "goal">,
  memory: { simplerExplanations?: boolean; practiceCandidates?: readonly PracticeCandidate[] } = {},
): LearnerTeachingContext {
  const candidates = (memory.practiceCandidates ?? []).slice(0, MAX_PRACTICE_CANDIDATES);
  const extended = memory.simplerExplanations === true || candidates.length > 0;
  return learnerTeachingContextSchema.parse({
    version: extended ? 2 : 1,
    ...(profile.level === null ? {} : { declaredLevel: profile.level }),
    ...(profile.goal === null ? {} : { goal: profile.goal }),
    ...(memory.simplerExplanations === true ? { simplerExplanations: true } : {}),
    ...(candidates.length ? { practiceCandidates: candidates } : {}),
  });
}

/** Structural, so this module does not depend on the run contract that embeds it. */
interface ExtractedSource {
  blocks: readonly { text: string }[];
}

/** The extracted text of this class only; anonymous speaker or role data is not consulted. */
function extractedText(sources: readonly ExtractedSource[]): string {
  return sources.flatMap((source) => source.blocks.map((block) => block.text)).join("\n");
}

/**
 * D48: deterministic and reproducible from the frozen settings and checkpointed extraction.
 * A same-course point is kept only when its exact lexical target occurs in this class's text;
 * that is a literal co-occurrence, not proof of the same meaning, and memory is never merged.
 */
export function selectPracticeFocus(
  context: LearnerTeachingContext | undefined,
  sources: readonly ExtractedSource[],
): PracticeCandidate[] {
  if (context?.version !== 2 || !context.practiceCandidates) return [];
  const text = extractedText(sources);
  const selected: PracticeCandidate[] = [];
  for (const candidate of context.practiceCandidates) {
    const target = studyLexicalTarget(candidate.target);
    if (!target) continue;
    if (candidate.scope === "same_course" && !studyLexicalTargetMatches(target, text)) continue;
    selected.push(candidate);
    if (selected.length >= MAX_PRACTICE_FOCUS) break;
  }
  return selected;
}

export function modelTeachingContext(
  context: LearnerTeachingContext | undefined,
  focus: readonly PracticeCandidate[],
): ModelTeachingContext | undefined {
  if (!context) return undefined;
  if (context.version === 1) return context;
  return {
    version: 2,
    ...(context.declaredLevel ? { declaredLevel: context.declaredLevel } : {}),
    ...(context.goal ? { goal: context.goal } : {}),
    ...(context.simplerExplanations ? { simplerExplanations: true as const } : {}),
    ...(focus.length
      ? { practiceFocus: focus.map(({ target, reason }) => ({ target, reason })) }
      : {}),
  };
}

/** Saved with each knowledge version so the lesson can explain its adaptation (D48). */
export const teachingAdaptationSchema = z.strictObject({
  version: z.literal(1),
  declaredLevel: z.enum(LEVELS).optional(),
  goal: z.enum(GOALS).optional(),
  shorterExamples: z.boolean(),
  simplerExplanations: z.boolean(),
  focus: z.array(practiceCandidateSchema).max(MAX_PRACTICE_FOCUS),
  /** Generated items whose lexical target equals a focus target. */
  linkedItemIds: z.array(z.string().min(1).max(100)).max(500),
});
export type TeachingAdaptation = z.infer<typeof teachingAdaptationSchema>;

export function teachingAdaptation(input: {
  context: LearnerTeachingContext;
  shorterExamples: boolean;
  focus: readonly PracticeCandidate[];
  items: readonly { id: string; study?: { en: string } }[];
}): TeachingAdaptation {
  const targets = input.focus.flatMap((candidate) => {
    const target = studyLexicalTarget(candidate.target);
    return target ? [target.text.toLocaleLowerCase("en")] : [];
  });
  const linkedItemIds = input.items.flatMap((item) => {
    const target = item.study ? studyLexicalTarget(item.study.en) : undefined;
    return target && targets.includes(target.text.toLocaleLowerCase("en")) ? [item.id] : [];
  });
  return teachingAdaptationSchema.parse({
    version: 1,
    ...(input.context.declaredLevel ? { declaredLevel: input.context.declaredLevel } : {}),
    ...(input.context.goal ? { goal: input.context.goal } : {}),
    shorterExamples: input.shorterExamples,
    simplerExplanations: input.context.version === 2 && input.context.simplerExplanations === true,
    focus: [...input.focus],
    linkedItemIds,
  });
}

export interface LessonAdaptationView {
  declaredLevel?: TeachingAdaptation["declaredLevel"];
  goal?: TeachingAdaptation["goal"];
  shorterExamples: boolean;
  simplerExplanations: boolean;
  focus: Pick<PracticeCandidate, "target" | "reason" | "scope" | "lastEvidenceDate">[];
}

/**
 * What a saved lesson version was prepared with, limited to points still taught in the model
 * on screen. Older versions without the record show nothing rather than a guessed adaptation.
 */
export function lessonAdaptationView(
  generation: unknown,
  shown: readonly { id: string; study?: { en: string } }[],
): LessonAdaptationView | null {
  const record =
    typeof generation === "object" && generation !== null && "teachingAdaptation" in generation
      ? teachingAdaptationSchema.safeParse(generation.teachingAdaptation)
      : undefined;
  if (!record?.success) return null;
  const adaptation = record.data;
  const linked = new Set(adaptation.linkedItemIds);
  const shownTargets = new Set(
    shown.flatMap((item) => {
      const target = linked.has(item.id) && item.study ? studyLexicalTarget(item.study.en) : null;
      return target ? [target.text.toLocaleLowerCase("en")] : [];
    }),
  );
  return {
    ...(adaptation.declaredLevel ? { declaredLevel: adaptation.declaredLevel } : {}),
    ...(adaptation.goal ? { goal: adaptation.goal } : {}),
    shorterExamples: adaptation.shorterExamples,
    simplerExplanations: adaptation.simplerExplanations,
    focus: adaptation.focus
      .filter((candidate) => {
        const target = studyLexicalTarget(candidate.target);
        return !!target && shownTargets.has(target.text.toLocaleLowerCase("en"));
      })
      .map(({ target, reason, scope, lastEvidenceDate }) => ({
        target,
        reason,
        scope,
        lastEvidenceDate,
      })),
  };
}
