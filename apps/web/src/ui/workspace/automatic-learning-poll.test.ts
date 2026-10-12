import { expect, it } from "vitest";
import type { AutomaticLearningStatus } from "./automatic-learning";
import {
  LEARNING_POLL,
  LearningPollSchedule,
  learningWorkOngoing,
  manualAudioPollDelay,
} from "./automatic-learning-poll";

const status = (
  state: AutomaticLearningStatus["state"],
  patch: Partial<AutomaticLearningStatus> = {},
) => ({ state, revision: 1, run: null, ...patch }) as AutomaticLearningStatus;
function clock() {
  let now = 0;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}
const visible = { viewed: false, local: false, hidden: false };

it("reads an idle class once, then only when an event wakes it (2026-10-12: 7 idle classes)", () => {
  const time = clock();
  const polls = new LearningPollSchedule(time.now);
  const classes = Array.from({ length: 7 }, (_, i) => `class-${i}`);
  let requests = 0;
  // Two hours of the provider's 3 s timer.
  for (let tick = 0; tick < (2 * 3600 * 1000) / LEARNING_POLL.baseMs; tick++) {
    for (const id of classes)
      if (polls.due(id, { ...visible, status: status("ready") })) {
        requests++;
        polls.observed(id, status("ready"));
      }
    time.advance(LEARNING_POLL.baseMs);
  }
  expect(requests).toBe(7);
  polls.wake("class-3");
  expect(polls.due("class-3", { ...visible, status: status("ready") })).toBe(true);
  expect(polls.due("class-4", { ...visible, status: status("ready") })).toBe(false);
});

it("backs off an unchanged class in progress and restarts after a change", () => {
  const time = clock();
  const polls = new LearningPollSchedule(time.now);
  const processing = status("processing");
  const reads: number[] = [];
  for (let tick = 0; tick < 200; tick++) {
    if (polls.due("class", { ...visible, status: processing })) {
      reads.push(time.now());
      polls.observed("class", processing);
    }
    time.advance(1000);
  }
  const gaps = reads.slice(1).map((at, i) => at - (reads[i] ?? 0));
  expect(gaps.slice(0, 5)).toEqual([3000, 6000, 12000, 24000, 48000]);
  expect(Math.max(...gaps)).toBeLessThanOrEqual(LEARNING_POLL.maxMs);
  polls.observed("class", status("ready"));
  time.advance(LEARNING_POLL.baseMs);
  // The change restarted the interval; a ready class not on screen is then left alone.
  expect(polls.due("class", { ...visible, status: status("ready") })).toBe(false);
  expect(polls.due("class", { ...visible, viewed: true, status: status("ready") })).toBe(true);
});

it("pauses while the page is hidden except for work only this device can start", () => {
  const polls = new LearningPollSchedule(() => 0);
  const waiting = status("waiting_upload");
  expect(polls.due("class", { ...visible, hidden: true, status: waiting })).toBe(false);
  expect(polls.due("class", { ...visible, hidden: true, local: true, status: waiting })).toBe(true);
});

it("keeps the viewed class and device work readable while idle, with backoff", () => {
  const time = clock();
  const polls = new LearningPollSchedule(time.now);
  polls.observed("class", status("idle"));
  expect(polls.due("class", { ...visible, viewed: true, status: status("idle") })).toBe(false);
  time.advance(LEARNING_POLL.baseMs);
  expect(polls.due("class", { ...visible, viewed: true, status: status("idle") })).toBe(true);
  expect(polls.due("class", { ...visible, local: true, status: status("idle") })).toBe(true);
  expect(polls.due("class", { ...visible, status: status("idle") })).toBe(false);
});

it("treats unknown status and runs still awaiting upload or processing as ongoing work", () => {
  expect(learningWorkOngoing(undefined)).toBe(true);
  expect(learningWorkOngoing(status("blocked"))).toBe(false);
  expect(
    learningWorkOngoing(
      status("idle", { run: { state: "awaiting_upload" } as AutomaticLearningStatus["run"] }),
    ),
  ).toBe(true);
});

it("checks saved audio transfers often only while one is moving", () => {
  expect(manualAudioPollDelay([])).toBeNull();
  expect(manualAudioPollDelay([{ phase: "attention" }])).toBe(LEARNING_POLL.maxMs);
  expect(manualAudioPollDelay([{ phase: "attention" }, { phase: "verifying" }])).toBe(
    LEARNING_POLL.baseMs,
  );
});
