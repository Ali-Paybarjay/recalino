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
