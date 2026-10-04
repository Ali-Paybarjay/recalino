import {
  type AccountState,
  CURRENT_VERSIONS,
  FIRST_LANGUAGES,
  SETUP_STEPS,
} from "@recalino/core/acc";
import type { Metadata } from "next";
import Link from "next/link";
import { experienceCopy } from "../../../../ui/experience-copy";
import { SetupWizard } from "../../../setup/SetupWizard";
import styles from "../../../setup/setup.module.css";

export const metadata: Metadata = { title: "Setup UI preview" };

/** Actual setup screens with public language data, without creating or loading an account. */
export default async function SetupPreview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const setupStep = SETUP_STEPS.find((step) => String(step) === query.step) ?? 1;
  const state: Pick<AccountState, "setupStep" | "profile" | "timezone"> = {
    setupStep,
    timezone: setupStep === 6 ? null : "Europe/London",
    profile: {
      version: 1,
      firstLanguage: setupStep === 1 ? null : "fa",
      learningLanguage: "en",
      explanationLanguage: setupStep === 3 ? null : "first_language",
      level: "B1",
      goal: "general",
    },
  };

  return (
    <>
      <header className={styles.previewHeader}>
        <p className={styles.previewNote}>{experienceCopy.setup.previewNote}</p>
        <nav className={styles.previewNav} aria-label={experienceCopy.setup.previewNav}>
          {SETUP_STEPS.map((step, index) => (
            <Link
              key={step}
              href={`?step=${step}`}
              aria-current={step === setupStep ? "page" : undefined}
            >
              {experienceCopy.setup.screens[index]}
            </Link>
          ))}
        </nav>
      </header>
      <SetupWizard
        key={setupStep}
        state={state}
        languages={FIRST_LANGUAGES.map((code) => ({ code, experimental: true }))}
        recordingConsentVersion={CURRENT_VERSIONS["recording-consent"]}
      />
    </>
  );
}
