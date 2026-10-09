import type { Metadata } from "next";
import { buttonClassName } from "../../../../ui/components/Button";
import { Icon } from "../../../../ui/components/Icon";
import { ClassStatusChip } from "../../../../ui/components/Status";
import { Microphone } from "../../../../ui/icons";
import { AppShell, PageHeader } from "../../../../ui/shell/AppShell";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "App shell",
};

// The shell around sample content from frames B1-default and B1-desktop, for comparing at
// 390, 900 and 1440px. Server-rendered: the shell needs no client JavaScript.
export default function ShellPage() {
  return (
    <AppShell
      current="today"
      hrefs={{ today: "#today", classes: "#classes", review: "#review", me: "#me" }}
      newClassHref="#new-class"
      reviewDue={12}
      sidebarFooter={
        <div className={styles.allowance}>
          <span>Allowance</span>
          <span className={`rc-num ${styles.allowanceValue}`}>Class audio: 4 h 20 min left</span>
          <span>Valid until 31 Oct 2026</span>
        </div>
      }
    >
      <PageHeader kicker="Tuesday 30 September" title="Today" />
      <div className={styles.record}>
        <button type="button" className={buttonClassName("primary", "md", styles.recordButton)}>
          <Icon icon={Microphone} weight="fill" size={26} />
          Record a session
        </button>
        <span className={styles.helper}>
          Starts right away · saved on this device · name it later
        </span>
      </div>
      <div className={styles.classes}>
        <h2 className={styles.heading}>Recent sessions</h2>
        <div className={styles.classRow}>
          <span className={styles.classTitle}>Present perfect vs past simple</span>
          <span className={styles.helper}>ESOL Entry 3 · Tue 30 Sep</span>
          <ClassStatusChip status="partlyReady" detail="Part 2 missing" />
        </div>
        <div className={styles.classRow}>
          <span className={styles.classTitle}>Session — 23 Sep 2026</span>
          <span className={styles.helper}>My courses · Tue 23 Sep</span>
          <ClassStatusChip status="waitingForAllowance" />
        </div>
      </div>
    </AppShell>
  );
}
