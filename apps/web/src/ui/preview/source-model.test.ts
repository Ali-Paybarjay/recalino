import { describe, expect, it } from "vitest";
import type { SampleSource } from "./PreviewContext";
import {
  confirmedSources,
  selectedCost,
  sourceHasDetails,
  sourceIsReady,
  withSampleCount,
} from "./source-model";

function source(patch: Partial<SampleSource> = {}): SampleSource {
  return {
    id: "sample-audio",
    name: "Class recording",
    kind: "audio",
    durationMinutes: 20,
    pages: 0,
    selected: true,
    role: "Class teaching",
    status: "Received",
    rangeStart: 0,
    rangeEnd: 20,
    ...patch,
  };
}

describe("confirmed sample source inputs", () => {
  it("leaves unknown or invalid counts unconfirmed and outside the estimate", () => {
    for (const count of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const unknown = withSampleCount(source(), count);
      expect(unknown.durationMinutes).toBe(0);
      expect(unknown.status).toBe("Needs details");
      expect(unknown.selected).toBe(false);
      expect(sourceHasDetails(unknown)).toBe(false);
      expect(sourceIsReady(unknown)).toBe(false);
      expect(selectedCost([{ ...unknown, selected: true }])).toEqual({ minutes: 0, pages: 0 });
    }
  });

  it("clamps editable counts and ranges while requiring confirmation again", () => {
    const audio = withSampleCount(source(), 10001);
    expect(audio.durationMinutes).toBe(10000);
    expect(audio.rangeEnd).toBeLessThanOrEqual(audio.durationMinutes);
    expect(audio.status).toBe("Needs details");
    expect(sourceIsReady(audio)).toBe(false);

    const pdf = withSampleCount(
      source({ kind: "pdf", durationMinutes: 0, pages: 20, rangeStart: 8, rangeEnd: 15 }),
      3.9,
    );
    expect(pdf.pages).toBe(3);
    expect(pdf.rangeStart).toBe(3);
    expect(pdf.rangeEnd).toBe(3);
    expect(sourceHasDetails(pdf)).toBe(true);
    expect(pdf.selected).toBe(false);
  });

  it("counts fractional audio ranges and both ends of a PDF range", () => {
    expect(
      selectedCost([
        source({ rangeStart: 2.25, rangeEnd: 6.75 }),
        source({
          id: "handout",
          kind: "pdf",
          durationMinutes: 0,
          pages: 8,
          rangeStart: 2,
          rangeEnd: 4,
        }),
        source({ id: "photo", kind: "photo", durationMinutes: 0, pages: 1 }),
      ]),
    ).toEqual({ minutes: 4.5, pages: 4 });
  });

  it("does not charge retrying, incomplete, invalid or excluded inputs", () => {
    expect(
      selectedCost([
        source({ id: "failed", status: "Needs retry" }),
        source({ id: "retrying", status: "Retrying" }),
        source({ id: "unknown", durationMinutes: 0, rangeEnd: 0 }),
        source({ id: "invalid", rangeStart: 10, rangeEnd: 5 }),
        source({ id: "excluded", selected: false }),
      ]),
    ).toEqual({ minutes: 0, pages: 0 });
  });

  it("deduplicates a reused source and fixes its inputs independently of later edits", () => {
    const original = source({ rangeStart: 3, rangeEnd: 10 });
    const duplicate = { ...original };
    const inputs = confirmedSources([original, duplicate]);
    expect(inputs).toHaveLength(1);
    expect(selectedCost([original, duplicate])).toEqual({ minutes: 7, pages: 0 });

    original.name = "Later title";
    original.rangeEnd = 5;
    duplicate.selected = false;
    expect(inputs[0]).toMatchObject({ name: "Class recording", rangeStart: 3, rangeEnd: 10 });
    expect(selectedCost(inputs)).toEqual({ minutes: 7, pages: 0 });

    const firstInput = inputs[0];
    if (!firstInput) throw new Error("Expected the confirmed source snapshot.");
    firstInput.rangeStart = 0;
    expect(original.rangeStart).toBe(3);
    expect(duplicate.rangeStart).toBe(3);
  });
});
