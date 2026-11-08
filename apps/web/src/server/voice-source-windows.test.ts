import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VOICE_MODEL_REVISION } from "./voice-engine";
import {
  remapVoiceSegments,
  VOICE_CHECK_GAP_MS,
  VOICE_CHECK_MAX_MS,
  voiceSourceWindows,
} from "./voice-source-windows";

it("bounds the observed two-hour-eight-minute class while sampling speech near both ends", () => {
  const plan = voiceSourceWindows(7675883);
  expect(plan.sampled).toBe(true);
  expect(plan.windows).toHaveLength(8);
  const length =
    plan.windows.reduce((sum, window) => sum + window.end - window.start, 0) +
    (plan.windows.length - 1) * VOICE_CHECK_GAP_MS;
  expect(length).toBe(478000);
  expect(length).toBeLessThanOrEqual(VOICE_CHECK_MAX_MS);
  // Eight excerpts centred on equal eighths of the selection reach within 8 minutes of each end.
  expect(plan.windows[0]?.start).toBeLessThan(480000);
  expect(plan.windows.at(-1)?.end).toBeGreaterThan(7200000);
  for (let quarter = 0; quarter < 4; quarter++) {
    expect(
      plan.windows.some(
        (window) =>
          window.start >= (quarter * 7675883) / 4 && window.start < ((quarter + 1) * 7675883) / 4,
      ),
    ).toBe(true);
  }
  expect(
    plan.windows.every(
      (window, index) =>
        window.start >= 0 &&
        window.end <= 7675883 &&
        (!index || window.start > (plan.windows[index - 1]?.end ?? 0)),
    ),
  ).toBe(true);
  expect(voiceSourceWindows(7675883)).toEqual(plan);
});

it("keeps short selected ranges intact and samples longer disjoint selections without crossing their bounds", () => {
  const ranges = [
    { start: 10000, end: 16000 },
    { start: 20000, end: 26000 },
  ];
  expect(voiceSourceWindows(100000, ranges)).toEqual({ windows: ranges, sampled: false });
  const longRanges = [
    { start: 500000, end: 1500000 },
    { start: 5000000, end: 7000000 },
  ];
  const plan = voiceSourceWindows(7675883, longRanges);
  expect(plan.sampled).toBe(true);
  expect(plan.windows.some((window) => window.start >= 5000000)).toBe(true);
  expect(plan.windows.some((window) => window.end <= 1500000)).toBe(true);
  expect(
    plan.windows.every((window) =>
      longRanges.some((range) => window.start >= range.start && window.end <= range.end),
    ),
  ).toBe(true);
  const length =
    plan.windows.reduce((sum, window) => sum + window.end - window.start, 0) +
    (plan.windows.length - 1) * VOICE_CHECK_GAP_MS;
  expect(length).toBeLessThanOrEqual(VOICE_CHECK_MAX_MS);
});

it("merges overlapping and adjacent selections without reading gaps or changing the saved ranges", () => {
  const ranges = [
    { start: 80000, end: 85000 },
    { start: 20000, end: 30000 },
    { start: 10000, end: 25000 },
    { start: 30000, end: 35000 },
  ];
  const before = structuredClone(ranges);
  expect(voiceSourceWindows(100000, ranges)).toEqual({
    windows: [
      { start: 10000, end: 35000 },
      { start: 80000, end: 85000 },
    ],
    sampled: false,
  });
  expect(ranges).toEqual(before);
});

