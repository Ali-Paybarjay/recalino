// Owner decision 2026-10-12 (publication waits for the voice check): name that wait honestly.
import { expect, it } from "vitest";
import { finishingStage } from "./run-stage";

const source = (kind: string) => ({
  sourceId: "10000000-0000-4000-8000-000000000001",
  kind,
  sha256: "a".repeat(64),
  mimeType: kind === "audio" ? "audio/mp4" : "application/pdf",
  durationMs: kind === "audio" ? 60_000 : null,
  pageCount: kind === "audio" ? null : 1,
  objectId: null,
  contentVersionId: null,
});
const snapshot = (...kinds: string[]) => ({
  sourcesVersion: 1,
  fingerprint: "f",
  sources: kinds.map(source),
});

it("reports a voice check only after the lesson is written, for audio with voice enabled", () => {
  const base = { state: "processing", lessonWritten: true, voiceEnabled: true };
  expect(finishingStage({ ...base, snapshot: snapshot("audio", "pdf") })).toBe("checking_voices");
  expect(finishingStage({ ...base, snapshot: snapshot("pdf") })).toBe("publishing");
  expect(finishingStage({ ...base, voiceEnabled: false, snapshot: snapshot("audio") })).toBe(
    "publishing",
  );
  expect(finishingStage({ ...base, lessonWritten: false, snapshot: snapshot("audio") })).toBeNull();
  expect(finishingStage({ ...base, state: "ready", snapshot: snapshot("audio") })).toBeNull();
});

it("treats an unreadable snapshot as no audio rather than guessing a voice check", () => {
  expect(
    finishingStage({ state: "processing", lessonWritten: true, voiceEnabled: true, snapshot: {} }),
  ).toBe("publishing");
});
