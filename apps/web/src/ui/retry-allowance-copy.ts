import { allowanceLabels } from "./allowance-units";

/** D59 deduplicates material usage; publishing a new version still uses regeneration allowance. */
export function retryAllowanceCopy(readiness: { notesReady?: boolean; cardsReady?: boolean } = {}) {
  const newVersion = `1 ${allowanceLabels.regeneration} unit`;
  if (readiness.notesReady || readiness.cardsReady)
    return `Publishing updated notes uses ${newVersion}, plus allowance for any material not already charged. Audio and pages already charged for this session are not charged again.`;
  // Missing notebook/card readiness is not proof that getLatestVersion is null.
  // Keep the publication condition explicit instead of promising a free retry.
  return `Publishing a result uses allowance for material not already charged. A new version of existing notes also uses ${newVersion}.`;
}
