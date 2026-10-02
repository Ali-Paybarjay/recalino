import { requireLearner } from "../../../server/auth/learner";
import { PageHeader } from "../../../ui/shell/AppShell";
import { strings } from "../../../ui/strings";
import styles from "../app.module.css";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

/** "Tuesday 30 September" in the learner's time zone (frame B1). */
function todayLabel(timezone: string | null): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone ?? "UTC",
  }).format(new Date());
}

/**
 * B1 — Today, in its empty state for now (frame B1-empty). "Record a class" arrives with REC
 * (stage 2) and "New class without recording" with ORG (M4).
 */
export default async function TodayPage() {
  const learner = await requireLearner("/today");
  return (
    <LearnerShell
      learner={learner}
      current="today"
      header={<PageHeader kicker={todayLabel(learner.state.timezone)} title={strings.nav.today} />}
    >
      <p className={styles.emptyToday}>{strings.empty.today}</p>
    </LearnerShell>
  );
}
