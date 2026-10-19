import { LEGAL_TEXTS } from "../../legal/texts.generated";

/** The newer publication date of the two texts, e.g. "1 Oct" (frame G3). */
export function textsChangedOn(): string {
  const latest = [LEGAL_TEXTS.terms.published, LEGAL_TEXTS.privacy.published].sort().at(-1) ?? "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${latest}T00:00:00Z`));
}
