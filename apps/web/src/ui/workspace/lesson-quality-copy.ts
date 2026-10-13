/**
 * Workstream 3 (lesson quality, docs/plans/LESSON_QUALITY_2026-10-12.md). The product owner
 * approved these eight texts word for word on 2026-10-13 (D65 review).
 */
export const lessonQualityCopy = {
  coverage: {
    title: "Material not used in these notes",
    reason: {
      unreadable: "This file could not be read clearly enough to teach from.",
      duplicate: "This file repeats material that another file already teaches.",
      off_topic: "This file does not contain lesson content.",
      outside_selection: "This file is outside the part of the session you selected.",
      no_teaching_content: "This file has nothing to teach on its own.",
      not_reported: "This file was not used in these notes.",
    },
  },
  review: {
    tooLarge:
      "This session has more material than one AI lesson review can check, so a review is not available for it.",
  },
} as const;
