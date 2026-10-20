import { captureIsActive } from "./capture-phase";
import type { CaptureState } from "./controller";

export type SessionPageStep = { step: "address" | "page"; href: string };

/**
 * D107: a recording started on Today gets its session when /api/classes answers, and its page
 * becomes that session's recording page. During capture (starting to saving) only the address
 * changes, with history.replaceState: no server request, no loading screen and nothing announced
 * (PRD-REC-02, PRD-REC-03). The session's page itself loads after Stop, and not while a board
 * photo is being chosen, which a new page would lose.
 */
export function sessionPageStep(input: {
  /** The page is already a session's recording page. */
  pageSessionId: string | undefined;
  recordingSessionId: string | null;
  phase: CaptureState["phase"];
  choosingPhoto: boolean;
  /** What this page has done so far. */
  done: SessionPageStep["step"] | null;
}): SessionPageStep | null {
  if (input.pageSessionId || !input.recordingSessionId || input.done === "page") return null;
  const href = `/sessions/${input.recordingSessionId}/record`;
  if (captureIsActive(input.phase)) return input.done ? null : { step: "address", href };
  return input.choosingPhoto ? null : { step: "page", href };
}
