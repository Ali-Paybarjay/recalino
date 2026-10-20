import type { Metadata } from "next";
import recording from "../../../../ui/recording/Recording.module.css";
import { recordingCopy } from "../../../../ui/recording/recording-copy";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { Actions, Button, LinkButton, Panel } from "../../../../ui/workspace/primitives";
import { processSessionCopy } from "../../../../ui/workspace/process-session-copy";
import { RecordingShellFrame } from "../../../(app)/RecordingShell";
import { SampleParts } from "./SampleParts";
import "../../../../ui/workspace/workspace.css";

export const metadata: Metadata = {
  title: "Recording page shell",
};

/**
 * The shell of the recording pages in its states (UX-02, owner decision 2026-10-19, D90 as
 * amended; D107), for comparing at 390 and 1440px: `/dev/ui/recording-shell` is the page before
 * Start, `?state=recording` is capture in progress (Stop and save on screen, the session's parts
 * without controls) and `?state=saved` is after Stop (the session stays open: Process this
 * session, Continue recording, and one compact line per part). With RECORDING_FOCUS_MODE "always"
 * none has navigation; with "while-capturing" the first and last have the learner navigation. The
 * real pages need Supabase and a microphone; this page renders the same `RecordingShellFrame`
 * around sample content with the texts of RecordingView and no capture. Guarded by /dev/layout.
 */
export default async function RecordingShellPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const capturing = state === "recording";
  const saved = state === "saved";
  return (
    <div className="workspace-root">
      <RecordingShellFrame
        capturing={capturing}
        header={<PageHeader title="Record a session" subtitle="Present perfect vs past simple" />}
      >
        <div className="workspace-stack">
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
              <p className="workspace-muted">
                Recording and lock-screen controls depend on your browser. Keep Recalino open and
                the screen on for reliable capture.
              </p>
              <p>0 board photos saved on this device</p>
            </Panel>
          ) : saved ? (
            <>
              <Actions>
                <LinkButton secondary href="/dev/ui/recording-shell?state=saved">
                  Back to session
                </LinkButton>
              </Actions>
              <Panel tone="hero" title="Saved on this device">
                <p>{recordingCopy.staysOpen}</p>
                <Actions>
                  <Button disabled>{processSessionCopy.action}</Button>
                  <Button secondary>{recordingCopy.continueRecording}</Button>
                </Actions>
              </Panel>
              <Panel title="Adding recorded parts to your session">
                <p role="status">2 parts added · 1 remaining</p>
              </Panel>
            </>
          ) : (
            <Panel tone="hero" title="Recordings on this device">
              <p>{recordingCopy.introduction}</p>
              <Button>Record a session</Button>
            </Panel>
          )}
          {capturing || saved ? (
            <Panel title={recordingCopy.recordedParts}>
              <SampleParts state={capturing ? "recording" : "saved"} />
            </Panel>
          ) : (
            <Panel title="Saved and recoverable recordings">
              <p className="workspace-muted">No recordings on this device yet.</p>
            </Panel>
          )}
        </div>
      </RecordingShellFrame>
    </div>
  );
}
