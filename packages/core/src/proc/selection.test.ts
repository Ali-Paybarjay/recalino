import { expect, it } from "vitest";
import type { RunSource } from "./contracts";
import { processingSelectionFingerprint } from "./selection";

const source: RunSource = {
  sourceId: "12345678-1234-4234-8234-123456789abc",
  kind: "audio",
  sha256: "a".repeat(64),
  mimeType: "audio/mpeg",
  durationMs: 4000,
  pageCount: null,
  objectId: null,
  contentVersionId: null,
  role: "class_audio",
  captureAnchor: null,
  ranges: [{ start: 1000, end: 2000 }],
  units: [],
  blocks: [],
};
function fingerprint(sources: RunSource[]) {
  return processingSelectionFingerprint({ sources });
}

it("keeps the completed selection stable when verification and extraction add metadata", () => {
  expect(
    fingerprint([
      {
        ...source,
        durationMs: 3900,
        objectId: "12345678-1234-4234-8234-123456789def",
        contentVersionId: "12345678-1234-4234-8234-123456789aaa",
        role: "user_notes",
        pageCount: 2,
        units: [{ id: "transcript", kind: "time", start: 1000, end: 2000, status: "extracted" }],
        blocks: [{ id: "text", unitId: "transcript", kind: "transcript", text: "Class content" }],
      },
    ]),
  ).toBe(fingerprint([source]));
});

it("does not treat the order of attached materials as a different selection", () => {
  const second = { ...source, sourceId: "12345678-1234-4234-8234-123456789def" };
  expect(fingerprint([source, second])).toBe(fingerprint([second, source]));
});

it.each([
  { sourceId: "12345678-1234-4234-8234-123456789def" },
  { kind: "image" as const },
  { sha256: "b".repeat(64) },
  { ranges: [] },
  {
    captureAnchor: {
      sourceId: "12345678-1234-4234-8234-123456789def",
      offsetMs: 2000,
      state: "recording" as const,
      timeStatus: "user_confirmed" as const,
    },
  },
])("requires another confirmation when selected material or its range changes: %j", (change) => {
  expect(fingerprint([{ ...source, ...change }])).not.toBe(fingerprint([source]));
});

it("detects newly added and removed materials", () => {
  const second = { ...source, sourceId: "12345678-1234-4234-8234-123456789def" };
  expect(fingerprint([source, second])).not.toBe(fingerprint([source]));
  expect(fingerprint([])).not.toBe(fingerprint([source]));
});