it.each([0, -1, 1000.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  "rejects an invalid verified duration %s before planning audio",
  (durationMs) => {
    expect(() => voiceSourceWindows(durationMs)).toThrow("voice_duration_invalid");
  },
);

it.each([
  ["negative start", { start: -1, end: 100 }],
  ["empty selection", { start: 100, end: 100 }],
  ["reversed selection", { start: 101, end: 100 }],
  ["past the verified original", { start: 0, end: 1001 }],
  ["fractional start", { start: 0.5, end: 100 }],
  ["fractional end", { start: 0, end: 100.5 }],
  ["unknown start", { start: Number.NaN, end: 100 }],
  ["unbounded end", { start: 0, end: Number.POSITIVE_INFINITY }],
] as const)("rejects %s without clamping the selected recording", (_label, range) => {
  expect(() => voiceSourceWindows(1000, [range])).toThrow("voice_selection_invalid");
});

it("restores original timestamps and rejects turns crossing silence seams or selection boundaries", () => {
  const base = { speakerId: "same-global-speaker", overlap: false, boundaryUnsafe: false };
  const segments = remapVoiceSegments(
    [
      { ...base, startMs: 1000, endMs: 8000 },
      { ...base, startMs: 13000, endMs: 19000 },
      { ...base, startMs: 9000, endMs: 14000 },
      { ...base, startMs: 12000, endMs: 15000 },
    ],
    [
      { sourceStartMs: 100000, compositeStartMs: 0, compositeEndMs: 10000 },
      { sourceStartMs: 7500000, compositeStartMs: 12000, compositeEndMs: 22000 },
    ],
  );
  expect(
    segments.map((segment) => [segment.startMs, segment.endMs, segment.boundaryUnsafe]),
  ).toEqual([
    [101000, 108000, false],
    [7501000, 7507000, false],
    [7500000, 7503000, true],
  ]);
  expect(segments.every((segment) => segment.speakerId === "same-global-speaker")).toBe(true);
});

it("drops seam-spanning and separator-only turns instead of inventing continuous source speech", () => {
  const base = { speakerId: "global-speaker-2", overlap: false, boundaryUnsafe: false };
  const windows = [
    { sourceStartMs: 100000, compositeStartMs: 0, compositeEndMs: 10000 },
    { sourceStartMs: 7500000, compositeStartMs: 12000, compositeEndMs: 22000 },
  ];
  expect(
    remapVoiceSegments(
      [
        { ...base, startMs: 9000, endMs: 13000 },
        { ...base, startMs: 10000, endMs: 12000 },
        { ...base, startMs: 10500, endMs: 11500 },
        { ...base, startMs: 11000, endMs: 15000 },
        { ...base, startMs: 21000, endMs: 23000 },
      ],
      windows,
    ),
  ).toEqual([]);
});

it.each([
  [0, 5000, true],
  [199, 5000, true],
  [200, 5000, false],
  [5000, 9800, false],
  [5000, 9801, true],
  [5000, 10000, true],
] as const)(
  "marks a remapped turn from %s to %s ms unsafe=%s at the exact selection boundary",
  (startMs, endMs, boundaryUnsafe) => {
    const base = { speakerId: "speaker-1", overlap: true, boundaryUnsafe: false };
    expect(
      remapVoiceSegments(
        [{ ...base, startMs, endMs }],
        [
          {
            sourceStartMs: 7500000,
            compositeStartMs: 0,
            compositeEndMs: 10000,
          },
        ],
      ),
    ).toEqual([
      {
        ...base,
        startMs: 7500000 + startMs,
        endMs: 7500000 + endMs,
        boundaryUnsafe,
      },
    ]);
  },
);

it("preserves an unsafe native boundary after moving it into the original recording", () => {
  expect(
    remapVoiceSegments(
      [
        {
          speakerId: "speaker-1",
          startMs: 13000,
          endMs: 17000,
          boundaryUnsafe: true,
          overlap: false,
        },
      ],
      [
        {
          sourceStartMs: 7500000,
          compositeStartMs: 12000,
          compositeEndMs: 22000,
        },
      ],
    ),
  ).toEqual([
    {
      speakerId: "speaker-1",
      startMs: 7501000,
      endMs: 7505000,
      boundaryUnsafe: true,
      overlap: false,
    },
  ]);
});

it("marks a turn unsafe when a voice it was heard over is rejected at an excerpt edge", () => {
  const windows = [
    { sourceStartMs: 100000, compositeStartMs: 0, compositeEndMs: 20000 },
    { sourceStartMs: 7500000, compositeStartMs: 22000, compositeEndMs: 42000 },
  ];
  const segment = (speakerId: string, startMs: number, endMs: number) => ({
    speakerId,
    startMs,
    endMs,
    overlap: true,
    boundaryUnsafe: false,
  });
  const kept = remapVoiceSegments(
    [
      segment("learner", 11000, 19000),
      // Runs a few frames into the silent separator, so it is rejected.
      segment("teacher", 16000, 20030),
      // A short reply still overlaps the learner, so the learner's turn has a partner left.
      segment("classmate", 11500, 12000),
      // Same voice as the rejected one only: never marks itself.
      segment("teacher", 2000, 9000),
    ],
    windows,
  );
  expect(kept.map((item) => [item.speakerId, item.boundaryUnsafe])).toEqual([
    ["learner", true],
    ["classmate", false],
    ["teacher", false],
  ]);
});

// P6-01 §1: since 34862cb remapVoiceSegments marks a turn boundaryUnsafe when it overlapped a
// rejected turn of another voice, and that decides which turns build the voiceprint. Its source
// text (read from disk, so no transpiler output is hashed) is pinned to the current
// VOICE_MODEL_REVISION so the rejection or boundaryUnsafe logic never changes silently.
it("pins the remapVoiceSegments boundaryUnsafe logic to the current VOICE_MODEL_REVISION", () => {
  const pinned = {
    revision: "sherpa-onnx-1.13.8_pyannote3-220ad67c_wespeaker-resnet34lm-e9848563",
    sourceSha256: {
      remapVoiceSegments: "ec13064b4e1f232e68372a32de6f29fcfb1c42f6e0084ccda33e6020979b3aab",
    },
  };
  const source = readFileSync(
    new URL("./voice-source-windows.ts", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const start = source.indexOf("export function remapVoiceSegments<");
  const end = source.indexOf("\n}\n", start);
  expect(start, "remapVoiceSegments not found in voice-source-windows.ts").toBeGreaterThanOrEqual(
    0,
  );
  expect(end, "end of remapVoiceSegments not found in voice-source-windows.ts").toBeGreaterThan(
    start,
  );
  const current = {
    remapVoiceSegments: createHash("sha256")
      .update(source.slice(start, end + 2))
      .digest("hex"),
  };
  expect(
    VOICE_MODEL_REVISION,
    "VOICE_MODEL_REVISION changed: update this pin to the new revision and its source hashes together",
  ).toBe(pinned.revision);
  expect(
    current,
    "remapVoiceSegments in voice-source-windows.ts changed under the same " +
      "VOICE_MODEL_REVISION. If its behaviour changed (which turns are rejected or marked " +
      "boundaryUnsafe, including the 200 ms edge margin): bump VOICE_MODEL_REVISION in " +
      "voice-engine.ts (stored voiceprints must be re-recorded), then update this pin to the new " +
      "revision and hashes. If its behaviour did not change (formatting or comments only): update " +
      "only the hash in this pin",
  ).toStrictEqual(pinned.sourceSha256);
});
