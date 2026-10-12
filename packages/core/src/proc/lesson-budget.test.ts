import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RunSource } from "./contracts";
import { LESSON_BUDGET_VERSION, lessonBudget, measureLessonContent } from "./lesson-budget";

function source(kind: RunSource["kind"], patch: Partial<RunSource> = {}): RunSource {
  return {
    sourceId: randomUUID(),
    contentVersionId: randomUUID(),
    objectId: randomUUID(),
    sha256: "a".repeat(64),
    kind,
    mimeType: "text/plain",
    role: kind === "audio" ? "class_audio" : "class_material",
    durationMs: null,
    pageCount: null,
    ranges: [],
    captureAnchor: null,
    units: [],
    blocks: [],
    ...patch,
  };
}

/** Synthetic speech: one extracted segment per minute, `minutes` long. */
function speech(minutes: number, declaredMinutes = minutes): RunSource {
  return source("audio", {
    durationMs: declaredMinutes * 60_000,
    units: Array.from({ length: minutes }, (_, index) => ({
      id: `u${index}`,
      kind: "time" as const,
      start: index * 60_000,
      end: (index + 1) * 60_000,
      status: "extracted" as const,
    })),
    blocks: Array.from({ length: minutes }, (_, index) => ({
      id: `b${index}`,
      kind: "transcript" as const,
      unitId: `u${index}`,
      text: "Synthetic class speech.",
    })),
  });
}
function photo(text = "Synthetic board line"): RunSource {
  return source("image", {
    units: [{ id: "image-1", kind: "document", start: 1, status: text ? "extracted" : "failed" }],
    blocks: text ? [{ id: "b1", kind: "paragraph", unitId: "image-1", text }] : [],
  });
}

describe("lesson-quality-1 lesson budget (diagnosis 2026-10-12 §5.2)", () => {
  it("measures transcribed speech, not the declared recording length", () => {
    const content = measureLessonContent([speech(25, 77), photo(), photo("")], 3000);
    expect(content).toEqual({ speechMinutes: 25, pages: 0, photos: 1, textPages: 0 });
  });

  it("counts PDF pages with text and typed text in page equivalents", () => {
    const pdf = source("pdf", {
      units: [
        { id: "p1", kind: "page", start: 1, status: "extracted" },
        { id: "p2", kind: "page", start: 2, status: "extracted" },
        { id: "p3", kind: "page", start: 3, status: "failed" },
      ],
      blocks: [
        { id: "a", kind: "paragraph", unitId: "p1", text: "Page one" },
        { id: "b", kind: "paragraph", unitId: "p2", text: "Page two" },
        { id: "c", kind: "paragraph", unitId: "p3", text: " " },
      ],
    });
    const text = source("text", {
      units: [{ id: "d", kind: "document", start: 1, status: "extracted" }],
      blocks: [{ id: "t", kind: "paragraph", unitId: "d", text: "x".repeat(4500) }],
    });
    expect(measureLessonContent([pdf, text], 3000)).toEqual({
      speechMinutes: 0,
      pages: 2,
      photos: 0,
      textPages: 2,
    });
  });

  it("scales with the material up to 18 production and 6 recognition items", () => {
    const empty = { speechMinutes: 0, pages: 0, photos: 0, textPages: 0 };
    const onePhoto = lessonBudget(32000, { ...empty, photos: 1 });
    const longClass = lessonBudget(32000, { ...empty, speechMinutes: 128, photos: 6 });
    const recorded = lessonBudget(32000, { ...empty, speechMinutes: 25.5, photos: 5 });
    expect(onePhoto).toMatchObject({
      version: LESSON_BUDGET_VERSION,
      production: 6,
      recognition: 2,
      compact: false,
    });
    expect(recorded.production).toBe(17);
    expect(longClass).toMatchObject({ production: 18, recognition: 6, compact: false });
    expect(longClass.supplementaryClaims).toBeLessThanOrEqual(8);
    expect(longClass.aimTokens).toBe(24000);
  });

  it("is compact only when the model's own response limit cannot hold the material", () => {
    const content = { speechMinutes: 128, pages: 0, photos: 0, textPages: 0 };
    // The legacy 6144 planning budget: the same 4 production items as before, now flagged.
    expect(lessonBudget(6144, content)).toMatchObject({
      production: 4,
      recognition: 2,
      compact: true,
      contentProduction: 18,
    });
    expect(lessonBudget(6144, { ...content, speechMinutes: 0 })).toMatchObject({
      production: 4,
      compact: false,
    });
    expect(() => lessonBudget(0, content)).toThrow();
  });
});
