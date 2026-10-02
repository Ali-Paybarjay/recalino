import Link from "next/link";
import type { ReactNode } from "react";
import { requireLearner } from "../../../server/auth/learner";
import { Button } from "../../../ui/components/Button";
import { Icon } from "../../../ui/components/Icon";
import { CaretRight } from "../../../ui/icons";
import { PageHeader } from "../../../ui/shell/AppShell";
import { strings } from "../../../ui/strings";
import { GOAL_LABELS, levelLabel } from "../../setup/labels";
import { languageName, timeZoneCity, timeZoneOffset } from "../../setup/languages";
import styles from "../app.module.css";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

function Row({ href, label, value }: { href: string; label: string; value: ReactNode }) {
  return (
    <Link href={href} className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
      <Icon icon={CaretRight} className={styles.rowValue} />
    </Link>
  );
}

/**
 * G3 — Settings, the Profile section for now (FR-ACC-004, FR-ACC-006). Review settings come with
 * SRS, Data with PRIV. Sign out sits at the bottom (HANDOFF_R1_REVIEW item 8).
 */
export default async function SettingsPage() {
  const learner = await requireLearner("/me");
  const { profile, timezone } = learner.state;
  const first = profile.firstLanguage ? languageName(profile.firstLanguage) : null;
  const level = profile.level ? levelLabel(profile.level) : "—";
  const goal = profile.goal ? GOAL_LABELS[profile.goal] : "—";

  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={<PageHeader title={strings.settings.title} />}
    >
      <h2 className={styles.sectionTitle}>{strings.settings.profile}</h2>
      <div className={styles.rows}>
        <Row
          href="/me/edit/first-language"
          label={strings.settings.firstLanguage}
          value={
            first ? (
              <>
                {first.english}
                {first.native ? (
                  <>
                    {" — "}
                    <span lang={first.code}>{first.native}</span>
                  </>
                ) : null}
              </>
            ) : (
              "—"
            )
          }
        />
        <Row
          href="/me/edit/explanations"
          label={strings.settings.explanationsIn}
          value={
            profile.explanationLanguage === "first_language" && first ? (
              <span lang={first.native ? first.code : undefined}>
                {first.native ?? first.english}
              </span>
            ) : (
              strings.setup.english
            )
          }
        />
        <Row
          href="/me/edit/level-goal"
          label={strings.settings.levelGoal}
          value={`${level} · ${goal}`}
        />
        <Row
          href="/me/edit/time-zone"
          label={strings.settings.timezone}
          value={timezone ? `${timeZoneCity(timezone)} (${timeZoneOffset(timezone)})` : "—"}
        />
      </div>
      <form method="post" action="/auth/sign-out" className={styles.signOut}>
        <Button type="submit" size="lg" block>
          {strings.settings.signOut}
        </Button>
      </form>
    </LearnerShell>
  );
}
