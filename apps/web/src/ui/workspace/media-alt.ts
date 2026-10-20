import { cardHtmlToText } from "@recalino/core/card-html";

/** Screen readers read about this many characters of alt text comfortably. */
const MAX_ALT_LENGTH = 125;

function plain(value: string | null | undefined): string {
  if (!value) return "";
  // The text is learner data: lesson markup is reduced to text and never interpreted (PRD-SEC-02).
  return cardHtmlToText(value).replace(/\s+/g, " ").trim();
}

function shorten(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= MAX_ALT_LENGTH) return text;
  return `${characters
    .slice(0, MAX_ALT_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * The `alt` text of an image attached to a card (A11Y-05): the first candidate that has any text,
 * such as the text on the card side that carries the image, then the source's display name.
 * With no text at all the image gets `""`, which marks it decorative instead of announcing a
 * generic phrase. The result is learner data and may be right-to-left, so the `<img>` should also
 * carry `dir="auto"`.
 */
export function mediaAlt(...candidates: ReadonlyArray<string | null | undefined>): string {
  for (const candidate of candidates) {
    const text = plain(candidate);
    if (text) return shorten(text);
  }
  return "";
}
