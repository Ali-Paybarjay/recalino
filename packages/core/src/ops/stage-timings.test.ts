import { expect, it } from "vitest";
import {
  hiddenSeconds,
  percentile,
  type RunTimes,
  stageDurations,
  summarize,
} from "./stage-timings";

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 9, 12, 11, minute, second));
// The in-app capture of 2026-10-12 (FIVE_PROBLEMS_ROOT_CAUSE section 3.3), as timestamps only.
const capture: RunTimes = {
  runId: "00000000-0000-4000-8000-000000000001",
  state: "ready",
  createdAt: at(5, 5),
  finishedAt: at(25, 55),
  uploadStartedAt: at(5, 14),
  uploadVerifiedAt: at(16, 18),
  sttStartedAt: at(16, 20),
  sttFinishedAt: at(16, 59),
  visionStartedAt: at(17, 0),
  visionFinishedAt: at(17, 45),
  lessonStartedAt: at(17, 45),
  lessonFinishedAt: at(19, 3),
  voiceStartedAt: at(17, 54),
  voiceFinishedAt: at(25, 48),
  foregroundGaps: [],
};

it("NFR-07 splits a class run into upload, provider, voice and publication stages", () => {
  expect(stageDurations(capture)).toEqual({
    upload_wait: 9,
    upload_transfer: 664,
    queue: 2,
    transcription: 39,
    board_photos: 45,
    lesson: 78,
    voice: 474,
    publication: 7,
    total: 1250,
    device_hidden: 0,
  });
});

it("counts the device's reported hidden time inside the run only (D71)", () => {
  const gaps = [
    { hiddenAt: at(3), visibleAt: at(6) }, // before the run: 55 s inside
    { hiddenAt: at(8), visibleAt: at(9, 30) }, // 90 s inside
    { hiddenAt: at(25), visibleAt: at(40) }, // past the finish: 55 s inside
  ];
  expect(hiddenSeconds(gaps, capture.createdAt, capture.finishedAt)).toBe(200);
  expect(stageDurations({ ...capture, foregroundGaps: gaps }).device_hidden).toBe(200);
  // An unfinished run counts everything after its creation.
  expect(stageDurations({ ...capture, finishedAt: null, foregroundGaps: gaps }).device_hidden).toBe(
    1045,
  );
  expect(summarize([{ ...capture, foregroundGaps: gaps }, capture]).stages.device_hidden).toEqual({
    runs: 2,
    p50: 0,
    p95: 200,
  });
});

it("leaves stages a run never reached unmeasured instead of zero", () => {
  const text: RunTimes = {
    ...capture,
    uploadStartedAt: null,
    uploadVerifiedAt: null,
    sttStartedAt: null,
    sttFinishedAt: null,
    voiceStartedAt: null,
    voiceFinishedAt: null,
    finishedAt: null,
    state: "processing",
  };
  const stages = stageDurations(text);
  expect(stages.upload_wait).toBeNull();
  expect(stages.transcription).toBeNull();
  expect(stages.total).toBeNull();
  expect(stages.queue).toBe(715);
});

it("reports nearest-rank p50 and p95 per stage", () => {
  expect(percentile([], 50)).toBeNull();
  expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
  expect(
    percentile(
      Array.from({ length: 20 }, (_, i) => i + 1),
      95,
    ),
  ).toBe(19);
  const report = summarize([capture, { ...capture, runId: "second", finishedAt: at(30) }]);
  expect(report.runs).toBe(2);
  expect(report.stages.total).toEqual({ runs: 2, p50: 1250, p95: 1495 });
  expect(report.stages.upload_transfer).toEqual({ runs: 2, p50: 664, p95: 664 });
});
