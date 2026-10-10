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

it("D55: clean turns come first, then the longest, at most three, in recording order", () => {
  const [voice] = withListeningClips(
    [candidate("learner")],
    [
      line("a", "learner", 0, 1000),
      line("b", "learner", 5000, 25000),
      line("c", "learner", 40000, 42500, true),
      line("d", "learner", 50000, 53000),
      line("e", "learner", 60000, 60000),
      line("f", "learner", 5000, 25000),
    ],
  );
  expect(voice?.clips).toEqual([
    // A long line is cut to ten seconds; an identical interval is offered once.
    { startMs: 5000, endMs: 15000, text: "Line b" },
    { startMs: 40000, endMs: 42500, text: "Line c" },
    { startMs: 50000, endMs: 53000, text: "Line d" },
  ]);
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
