import type { AccountState } from "@recalino/core/acc";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "../../../ui/components/Button";
import { Icon, type IconComponent } from "../../../ui/components/Icon";
import { courseCopy } from "../../../ui/course-copy";
import {
  CaretRight,
  ChalkboardSimple,
  GlobeHemisphereWest,
  Lightbulb,
  SunHorizon,
  UserCircle,
} from "../../../ui/icons";
import { profileCopy } from "../../../ui/profile-copy";
import { strings } from "../../../ui/strings";
import { GOAL_LABELS, levelLabel } from "../../setup/labels";
import { languageName, timeZoneCity, timeZoneOffset } from "../../setup/languages";
import styles from "./profile.module.css";

function Row({
  href,
  label,
  value,
  icon,
}: {
  href: string;
  label: string;
  value: ReactNode;
  icon: IconComponent;
}) {
  return (
    <Link href={href} className={styles.row}>
      <span className={styles.rowIcon}>
        <Icon icon={icon} size={22} />
      </span>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
      <Icon icon={CaretRight} size={18} className={styles.rowCaret} />
    </Link>
  );
}

/**
 * G3 — Settings, the Profile section for now (FR-ACC-004, FR-ACC-006). Review settings come with
 * SRS, Data with PRIV. The summary uses only the learner's own saved choices.
 */
export function ProfileSettings({ state }: { state: Pick<AccountState, "profile" | "timezone"> }) {
  const { profile, timezone } = state;
  const first = profile.firstLanguage ? languageName(profile.firstLanguage) : null;
  const level = profile.level ? levelLabel(profile.level) : "—";
  const goal = profile.goal ? GOAL_LABELS[profile.goal] : "—";
  const explanations =
    profile.explanationLanguage === "first_language" && first ? (
      <bdi lang={first.code} dir="auto">
        {first.native ?? first.english}
      </bdi>
    ) : (
      strings.setup.english
    );

  return (
    <>
      <p className={styles.intro}>{profileCopy.intro}</p>
      <Row href="/me/quota" label="Your allowance" value="Available and used" icon={SunHorizon} />
      <Row
        href="/me/review-settings"
        label="Review settings"
        value="Daily review choices"
        icon={ChalkboardSimple}
      />
      <Row
        href="/me/learning"
        label="Your learning"
        value="History and preferences"
        icon={Lightbulb}
      />
      <Row href="/me/data" label="Your data" value="Privacy and deletion" icon={UserCircle} />
      <Row
        href="/help"
        label="Feedback & help"
        value="Questions, suggestions and replies"
        icon={Lightbulb}
      />
      <Row
        href="/courses"
        label="Courses"
        value="Classes and learning materials"
        icon={ChalkboardSimple}
      />
      <section className={styles.summary} aria-labelledby="learning-profile-title">
        <div className={styles.summaryHeading}>
          <span className={styles.summaryIcon}>
            <Icon icon={UserCircle} size={30} />
          </span>
          <div>
            <h2 id="learning-profile-title" className={styles.summaryTitle}>
              {profileCopy.summaryTitle}
            </h2>
            <p className={styles.summaryDescription}>{profileCopy.summaryDescription}</p>
          </div>
        </div>
        <dl className={styles.attributes}>
          <div className={styles.attribute}>
            <dt>{profileCopy.level}</dt>
            <dd className={styles.attributeValue}>{level}</dd>
            {profile.level ? (
              <dd className={styles.attributeNote}>{profileCopy.selfReported}</dd>
            ) : null}
          </div>
          <div className={styles.attribute}>
            <dt>{strings.setup.goal}</dt>
            <dd className={styles.attributeValue}>{goal}</dd>
            <dd className={styles.attributeNote}>{courseCopy.goalHelp}</dd>
          </div>
          <div className={styles.attribute}>
            <dt>{strings.settings.explanationsIn}</dt>
            <dd className={styles.attributeValue}>{explanations}</dd>
          </div>
        </dl>
      </section>
      <section className={styles.profileSection} aria-labelledby="profile-settings-title">
        <div className={styles.sectionHeading}>
          <h2 id="profile-settings-title" className={styles.sectionTitle}>
            {strings.settings.profile}
          </h2>
          <p className={styles.sectionDescription}>{profileCopy.settingsDescription}</p>
        </div>
        <div className={styles.rows}>
          <Row
            href="/me/edit/first-language"
            label={strings.settings.firstLanguage}
            icon={GlobeHemisphereWest}
            value={
              first ? (
                <>
                  {first.english}
                  {first.native ? (
                    <>
                      {" — "}
                      <bdi lang={first.code} dir="auto">
                        {first.native}
                      </bdi>
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
            icon={Lightbulb}
            value={explanations}
          />
          <Row
            href="/me/edit/level-goal"
            label={strings.settings.levelGoal}
            icon={ChalkboardSimple}
            value={`${level} · ${goal}`}
          />
          <Row
            href="/me/edit/time-zone"
            label={strings.settings.timezone}
            icon={SunHorizon}
            value={timezone ? `${timeZoneCity(timezone)} (${timeZoneOffset(timezone)})` : "—"}
          />
        </div>
        <p className={styles.settingsNote}>{strings.settings.notesUnchanged}</p>
      </section>
      <form method="post" action="/auth/sign-out" className={styles.signOut}>
        <Button type="submit" className={styles.signOutButton}>
          {strings.settings.signOut}
        </Button>
      </form>
    </>
  );
}
