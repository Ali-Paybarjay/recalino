import { describe, expect, it } from "vitest";
import type { CaptureState } from "./controller";
import { sessionPageStep } from "./session-page";

const session = "20000000-0000-4000-8000-000000000001";
const href = `/sessions/${session}/record`;
const step = (
  phase: CaptureState["phase"],
  done: "address" | "page" | null = null,
  patch: Partial<Parameters<typeof sessionPageStep>[0]> = {},
) =>
  sessionPageStep({
    pageSessionId: undefined,
    recordingSessionId: session,
    phase,
    choosingPhoto: false,
    done,
    ...patch,
  });

// D107 A.4 and PRD-REC-02/03: the session attaches during capture without a server navigation.
describe("Today's recording page becomes the session's recording page", () => {
  it("changes only the address while capture is active, once", () => {
    for (const phase of ["starting", "recording", "recovering", "paused", "saving"] as const) {
      expect(step(phase)).toEqual({ step: "address", href });
      expect(step(phase, "address")).toBeNull();
      // A board photo being chosen keeps its page: the address alone does not replace it.
      expect(step(phase, null, { choosingPhoto: true })).toEqual({ step: "address", href });
    }
  });

  it("loads the session's page only after Stop, and not while a photo is being chosen", () => {
    for (const phase of ["saved", "failed", "idle"] as const) {
      expect(step(phase, "address")).toEqual({ step: "page", href });
      expect(step(phase)).toEqual({ step: "page", href });
      expect(step(phase, "address", { choosingPhoto: true })).toBeNull();
      expect(step(phase, "page")).toBeNull();
    }
  });

  it("does nothing on a session's page or before the session is known", () => {
    expect(step("recording", null, { pageSessionId: session })).toBeNull();
    expect(step("saved", null, { pageSessionId: session })).toBeNull();
    expect(step("recording", null, { recordingSessionId: null })).toBeNull();
    expect(step("saved", null, { recordingSessionId: null })).toBeNull();
  });
});
