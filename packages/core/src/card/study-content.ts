import { z } from "zod";
import {
  type KnowledgeModel,
  type LearningItem,
  renderStudyCard,
  studyLexicalTarget,
  studyLexicalTargetMatches,
} from "../lkm";

const pronunciationTargetSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (text) =>
      /\p{Script=Latin}/u.test(text) &&
      !/[^\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Mark}]/u.test(text) &&
      !/[<>{}[\]\\]|&(?:#\d+|[a-z]+);/iu.test(text),
  );
const metadataSchema = z.strictObject({
  contentFormat: z.literal("lesson_html"),
  studySet: z.enum(["production", "recognition"]),
  studyTags: z.array(z.string().min(1).max(100)).max(20),
  studyPosition: z.number().int().nonnegative(),
  pronunciationTarget: pronunciationTargetSchema.nullable().optional(),
});
export type StudyMetadata = z.infer<typeof metadataSchema>;

/** AC-D46-01: only a structured English headword/frame can become speech, never card HTML. */
export function studyPronunciationTarget(item: LearningItem): string | undefined {
  if (!item.study) return undefined;
  const target = studyLexicalTarget(item.study.en);
  if (!target) return undefined;
  if (target.parts.length === 1) {
    const spoken = pronunciationTargetSchema.safeParse(target.text);
    return spoken.success ? spoken.data : undefined;
  }
  // A separable frame can be pronounced naturally only when both saved sentences agree.
  if (item.study.set !== "production" || !item.study.gapSentence) return undefined;
  const parts = item.study.gapSentence.split("______");
  if (parts.length < 2 || parts.length > 4) return undefined;
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const full = item.study.fullSentence;
  if (!new RegExp(`^${escaped.join("(.+?)")}$`, "u").test(full)) return undefined;
  const span = full.slice(parts[0]?.length ?? 0, full.length - (parts.at(-1)?.length ?? 0));
  const spoken = pronunciationTargetSchema.safeParse(span);
  const realised = spoken.success ? studyLexicalTarget(spoken.data) : undefined;
  return spoken.success &&
    realised?.text === spoken.data &&
    studyLexicalTargetMatches(target, spoken.data)
    ? spoken.data
    : undefined;
}

export function readStudyMetadata(value: unknown): Partial<StudyMetadata> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  const result = metadataSchema.safeParse(value);
  return result.success ? result.data : {};
}

export function savedStudyMetadata(value: Partial<StudyMetadata>): string | null {
  const result = metadataSchema.safeParse({
    contentFormat: value.contentFormat,
    studySet: value.studySet,
    studyTags: value.studyTags,
    studyPosition: value.studyPosition,
    pronunciationTarget: value.pronunciationTarget,
  });
  return result.success ? JSON.stringify(result.data) : null;
}

export function studyCardContent(item: LearningItem, model: KnowledgeModel) {
  if (!item.study) return { front: item.front, back: item.back, study_metadata: null };
  const faces = renderStudyCard(item, model.language.explanation);
  const studyTags = [
    model.classNotes?.date,
    model.classNotes?.course?.replace(/\s+/g, "_"),
    ...item.study.topic.split(/\s+/),
    item.study.kind,
    item.study.set,
  ]
    .filter((tag): tag is string => !!tag)
    .map((tag) => tag.replace(/[^\p{L}\p{N}_:.-]/gu, "_").slice(0, 100));
  return {
    ...faces,
    study_metadata: JSON.stringify({
      contentFormat: "lesson_html",
      studySet: item.study.set,
      studyTags: [...new Set(studyTags)],
      studyPosition: model.learningItems.findIndex((entry) => entry.id === item.id),
      pronunciationTarget: studyPronunciationTarget(item) ?? null,
    } satisfies StudyMetadata),
  };
}
