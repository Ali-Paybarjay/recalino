"use client";
import { usePathname } from "next/navigation";
import { useCaptureQuiet } from "../../ui/recording/RecordingProvider";
import { RECORDING_FOCUS_MODE, recordingFocusActive } from "../../ui/recording/recording-focus";
import { recoveryCopy } from "../../ui/recovery-copy";
import { AppShell } from "../../ui/shell/AppShell";
import RootLoading from "../loading";
import styles from "../recovery.module.css";
import { isRecordingPage, NAV_HREFS, shellSectionFor } from "./nav";

/**
 * Shown while a signed-in page loads (UX-08). The layout above keeps its providers; this draws the
 * same navigation the page will draw, so the bottom navigation and the sidebar stay where they
 * are and only the content area waits. A page that draws no shell gets the plain loading screen
 * it had before. The recording pages load without navigation whenever the page itself draws none
 * (UX-02, RECORDING_FOCUS_MODE): in full focus mode always, so a capture does not flash it.
 */
export default function Loading() {
  const pathname = usePathname();
  const capturing = useCaptureQuiet();
  const section = shellSectionFor(pathname);
  if (!section) return <RootLoading />;
  const focus = isRecordingPage(pathname) && recordingFocusActive(RECORDING_FOCUS_MODE, capturing);
  return (
    <AppShell current={section} hrefs={NAV_HREFS} newClassHref="/sessions/new" focus={focus}>
      <p role="status" className={styles.description}>
        {recoveryCopy.loading}
      </p>
      <div aria-hidden="true" className={styles.skeleton}>
        <span />
        <span />
        <span />
      </div>
    </AppShell>
  );
}
