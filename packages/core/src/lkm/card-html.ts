/** A second boundary for the small, deterministic vocabulary used by study card templates. */
export function isStudyCardHtml(value: string): boolean {
  let end = 0;
  for (const token of value.matchAll(/<[^>]*>/g)) {
    if (value.slice(end, token.index).includes("<")) return false;
    const markup = token[0];
    end = token.index + markup.length;
    if (/^<\/(?:div|b|i|span|bdi)>$/.test(markup)) continue;
    if (/^<(?:br|hr)>$/.test(markup)) continue;
    const opening = /^<(div|b|i|span|bdi)((?: [a-z]+="[^"]*")*)>$/.exec(markup);
    if (!opening) return false;
    const seen = new Set<string>();
    for (const attribute of (opening[2] ?? "").matchAll(/ ([a-z]+)="([^"]*)"/g)) {
      const [, name = "", content] = attribute;
      if (seen.has(name)) return false;
      seen.add(name);
      if (name === "dir" && (content === "ltr" || content === "rtl" || content === "auto"))
        continue;
      if (name === "lang" && /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(content ?? "")) continue;
      if (name === "class" && content === "ipa") continue;
      if (name === "style" && /^font-size:(?:1\.1|1\.25)em$/.test(content ?? "")) continue;
      return false;
    }
  }
  return !value.slice(end).includes("<");
}

export function safeCardHtml(value: string): string {
  return isStudyCardHtml(value)
    ? value
    : value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A readable label for selection controls, never interpreted as markup. */
export function cardHtmlToText(value: string): string {
  if (!isStudyCardHtml(value)) return value;
  return value
    .replace(/<(?:br|hr)>|<\/div>/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(?:amp|lt|gt|quot|#39|#x27);/g,
      (entity) =>
        ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'" })[
          entity
        ] ?? entity,
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `safeCardHtml` for display, with the language the Persian reference output leaves unsaid.
 *
 * That output reproduces the owner's reference faces, which carry `dir` but no `lang`
 * (`study-render.ts`, `englishAttrs`; the reference comparison tests check attributes). In the app
 * page, which is `lang="en"`, a screen reader then reads the Persian in English. Here, for display
 * only and without touching the stored or exported card, a top-level block without `lang` gets
 * the language that output means by its direction: `ltr` is English, `rtl` is Persian, and a
 * bare `<bdi>` inside a Persian block is a Latin-script run. Anything that already names its
 * language, nested blocks and `dir="auto"` wrappers are left as they are.
 */
export function cardHtmlWithLanguages(value: string): string {
  if (!isStudyCardHtml(value)) return safeCardHtml(value);
  let depth = 0;
  let persianBlockDepth = -1;
  return value.replace(/<[^>]*>/g, (tag) => {
    if (/^<(?:br|hr)>$/.test(tag)) return tag;
    if (tag.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      if (persianBlockDepth === depth) persianBlockDepth = -1;
      return tag;
    }
    const opening = /^<(div|b|i|span|bdi)((?: [a-z]+="[^"]*")*)>$/.exec(tag);
    const here = depth++;
    if (!opening || / lang="/.test(opening[2] ?? "")) return tag;
    const [, name = "", attributes = ""] = opening;
    const direction = / dir="(ltr|rtl|auto)"/.exec(attributes)?.[1];
    if (here === 0 && persianBlockDepth < 0 && (direction === "ltr" || direction === "rtl")) {
      if (direction === "rtl") persianBlockDepth = here;
      return `<${name}${attributes} lang="${direction === "rtl" ? "fa" : "en"}">`;
    }
    if (persianBlockDepth >= 0 && name === "bdi" && direction !== "rtl")
      return `<bdi${attributes} lang="en">`;
    return tag;
  });
}
