import { pendingCopy } from "../pending-copy";
import { Status } from "../workspace/primitives";
import type { MissingAudio } from "./controller";

// Pending owner approval (docs/design/UI_COPY_PENDING.md, workstream 2).
const copy = pendingCopy.recordingCapture as {
  missingSummary: string;
  missingInterval: string;
  missingHint: string;
  partMissing: string;
};
export const missingMinutes = (ms: number) => String(Math.max(1, Math.ceil(ms / 60000)));
export function partMissingLabel(ms: number) {
  return copy.partMissing.replace("{minutes}", missingMinutes(ms));
}
function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
/** Shown after Stop only (PRD-REC-02): what the learner meant to record but was not (PRD-REC-03). */
export function MissingAudioNotice({
  missing,
  compact = false,
}: {
  missing: MissingAudio | null | undefined;
  compact?: boolean;
}) {
  if (!missing?.intervals.length) return null;
  if (compact)
    return (
      <Status tone="error">
        {copy.missingSummary.replace("{minutes}", missingMinutes(missing.totalMs))}
      </Status>
    );
  return (
    <div>
      <Status tone="error">
        {copy.missingSummary.replace("{minutes}", missingMinutes(missing.totalMs))}
      </Status>
      <ul>
        {missing.intervals.map((interval) => (
          <li key={interval.from}>
            {copy.missingInterval
              .replace("{minutes}", missingMinutes(interval.missingMs))
              .replace("{time}", clock(interval.from))}
          </li>
        ))}
      </ul>
      <p className="preview-muted">{copy.missingHint}</p>
    </div>
  );
}
