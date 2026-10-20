"use client";

import type { ReactNode } from "react";
import { useCaptureQuiet } from "../../ui/recording/RecordingProvider";
import {
  RECORDING_FOCUS_MODE,
  type RecordingFocusMode,
  recordingFocusActive,
} from "../../ui/recording/recording-focus";
import { AppShell } from "../../ui/shell/AppShell";
import { FocusShell } from "../../ui/shell/FocusShell";
import { NAV_HREFS } from "./nav";

type FrameProps = {
  /** Capture is in progress: starting, recording, recovering or paused (`captureIsQuiet`). */
  capturing: boolean;
  /** The page title (PageHeader). */
  header: ReactNode;
  /** The calm notice about changed Terms; it is left out while capture runs (PRD-REC-02). */
  notice?: ReactNode;
  /** Set by tests; pages always use RECORDING_FOCUS_MODE. */
  mode?: RecordingFocusMode;
  children: ReactNode;
};

/**
 * The recording pages' shell for a known capture state (UX-02, owner decision 2026-10-19, D90 as
 * amended). With RECORDING_FOCUS_MODE "always" (the current setting) the pages use FocusShell, the
 * full focus mode without navigation or Terms notice in any phase. With "while-capturing" it is
 * one AppShell whose `focus` switches: the normal learner shell before Start and after Stop, and no
 * navigation while capture runs; the recording view keeps its place and state when the phase
 * changes.
 */
export function RecordingShellFrame({
  capturing,
  header,
  notice,
  mode = RECORDING_FOCUS_MODE,
  children,
}: FrameProps) {
  if (mode === "always")
    return (
      <FocusShell>
        {header}
        {children}
      </FocusShell>
    );
  const focus = recordingFocusActive(mode, capturing);
  return (
    <AppShell current="classes" hrefs={NAV_HREFS} newClassHref="/sessions/new" focus={focus}>
      {header}
      {focus ? null : notice}
      {children}
    </AppShell>
  );
}

/** Reads the capture phase from the recording provider of the signed-in layout. */
export function RecordingShell(props: Omit<FrameProps, "capturing">) {
  const capturing = useCaptureQuiet();
  return <RecordingShellFrame {...props} capturing={capturing} />;
}
