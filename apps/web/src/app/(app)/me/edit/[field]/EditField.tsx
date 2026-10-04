"use client";

import type { AccountState } from "@recalino/core/acc";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { accountCopy } from "../../../../../ui/account-copy";
import { Icon } from "../../../../../ui/components/Icon";
import { CaretLeft } from "../../../../../ui/icons";
import { Wordmark } from "../../../../../ui/shell/Wordmark";
import { type SavedProfile, saveProfile } from "../../../../setup/api";
import type { FirstLanguage } from "../../../../setup/languages";
import setupStyles from "../../../../setup/setup.module.css";
import {
  ExplanationStep,
  FirstLanguageStep,
  LevelGoalStep,
  TimezoneStep,
} from "../../../../setup/steps";
import styles from "./EditField.module.css";

export type EditableField = "first-language" | "explanations" | "level-goal" | "time-zone";

/**
 * FR-ACC-004 and FR-ACC-006: one answer of the profile, edited with its setup screen. A change
 * applies to what Recalino makes next; existing notes stay as they are.
 */
export function EditField({
  field,
  state,
  languages,
}: {
  field: EditableField;
  state: Pick<AccountState, "profile" | "timezone">;
  languages: readonly FirstLanguage[];
}) {
  const router = useRouter();
  const done = async (saved: Promise<SavedProfile>) => {
    await saved;
    router.push("/me");
    router.refresh();
  };
  const note = <p className={styles.note}>{accountCopy.learningImpact}</p>;
  const cancel = () => router.push("/me");

  return (
    <main className={setupStyles.page}>
      <header className={styles.header}>
        <Wordmark />
        <Link href="/me" className={styles.back}>
          <Icon icon={CaretLeft} size={18} /> {accountCopy.back}
        </Link>
      </header>
      <div className={setupStyles.body}>
        {field === "first-language" ? (
          <FirstLanguageStep
            mode="edit"
            onCancel={cancel}
            value={state.profile.firstLanguage}
            languages={languages}
            note={note}
            onSubmit={(firstLanguage) =>
              done(saveProfile({ field: "first_language", firstLanguage }))
            }
          />
        ) : null}
        {field === "explanations" && state.profile.firstLanguage ? (
          <ExplanationStep
            mode="edit"
            onCancel={cancel}
            firstLanguage={state.profile.firstLanguage}
            value={state.profile.explanationLanguage}
            showLearning={false}
            note={note}
            onSubmit={(explanationLanguage) =>
              done(saveProfile({ field: "explanation_language", explanationLanguage }))
            }
          />
        ) : null}
        {field === "level-goal" ? (
          <LevelGoalStep
            mode="edit"
            onCancel={cancel}
            level={state.profile.level}
            goal={state.profile.goal}
            note={note}
            onSubmit={({ level, goal }) => done(saveProfile({ field: "level_goal", level, goal }))}
          />
        ) : null}
        {field === "time-zone" ? (
          <TimezoneStep
            mode="edit"
            onCancel={cancel}
            value={state.timezone}
            onSubmit={(timezone) => done(saveProfile({ field: "timezone", timezone }))}
          />
        ) : null}
      </div>
    </main>
  );
}
