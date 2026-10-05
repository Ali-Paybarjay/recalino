export type SampleMaterialMetadata = { title: string; topics: string[] };
type SampleClassIdentity = { title: string; date: string; customTitle?: string | null };

// Authored demonstration output. This metadata is never extracted from uploaded files.
export const PREPARED_SAMPLE_MATERIAL: SampleMaterialMetadata = {
  title: "Present perfect",
  topics: ["Present perfect", "Already and yet", "Past participles"],
};

export function sampleCustomTitle(lesson: SampleClassIdentity): string | null {
  // Older saved previews had only a display title. Preserve a historical named class.
  if (lesson.customTitle === undefined) return lesson.title === lesson.date ? null : lesson.title;
  return lesson.customTitle?.trim() || null;
}

export function sampleClassSummary(
  lesson: SampleClassIdentity,
  material?: SampleMaterialMetadata | null,
): { title: string; titleSource: "manual" | "material" | "date"; topics: string[] } {
  const customTitle = sampleCustomTitle(lesson);
  if (customTitle)
    return { title: customTitle, titleSource: "manual", topics: material?.topics ?? [] };
  if (material?.title.trim())
    return { title: material.title, titleSource: "material", topics: material.topics };
  return { title: lesson.date, titleSource: "date", topics: [] };
}
