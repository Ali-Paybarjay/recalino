/**
 * Where the recording pages (`/recordings`, `/sessions/<id>/record`) hide the app navigation.
 *
 * Owner decision 2026-10-19 (UX-02): the navigation is hidden only while capture is in progress
 * ("while-capturing"), and visible before Start and after Stop, so a learner can leave a page they
 * have not started on and does not need the browser's Back afterwards. While capture runs there is
 * no navigation, no "New session" and no skip link, so one wrong tap cannot take the learner away
 * from the timer and Stop, and nothing else speaks (PRD-REC-02).
 *
 * To go back to the full focus mode of batch 4 (HANDOFF §4, frame C2: never any navigation on the
 * recording pages), set RECORDING_FOCUS_MODE to "always". Nothing else needs to change; see
 * docs/design/RECORDING_NAVIGATION_2026-10-19.md.
 */
export type RecordingFocusMode = "while-capturing" | "always";

export const RECORDING_FOCUS_MODE = "while-capturing" as RecordingFocusMode;

/**
 * Whether the recording page is in focus mode (no navigation). `capturing` is
 * `captureIsQuiet(phase)`: starting, recording, recovering or paused.
 */
export function recordingFocusActive(mode: RecordingFocusMode, capturing: boolean): boolean {
  return mode === "always" || capturing;
}
