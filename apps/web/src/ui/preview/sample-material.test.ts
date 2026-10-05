import { describe, expect, it } from "vitest";
import { PREPARED_SAMPLE_MATERIAL, sampleClassSummary } from "./sample-material";

describe("D40 sample session titles from explicit material metadata", () => {
  it("uses the date before material exists and the prepared title and topics afterwards", () => {
    const lesson = { title: "2026-10-04", date: "2026-10-04", customTitle: null };
    expect(sampleClassSummary(lesson)).toEqual({
      title: "2026-10-04",
      titleSource: "date",
      topics: [],
    });
    expect(sampleClassSummary(lesson, PREPARED_SAMPLE_MATERIAL)).toEqual({
      title: "Present perfect",
      titleSource: "material",
      topics: ["Present perfect", "Already and yet", "Past participles"],
    });
  });

  it("preserves a custom title while keeping material topics, and clearing it restores auto", () => {
    const lesson = {
      title: "My evening lesson",
      date: "2026-10-04",
      customTitle: "My evening lesson",
    };
    expect(sampleClassSummary(lesson, PREPARED_SAMPLE_MATERIAL)).toMatchObject({
      title: "My evening lesson",
      titleSource: "manual",
      topics: PREPARED_SAMPLE_MATERIAL.topics,
    });
    expect(
      sampleClassSummary({ ...lesson, customTitle: null }, PREPARED_SAMPLE_MATERIAL),
    ).toMatchObject({
      title: "Present perfect",
      titleSource: "material",
    });
  });

  it("preserves legacy named classes and allows legacy date fallbacks to receive a material title", () => {
    expect(
      sampleClassSummary(
        { title: "Historical custom title", date: "2026-10-04" },
        PREPARED_SAMPLE_MATERIAL,
      ),
    ).toMatchObject({
      title: "Historical custom title",
      titleSource: "manual",
    });
    expect(
      sampleClassSummary({ title: "2026-10-04", date: "2026-10-04" }, PREPARED_SAMPLE_MATERIAL),
    ).toMatchObject({
      title: "Present perfect",
      titleSource: "material",
    });
  });
});
