"use client";
import { usePathname } from "next/navigation";
import { recoveryCopy } from "../../ui/recovery-copy";
import { AppShell } from "../../ui/shell/AppShell";
import RootLoading from "../loading";
import styles from "../recovery.module.css";
import { NAV_HREFS, shellSectionFor } from "./nav";

/**
 * Shown while a signed-in page loads (UX-08). The layout above keeps its providers; this draws the
 * same navigation the page will draw, so the bottom navigation and the sidebar stay where they
 * are and only the content area waits. A page that draws no shell (recording, processing) gets
 * the plain loading screen it had before.
 */
export default function Loading() {
  const section = shellSectionFor(usePathname());
  if (!section) return <RootLoading />;
  return (
    <AppShell current={section} hrefs={NAV_HREFS} newClassHref="/sessions/new">
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
