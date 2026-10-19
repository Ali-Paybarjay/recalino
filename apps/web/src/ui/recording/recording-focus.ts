/**
 * Where the recording pages (`/recordings`, `/sessions/<id>/record`) hide the app navigation.
 *
 * Owner decision 2026-10-19 (UX-02, D90 as amended): full focus mode ("always", HANDOFF §4, frame
 * C2). The recording pages never draw the navigation, in any phase: no sidebar, no bottom
 * navigation, no "New session" and no skip link, so one wrong tap cannot take the learner away
 * from the timer and Stop, and nothing else speaks (PRD-REC-02). The page offers its own way back
 * ("Back to session" / "Back to Today") outside capture.
 *
 * The owner chose this after seeing both previews. The alternative stays one constant away:
 * "while-capturing" hides the navigation only while capture is in progress and shows it before
 * Start and after Stop. See docs/design/RECORDING_NAVIGATION_2026-10-19.md.
 */
export type RecordingFocusMode = "while-capturing" | "always";

export const RECORDING_FOCUS_MODE = "always" as RecordingFocusMode;

/**
 * Whether the recording page is in focus mode (no navigation). `capturing` is
 * `captureIsQuiet(phase)`: starting, recording, recovering or paused.
 */
export function recordingFocusActive(mode: RecordingFocusMode, capturing: boolean): boolean {
  return mode === "always" || capturing;
}
