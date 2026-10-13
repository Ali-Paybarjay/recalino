import { expect, it } from "vitest";
import { voiceEnginePool } from "./voice-engine";
import { targetTurnSpans } from "./voice-engine-quality.mjs";

const segment = (speakerId: string, startMs: number, endMs: number) => ({
  speakerId,
  startMs,
  endMs,
  overlap: false,
  boundaryUnsafe: endMs - startMs < 2400,
});

it("draft FR-VOC v3: short clean turns are kept for target-speaker scoring", () => {
  const spans = targetTurnSpans(
    [
      segment("teacher", 1000, 9000),
      // The learner's 1.8 s answer: too short for a voiceprint span, long enough for a turn.
      segment("learner", 9300, 11100),
      // 1.2 s: below the minimum.
      segment("learner", 12000, 13200),
      // Crosses a splice at 20 000 ms.
      segment("learner", 19500, 22000),
      // Touches the composite's end.
      segment("teacher", 29000, 29950),
    ],
    30000,
    0,
    [20000],
    1500,
  );
  expect(spans).toEqual([
    { speakerId: "teacher", startMs: 1100, endMs: 8900 },
    { speakerId: "learner", startMs: 9400, endMs: 11000 },
  ]);
});

it("draft FR-VOC v3: speech near another voice is cut away, and a turn is capped at 10 s", () => {
  const spans = targetTurnSpans(
    [segment("a", 1000, 30000), segment("b", 5000, 6000)],
    60000,
    0,
    [],
    1500,
  );
  // The longest clean part of a's turn, after b's turn and a 200 ms margin, capped at 10 s.
  expect(spans).toEqual([{ speakerId: "a", startMs: 6200, endMs: 16200 }]);
});

it("workstream 4: the native pool never runs more workers than CPUs, at most three", () => {
  expect(voiceEnginePool(1)).toEqual({ workers: 1, threadsPerWorker: 1 });
  expect(voiceEnginePool(2)).toEqual({ workers: 2, threadsPerWorker: 1 });
  expect(voiceEnginePool(8)).toEqual({ workers: 3, threadsPerWorker: 2 });
});
