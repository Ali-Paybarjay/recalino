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

// UX-02, owner decision 2026-10-19 (D90 as amended): full focus mode, no navigation in any phase.
describe("recording focus mode", () => {
  it("is set to the full focus mode", () => {
    expect(RECORDING_FOCUS_MODE).toBe("always");
  });

  it.each(PHASES)("hides the navigation when the phase is %s", (phase) => {
    expect(recordingFocusActive(RECORDING_FOCUS_MODE, captureIsQuiet(phase))).toBe(true);
  });

  // The alternative, one constant away: navigation only outside capture.
  it.each(["starting", "recording", "recovering", "paused"] as const)(
    '"while-capturing" hides the navigation while %s',
    (phase) => {
      expect(recordingFocusActive("while-capturing", captureIsQuiet(phase))).toBe(true);
    },
  );

  it.each(["idle", "saving", "saved", "failed"] as const)(
    '"while-capturing" shows the navigation when the phase is %s',
    (phase) => {
      expect(recordingFocusActive("while-capturing", captureIsQuiet(phase))).toBe(false);
    },
  );
});
