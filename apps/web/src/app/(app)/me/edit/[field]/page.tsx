import { FIRST_LANGUAGES, languageTier, readAccSettings } from "@recalino/core/acc";
import { notFound } from "next/navigation";
import { requireLearner } from "../../../../../server/auth/learner";
import { type EditableField, EditField } from "./EditField";

export const dynamic = "force-dynamic";

const FIELDS: readonly EditableField[] = [
  "first-language",
  "explanations",
  "level-goal",
  "time-zone",
];

/** One Settings row, edited with its setup screen (FR-ACC-004, FR-ACC-006). */
export default async function EditFieldPage({ params }: { params: Promise<{ field: string }> }) {
  const { field } = await params;
  if (!FIELDS.includes(field as EditableField)) notFound();
  const learner = await requireLearner(`/me/edit/${field}`);
  const { verifiedLanguages } = readAccSettings();
  const languages = FIRST_LANGUAGES.map((code) => ({
    code,
    experimental: languageTier(code, verifiedLanguages) === "experimental",
  }));
  return (
    <EditField
      field={field as EditableField}
      state={{ profile: learner.state.profile, timezone: learner.state.timezone }}
      languages={languages}
    />
  );
}
