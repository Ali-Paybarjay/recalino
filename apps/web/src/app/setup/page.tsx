import {
  CURRENT_VERSIONS,
  FIRST_LANGUAGES,
  languageTier,
  readAccSettings,
} from "@recalino/core/acc";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireLearner } from "../../server/auth/learner";
import { SetupWizard } from "./SetupWizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Recalino" };

/** A2 — profile setup; a finished setup goes to Today (FR-ACC-003). */
export default async function SetupPage() {
  const learner = await requireLearner("/setup", { duringSetup: true });
  if (learner.state.setupComplete) redirect("/today");
  const { verifiedLanguages } = readAccSettings();
  const languages = FIRST_LANGUAGES.map((code) => ({
    code,
    experimental: languageTier(code, verifiedLanguages) === "experimental",
  }));
  return (
    <SetupWizard
      state={learner.state}
      languages={languages}
      recordingConsentVersion={CURRENT_VERSIONS["recording-consent"]}
    />
  );
}
