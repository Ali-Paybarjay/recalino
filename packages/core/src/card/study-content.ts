import { z } from "zod";
import { type KnowledgeModel, type LearningItem, renderStudyCard } from "../lkm";

const metadataSchema = z.strictObject({
  contentFormat: z.literal("lesson_html"),
  studySet: z.enum(["production", "recognition"]),
  studyTags: z.array(z.string().min(1).max(100)).max(20),
  studyPosition: z.number().int().nonnegative(),
});
export type StudyMetadata = z.infer<typeof metadataSchema>;

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
  });
  return result.success ? JSON.stringify(result.data) : null;
}

export function studyCardContent(item: LearningItem, model: KnowledgeModel) {
  if (!item.study) return { front: item.front, back: item.back, study_metadata: null };
  const faces = renderStudyCard(item);
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
    } satisfies StudyMetadata),
  };
}
