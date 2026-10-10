import { expect, it } from "vitest";
import type { VoiceCandidate, VoiceUtterance } from "./contracts";
import { withListeningClips } from "./listening";

const candidate = (id: string, clips: VoiceCandidate["clips"] = []): VoiceCandidate => ({
  id,
  label: id,
  score: null,
  cleanSpeechMs: 0,
  clips,
  lines: ["A saved line."],
});
const line = (
  id: string,
  speakerId: string,
  startMs: number,
  endMs: number,
  eligible = false,
): VoiceUtterance => ({ id, speakerId, startMs, endMs, text: `Line ${id}`, eligible });

it("D55: a voice with only saved lines gets its own timed lines as excerpts to play", () => {
  const [voice] = withListeningClips(
    [candidate("learner")],
    [line("short", "learner", 30000, 34860), line("other", "teacher", 1000, 9000)],
  );
  expect(voice?.clips).toEqual([{ startMs: 30000, endMs: 34860, text: "Line short" }]);
});

it("D55: clean turns come first, then the longest, at most three, best first", () => {
  const [voice] = withListeningClips(
    [candidate("learner")],
    [
      line("early", "learner", 0, 600),
      line("long", "learner", 5000, 25000),
      line("same", "learner", 5000, 25000),
      line("mid", "learner", 40000, 47000),
      line("other", "learner", 50000, 56000),
      line("clean", "learner", 60000, 61000, true),
      line("empty", "learner", 70000, 70000),
    ],
  );
  expect(voice?.clips).toEqual([
    // The one clean turn wins although it is the shortest kept line.
    { startMs: 60000, endMs: 61000, text: "Line clean" },
    // A long line is cut to ten seconds; an identical interval is offered once.
    { startMs: 5000, endMs: 15000, text: "Line long" },
    { startMs: 40000, endMs: 47000, text: "Line mid" },
  ]);
});

it("never turns an empty interval into an excerpt", () => {
  const [voice] = withListeningClips(
    [candidate("learner")],
    [line("empty", "learner", 70000, 70000)],
  );
  expect(voice?.clips).toEqual([]);
});

it("keeps stored excerpts and leaves a voice without timed lines unchanged", () => {
  const stored = [{ startMs: 2000, endMs: 8000, text: "" }];
  const result = withListeningClips(
    [candidate("heard", stored), candidate("silent")],
    [line("x", "heard", 20000, 30000, true)],
  );
  expect(result[0]?.clips).toBe(stored);
  expect(result[1]?.clips).toEqual([]);
});
