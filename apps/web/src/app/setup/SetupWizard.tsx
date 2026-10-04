"use client";

import type { AccountState, SetupStep } from "@recalino/core/acc";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../ui/components/Button";
import { experienceCopy } from "../../ui/experience-copy";
import { CaretLeft } from "../../ui/icons";
import { Wordmark } from "../../ui/shell/Wordmark";
import { fill, strings } from "../../ui/strings";
import { acceptTexts, saveProfile } from "./api";
import type { FirstLanguage } from "./languages";
import styles from "./setup.module.css";
import {
  ConsentStep,
  ExplanationStep,
  FirstLanguageStep,
  LevelGoalStep,
  TimezoneStep,
} from "./steps";

type Screen = Exclude<SetupStep, 8>;
const ORDER: readonly Screen[] = [1, 3, 4, 6, 7];

type SetupWizardProps = {
  state: Pick<AccountState, "setupStep" | "profile" | "timezone">;
  languages: readonly FirstLanguage[];
  recordingConsentVersion: string;
};

/**
 * A2 — profile setup across five screens (FR-ACC-003). Each answer is saved before the next screen,
 * so a learner who leaves comes back to the same step. Back moves to the previous screen.
 */
export function SetupWizard({ state, languages, recordingConsentVersion }: SetupWizardProps) {
  const router = useRouter();
  const [profile, setProfile] = useState(state.profile);
  const [timezone, setTimezone] = useState(state.timezone);
  const [reached, setReached] = useState<Screen>(state.setupStep === 8 ? 7 : state.setupStep);
  const [screen, setScreen] = useState<Screen>(reached);
  const headingRef = useRef<HTMLDivElement>(null);

  // Each new screen starts at the top with focus on its content (accessibility.md).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per screen change.
  useEffect(() => {
    window.scrollTo(0, 0);
    headingRef.current?.querySelector("h1")?.setAttribute("tabindex", "-1");
    headingRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [screen]);

  const index = ORDER.indexOf(screen);
  const advance = (step: SetupStep) => {
    if (step === 8) {
      router.replace("/today");
      return;
    }
    setReached(step);
    setScreen(step);
  };

  return (
    <main className={styles.page}>
      <header className={styles.wizardHeader}>
        <Wordmark />
        <p className={styles.wizardTitle}>{experienceCopy.setup.title}</p>
        <p className={styles.wizardDescription}>{experienceCopy.setup.description}</p>
      </header>
      <section className={styles.progress} aria-label={experienceCopy.setup.progressLabel}>
        <div className={styles.progressTop}>
          <IconButton
            icon={CaretLeft}
            label={strings.setup.back}
            disabled={index === 0}
            onClick={() => setScreen(ORDER[index - 1] ?? 1)}
          />
          <span className={styles.screenName}>{experienceCopy.setup.screens[index]}</span>
          <span className={styles.count}>
            {fill(experienceCopy.setup.progress, { step: index + 1, total: ORDER.length })}
          </span>
        </div>
        <div className={styles.bars} aria-hidden="true">
          {ORDER.map((step, barIndex) => (
            <span key={step} className={barIndex <= index ? styles.barOn : styles.bar} />
          ))}
        </div>
      </section>
      <div ref={headingRef} className={styles.body}>
        {screen === 1 ? (
          <FirstLanguageStep
            value={profile.firstLanguage}
            languages={languages}
            onSubmit={async (firstLanguage) => {
              const saved = await saveProfile({ field: "first_language", firstLanguage });
              setProfile((current) => ({ ...current, firstLanguage }));
              advance(nextScreen(1, saved.setupStep, reached));
            }}
          />
        ) : null}
        {screen === 3 && profile.firstLanguage ? (
          <ExplanationStep
            firstLanguage={profile.firstLanguage}
            value={profile.explanationLanguage}
            onSubmit={async (explanationLanguage) => {
              const saved = await saveProfile({
                field: "explanation_language",
                explanationLanguage,
              });
              setProfile((current) => ({ ...current, explanationLanguage }));
              advance(nextScreen(3, saved.setupStep, reached));
            }}
          />
        ) : null}
        {screen === 4 ? (
          <LevelGoalStep
            level={profile.level}
            goal={profile.goal}
            onSubmit={async ({ level, goal }) => {
              const saved = await saveProfile({ field: "level_goal", level, goal });
              setProfile((current) => ({ ...current, level, goal }));
              advance(nextScreen(4, saved.setupStep, reached));
            }}
          />
        ) : null}
        {screen === 6 ? (
          <TimezoneStep
            value={timezone}
            onSubmit={async (zone) => {
              const saved = await saveProfile({ field: "timezone", timezone: zone });
              setTimezone(zone);
              advance(nextScreen(6, saved.setupStep, reached));
            }}
          />
        ) : null}
        {screen === 7 ? (
          <ConsentStep
            onSubmit={async () => {
              await acceptTexts([
                { document: "recording-consent", version: recordingConsentVersion },
              ]);
              advance(8);
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

/** After an answer: the next screen in order, but never past the step the server has reached. */
function nextScreen(current: Screen, serverStep: SetupStep, reached: Screen): SetupStep {
  const following = ORDER[ORDER.indexOf(current) + 1] ?? 7;
  if (serverStep === 8) return 8;
  const furthest = Math.max(serverStep, reached) as Screen;
  return following <= furthest ? following : furthest;
}
