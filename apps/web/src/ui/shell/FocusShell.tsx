import type { ReactNode } from "react";
import styles from "./FocusShell.module.css";

/**
 * Recording = full-screen focus mode, no navigation (HANDOFF §4, frame C2): no sidebar, no bottom
 * navigation and no "New session", so one wrong tap cannot take the learner away from the timer
 * and Stop. The page puts an explicit way back in its own content, shown once capture is over.
 *
 * The recording pages use it only when RECORDING_FOCUS_MODE is "always" (the batch 4 behaviour).
 * By the owner decision of 2026-10-19 they draw AppShell and switch its `focus` on while capture
 * is in progress (see RecordingShell and docs/design/RECORDING_NAVIGATION_2026-10-19.md).
 */
export function FocusShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <main id="content" tabIndex={-1} className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
