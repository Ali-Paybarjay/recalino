import type { Metadata } from "next";
import recording from "../../../../ui/recording/Recording.module.css";
import { recordingCopy } from "../../../../ui/recording/recording-copy";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { Actions, Button, Panel } from "../../../../ui/workspace/primitives";
import { RecordingShellFrame } from "../../../(app)/RecordingShell";
import "../../../../ui/preview/preview.css";

export const metadata: Metadata = {
  title: "Recording page shell",
};

/**
 * The shell of the recording pages in its two states (UX-02, owner decision 2026-10-19), for
 * comparing at 390 and 1440px: `/dev/ui/recording-shell` is the page before Start (the learner
 * navigation is there), `?state=recording` is capture in progress (no navigation, Stop and save on
 * screen). The real pages need Supabase and a microphone; this page renders the same
 * `RecordingShellFrame` around sample content with the texts of RecordingView and no capture.
 * Guarded by /dev/layout.
 */
export default async function RecordingShellPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const capturing = state === "recording";
  return (
    <div className="preview-root">
      <RecordingShellFrame
        capturing={capturing}
        header={<PageHeader title="Record a session" subtitle="Present perfect vs past simple" />}
      >
        <div className="preview-stack">
          {capturing ? (
            <Panel tone="hero" title="Your session is being recorded">
              <p role="timer" className={recording.timer} aria-label="Active recording time">
                12:34
              </p>
              <Actions>
                <Button secondary className={recording.control}>
                  Pause recording
                </Button>
                <Button className={recording.control}>Stop and save</Button>
                <Button secondary>Add board photo</Button>
              </Actions>
              <p>Recording continues in ten-minute parts, saved on this device.</p>
              <p className="preview-muted">
                Recording and lock-screen controls depend on your browser. Keep Recalino open and
                the screen on for reliable capture.
              </p>
              <p>0 board photos saved on this device</p>
            </Panel>
          ) : (
            <Panel tone="hero" title="Recordings on this device">
              <p>{recordingCopy.introduction}</p>
              <Button>Record a session</Button>
            </Panel>
          )}
          <Panel title="Saved and recoverable recordings">
            <p className="preview-muted">No recordings on this device yet.</p>
          </Panel>
        </div>
      </RecordingShellFrame>
    </div>
  );
}
