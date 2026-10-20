import { describe, expect, it } from "vitest";
import { captureIsActive, captureIsQuiet } from "./capture-phase";
import type { CaptureState } from "./controller";

const phases: CaptureState["phase"][] = [
  "idle",
  "starting",
  "recording",
  "recovering",
  "paused",
  "saving",
  "saved",
  "failed",
];

describe("capture phases", () => {
  it("is quiet from the start until Stop, paused included (PRD-REC-02)", () => {
    expect(phases.filter(captureIsQuiet)).toEqual([
      "starting",
      "recording",
      "recovering",
      "paused",
    ]);
  });

  it("is active until the last part is saved, so messages may follow once Stop is pressed", () => {
    expect(phases.filter(captureIsActive)).toEqual([
      "starting",
      "recording",
      "recovering",
      "paused",
      "saving",
    ]);
    expect(captureIsQuiet("saving")).toBe(false);
  });
});
