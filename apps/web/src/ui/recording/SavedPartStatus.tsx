import { Status } from "../workspace/primitives";
import { captureIsQuiet } from "./capture-phase";
import type { CaptureState } from "./controller";
import type { Recording } from "./store";

/**
 * The status line of one saved or recoverable part, and its upload failure.
 * PRD-REC-02 and UX-11: until the learner presses Stop, a failed background upload of an earlier
 * part (or of an older recording) must not raise an alert, so the failure waits for the phases
 * after Stop. A real capture failure is shown elsewhere and is never held back.
 */
export function SavedPartStatus({
  row,
  phase,
}: {
  row: Pick<Recording, "awaitingFinalData" | "status" | "syncError">;
  phase: CaptureState["phase"];
}) {
  return (
    <>
      <p>
        {row.awaitingFinalData
          ? "Recovering the final audio for this part… You can export the parts already saved."
          : row.status === "saved"
            ? "Saved on this device"
            : "Recording was interrupted. Check and export the saved parts."}
      </p>
      {row.syncError && !captureIsQuiet(phase) ? (
        <Status tone="error">{row.syncError}</Status>
      ) : null}
    </>
  );
}
