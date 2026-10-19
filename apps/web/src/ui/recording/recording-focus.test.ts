import { describe, expect, it } from "vitest";
import { captureIsQuiet } from "./capture-phase";
import type { CaptureState } from "./controller";
import { RECORDING_FOCUS_MODE, recordingFocusActive } from "./recording-focus";

const PHASES: CaptureState["phase"][] = [
  "idle",
  "starting",
  "recording",
  "recovering",
  "paused",
  "saving",
  "saved",
  "failed",
];

// UX-02, owner decision 2026-10-19: the navigation is hidden only while capture is in progress.
describe("recording focus mode", () => {
  it("is set to hide the navigation only while capturing", () => {
    expect(RECORDING_FOCUS_MODE).toBe("while-capturing");
  });

  it.each(["starting", "recording", "recovering", "paused"] as const)(
    "hides the navigation while %s",
    (phase) => {
      expect(recordingFocusActive("while-capturing", captureIsQuiet(phase))).toBe(true);
    },
  );

  it.each(["idle", "saving", "saved", "failed"] as const)(
    "shows the navigation when the phase is %s",
    (phase) => {
      expect(recordingFocusActive("while-capturing", captureIsQuiet(phase))).toBe(false);
    },
  );

  it('"always" is the full focus mode of batch 4: no navigation in any phase', () => {
    for (const phase of PHASES)
      expect(recordingFocusActive("always", captureIsQuiet(phase))).toBe(true);
  });
});
