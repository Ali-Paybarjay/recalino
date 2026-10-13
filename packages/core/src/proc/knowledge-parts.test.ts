import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Claim, LearningItem } from "../lkm";
import type { RunSource } from "./contracts";
import { mergeLessonParts, planLessonParts } from "./knowledge-parts";

function audio(minutes: number): RunSource {
  return {
    sourceId: randomUUID(),
    contentVersionId: randomUUID(),
    objectId: null,
    sha256: "a".repeat(64),
    kind: "audio",
    mimeType: "audio/mpeg",
    role: "class_audio",
    durationMs: minutes * 60_000,
    pageCount: null,
    ranges: [],
    captureAnchor: null,
    units: Array.from({ length: minutes }, (_, index) => ({
      id: `u${index}`,
      kind: "time" as const,
      start: index * 60_000,
      end: index * 60_000 + 50_000,
      status: "extracted" as const,
    })),
    blocks: Array.from({ length: minutes }, (_, index) => ({
      id: `b${index}`,
      unitId: `u${index}`,
      kind: "transcript" as const,
      text: `Minute ${index}`,
    })),
  };
}
function photo(anchor?: { sourceId: string; offsetMs: number }): RunSource {
  return {
    ...audio(0),
    kind: "image",
    mimeType: "image/jpeg",
    role: "board_photo",
    durationMs: null,
    captureAnchor: anchor ? { ...anchor, state: "recording", timeStatus: "estimated" } : null,
    units: [{ id: "image-1", kind: "document", start: 1, status: "extracted" }],
    blocks: [{ id: "b", unitId: "image-1", kind: "paragraph", text: "Board" }],
  };
}

describe("D63 lesson parts plan", () => {
  it("splits 128 minutes into two equal parts of at most 90 minutes and follows photo anchors", () => {
    const recording = audio(128);
    const late = photo({ sourceId: recording.sourceId, offsetMs: 100 * 60_000 });
    const loose = photo();
    const parts = planLessonParts([recording, late, loose], 90, [late.sourceId]);
    expect(parts?.map((part) => part.sources.map((source) => source.kind))).toEqual([
      ["audio", "image"],
      ["audio", "image"],
    ]);
    expect(parts?.[0]?.sources[0]?.blocks).toHaveLength(64);
    expect(parts?.[1]?.sources[0]?.blocks[0]?.text).toBe("Minute 64");
    expect(parts?.[0]?.sources[1]?.sourceId).toBe(loose.sourceId);
    expect(parts?.[1]?.sources[1]?.sourceId).toBe(late.sourceId);
    expect(parts?.map((part) => part.missingSourceIds)).toEqual([[], [late.sourceId]]);
  });

  it("keeps one call for a class within one part and counts recordings one after another", () => {
    expect(planLessonParts([audio(90)], 90)).toBeNull();
    expect(planLessonParts([photo()], 90)).toBeNull();
    expect(planLessonParts([audio(60), audio(60)], 90)).toHaveLength(2);
  });
});

const claim = (text: string): Claim => ({
  id: "c",
  text,
  origin: "ai_expansion",
  creation: "ai_generation",
  evidence: "ai",
  sourceRefs: [],
  speakerRole: "unknown",
  uncertain: false,
});
function item(en: string, set: "production" | "recognition" = "production"): LearningItem {
  return {
    id: `item-${en}`,
    kind: "expression",
    front: en,
    back: "meaning",
    claim: claim(`Teaches ${en}`),
    study:
      set === "production"
        ? ({ set, en } as unknown as LearningItem["study"])
        : ({ set, en } as unknown as LearningItem["study"]),
  };
}
function part(items: LearningItem[], extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1" as const,
    title: "Part",
    language: { learning: "en" as const, explanation: "en" },
    summary: [claim("Shared summary")],
    topics: [],
    learningItems: items,
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    sourceClassifications: [],
    ...extra,
  };
}

describe("D63 lesson parts merge", () => {
  it("teaches a target once, interleaves parts and keeps the D62 limits", () => {
    const first = Array.from({ length: 15 }, (_, index) => item(`first ${index}`));
    const second = [
      item("First 0"),
      ...Array.from({ length: 15 }, (_, index) => item(`second ${index}`)),
    ];
    const merged = mergeLessonParts([part(first), part(second)]);
    const fronts = merged.learningItems.map((entry) => entry.front);
    expect(fronts).toHaveLength(18);
    expect(fronts.slice(0, 4)).toEqual(["first 0", "first 1", "second 0", "first 2"]);
    expect(fronts.filter((front) => front.toLowerCase() === "first 0")).toHaveLength(1);
    expect(new Set(merged.learningItems.map((entry) => entry.id)).size).toBe(18);
    expect(merged.summary).toHaveLength(1);
  });

  it("puts recognition after production and keeps a source used by any part", () => {
    const sourceId = randomUUID();
    const merged = mergeLessonParts([
      part([item("a", "recognition"), item("b")], {
        coverage: {
          complete: true,
          missingSourceIds: [],
          sources: [{ sourceId, status: "not_used", reason: "duplicate" }],
        },
      }),
      part([item("c")], {
        coverage: { complete: true, missingSourceIds: [], sources: [{ sourceId, status: "used" }] },
      }),
    ]);
    expect(merged.learningItems.map((entry) => entry.front)).toEqual(["c", "b", "a"]);
    expect(merged.coverage.sources).toEqual([{ sourceId, status: "used" }]);
  });
});
