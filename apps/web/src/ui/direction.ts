// Text direction of a language, so a content block in a known language gets the right direction
// even when it starts with an English word ("already یعنی …"), where dir="auto" would guess
// left-to-right (FR-PLT-011). A static list keeps server and client rendering identical.

const RTL_LANGUAGES = new Set([
  "ar",
  "arc",
  "ckb",
  "dv",
  "fa",
  "he",
  "iw",
  "khw",
  "ks",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
]);

const RTL_SCRIPTS = new Set([
  "adlm",
  "arab",
  "hebr",
  "mand",
  "nkoo",
  "rohg",
  "samr",
  "syrc",
  "thaa",
]);

/** "rtl" or "ltr" for a BCP 47 tag; an explicit script subtag wins (e.g. "pa-Arab"). */
export function directionOf(lang: string): "ltr" | "rtl" {
  const [language = "", ...rest] = lang.toLowerCase().split("-");
  const script = rest.find((part) => part.length === 4 && /^[a-z]+$/.test(part));
  if (script) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}
