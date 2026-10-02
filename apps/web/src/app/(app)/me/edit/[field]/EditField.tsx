"use client";

import type { AccountState } from "@recalino/core/acc";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonClassName } from "../../../../../ui/components/Button";
import { Icon } from "../../../../../ui/components/Icon";
import { CaretLeft } from "../../../../../ui/icons";
import { strings } from "../../../../../ui/strings";
import { type SavedProfile, saveProfile } from "../../../../setup/api";
import type { FirstLanguage } from "../../../../setup/languages";
import setupStyles from "../../../../setup/setup.module.css";
import {
  ExplanationStep,
  FirstLanguageStep,
  LevelGoalStep,
  TimezoneStep,
} from "../../../../setup/steps";
import styles from "../../../app.module.css";

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
  const note = <p className={styles.note}>{strings.settings.notesUnchanged}</p>;

  return (
    <main className={setupStyles.page}>
      <div className={styles.editTop}>
        <Link
          href="/me"
          aria-label={strings.setup.back}
          className={buttonClassName("ghost", "md", "btn-icon")}
        >
          <Icon icon={CaretLeft} size={20} />
        </Link>
      </div>
      <div className={setupStyles.body}>
        {field === "first-language" ? (
          <FirstLanguageStep
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
            level={state.profile.level}
            goal={state.profile.goal}
            note={note}
            onSubmit={({ level, goal }) => done(saveProfile({ field: "level_goal", level, goal }))}
          />
        ) : null}
        {field === "time-zone" ? (
          <TimezoneStep
            value={state.timezone}
            onSubmit={(timezone) => done(saveProfile({ field: "timezone", timezone }))}
          />
        ) : null}
      </div>
    </main>
  );
}
