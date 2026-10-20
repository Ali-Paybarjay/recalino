import { STUDY_PRODUCTION_CEILING } from "../lkm";
import { learnerMarksIn } from "../src";
import type { RunSource } from "./contracts";

/**
 * Versioned lesson budget (lesson-quality-1). Item limits follow the model's real output limit
 * and the size of the class material actually extracted, instead of one fixed planning budget
 * that gave a single photo and a 128-minute class the same 4 production items.
 */
export const LESSON_BUDGET_VERSION = "lesson-budget-1";
/** A production item with pronunciation, teaching and evidence; also the legacy divisor. */
const PRODUCTION_ITEM_TOKENS = 1280;
const RECOGNITION_ITEM_TOKENS = 3072;
const CLAIM_TOKENS = 2048;
export const LESSON_PRODUCTION_MAXIMUM = 18;
/**
 * D78: each span the learner marked adds one production item, up to this lesson limit: what one
 * response of the lesson model (32000 output tokens) still holds.
 */
export const LESSON_MARKED_PRODUCTION_MAXIMUM = STUDY_PRODUCTION_CEILING;
export const LESSON_RECOGNITION_MAXIMUM = 6;
const CLAIM_MAXIMUM = 8;
/** Every lesson, however small, may keep a few core items. */
const BASE_PRODUCTION = 4;
/** One more production item per this many minutes of measured speech. */
const SPEECH_MINUTES_PER_ITEM = 8;
/** Production items a photo, PDF page or text page may add. */
const ITEMS_PER_VISUAL_PAGE = 2;

export interface LessonContentSize {
  /** Sum of the transcribed speech spans, never the declared recording length. */
  speechMinutes: number;
  /** PDF pages with extracted text. */
  pages: number;
  /** Photos with extracted text. */
  photos: number;
  /** Typed text or HTML, in page equivalents. */
  textPages: number;
  /** D78: distinct spans marked on photos or pages; absent when there are none. */
  markedSpans?: number;
}

/**
 * D110: invalid cards one model response may lose before its lesson takes the repair or failure
 * it took before: at most two, or a fifth of its production cards when that is more.
 */
export function invalidCardAllowance(productionCards: number): number {
  return Math.max(2, Math.floor(productionCards / 5));
}

/** D78: the lesson's production limit; without marks it stays LESSON_PRODUCTION_MAXIMUM. */
export function lessonProductionLimit(markedSpans = 0): number {
  return Math.min(LESSON_MARKED_PRODUCTION_MAXIMUM, LESSON_PRODUCTION_MAXIMUM + markedSpans);
}

export interface LessonBudget {
  version: typeof LESSON_BUDGET_VERSION;
  /** The model's own response limit (its override), not the legacy planning budget. */
  outputTokens: number;
  aimTokens: number;
  production: number;
  recognition: number;
  supplementaryClaims: number;
  /** The material would need more items than the model's response can hold. */
  compact: boolean;
  /** Production items the material alone would justify. */
  contentProduction: number;
  content: LessonContentSize;
}

const hasText = (block: { text: string }) => block.text.trim().length > 0;

/** Measures only extracted material; failed or empty units add nothing. */
export function measureLessonContent(
  sources: readonly RunSource[],
  charactersPerPage: number,
): LessonContentSize {
  let speechMs = 0;
  let pages = 0;
  let photos = 0;
  let textCharacters = 0;
  const marked = new Set<string>();
  for (const source of sources) {
    const withText = new Set(source.blocks.filter(hasText).map((block) => block.unitId));
    for (const block of source.blocks)
      for (const mark of learnerMarksIn(block.text, block.layout?.marks))
        marked.add(mark.text.toLowerCase());
    if (source.kind === "audio") {
      for (const unit of source.units)
        if (
          unit.kind === "time" &&
          unit.status === "extracted" &&
          unit.end !== undefined &&
          withText.has(unit.id)
        )
          speechMs += Math.max(0, unit.end - unit.start);
    } else if (source.kind === "pdf") {
      pages += new Set(
        source.units
          .filter((unit) => unit.kind === "page" && withText.has(unit.id))
          .map((unit) => unit.start),
      ).size;
    } else if (source.kind === "image") {
      if (withText.size) photos += 1;
    } else {
      textCharacters += source.blocks.reduce(
        (sum, block) => sum + Array.from(block.text).length,
        0,
      );
    }
  }
  return {
    speechMinutes: Math.round((speechMs / 60_000) * 10) / 10,
    pages,
    photos,
    textPages: textCharacters ? Math.ceil(textCharacters / Math.max(1, charactersPerPage)) : 0,
    ...(marked.size ? { markedSpans: marked.size } : {}),
  };
}

export function lessonBudget(outputTokens: number, content: LessonContentSize): LessonBudget {
  if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0)
    throw new RangeError("lesson budget output tokens");
  const marked = content.markedSpans ?? 0;
  const contentProduction = Math.min(
    lessonProductionLimit(marked),
    BASE_PRODUCTION +
      Math.floor(content.speechMinutes / SPEECH_MINUTES_PER_ITEM) +
      ITEMS_PER_VISUAL_PAGE * (content.pages + content.photos + content.textPages) +
      marked,
  );
  const capacity = Math.max(1, Math.floor(outputTokens / PRODUCTION_ITEM_TOKENS));
  const production = Math.max(1, Math.min(contentProduction, capacity));
  const recognition = Math.min(
    LESSON_RECOGNITION_MAXIMUM,
    Math.floor(outputTokens / RECOGNITION_ITEM_TOKENS),
    Math.max(1, Math.ceil(production / 3)),
  );
  const supplementaryClaims = Math.max(
    1,
    Math.min(
      CLAIM_MAXIMUM,
      Math.floor(outputTokens / CLAIM_TOKENS),
      2 + Math.floor(production / 4),
    ),
  );
  return {
    version: LESSON_BUDGET_VERSION,
    outputTokens,
    aimTokens: Math.floor(outputTokens * 0.75),
    production,
    recognition,
    supplementaryClaims,
    compact: capacity < contentProduction,
    contentProduction,
    content,
  };
}
