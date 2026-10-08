"use client";

import type { AccountState, SetupStep } from "@recalino/core/acc";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptTexts, saveProfile } from "./api";
import type { FirstLanguage } from "./languages";
import { SetupFrame } from "./SetupFrame";
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
 * Five required profile screens (FR-ACC-003), followed by optional voice enrollment. Each answer
 * is saved before the next screen; leaving during required setup returns to the same step.
 */
export function SetupWizard({ state, languages, recordingConsentVersion }: SetupWizardProps) {
  const router = useRouter();
  const [profile, setProfile] = useState(state.profile);
  const [timezone, setTimezone] = useState(state.timezone);
  const [reached, setReached] = useState<Screen>(state.setupStep === 8 ? 7 : state.setupStep);
  const [screen, setScreen] = useState<Screen>(reached);

  const index = ORDER.indexOf(screen);
  const advance = (step: SetupStep) => {
    if (step === 8) {
      router.replace("/setup/voice");
      return;
    }
    setReached(step);
    setScreen(step);
  };

  return (
    <SetupFrame index={index} onBack={() => setScreen(ORDER[index - 1] ?? 1)}>
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
          actionLabel="Continue"
          onSubmit={async () => {
            await acceptTexts([
              { document: "recording-consent", version: recordingConsentVersion },
            ]);
            advance(8);
          }}
        />
      ) : null}
    </SetupFrame>
  );
}

/** After an answer: the next screen in order, but never past the step the server has reached. */
function nextScreen(current: Screen, serverStep: SetupStep, reached: Screen): SetupStep {
  const following = ORDER[ORDER.indexOf(current) + 1] ?? 7;
  if (serverStep === 8) return 8;
  const furthest = Math.max(serverStep, reached) as Screen;
  return following <= furthest ? following : furthest;
}
