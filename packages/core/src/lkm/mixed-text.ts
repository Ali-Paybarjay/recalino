/** Text-node escaping only. Content never supplies HTML or attributes. */
export function escapeStudyText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeStudyAttribute(value: string): string {
  return escapeStudyText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const arabicBreak = /((?:[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF«»]|\u200C|\u200D)+)/;
const latin = "A-Za-z\\u00C0-\\u024F\\u0250-\\u02AF\\u0370-\\u03FF\\u1D00-\\u1DBF\\u1E00-\\u1EFF";
const hasLatin = new RegExp(`[${latin}]`);
const coreStart = new RegExp(`[${latin}0-9£$€#@]`);
const coreEnd = new RegExp(`[${latin}0-9%]`, "g");
const leading = new Set("/ˈˌ-'\"“‘£$€#@~");
const trailing = new Set("/'\"”’%!?…ː");
const brackets = [
  ["(", ")"],
  ["[", "]"],
] as const;

function count(value: string, character: string): number {
  return value.split(character).length - 1;
}

/** Faithful port of the brief's Persian-free segment isolation algorithm. */
function isolateSegment(segment: string): string {
  if (!hasLatin.test(segment)) return escapeStudyText(segment);
  let start = segment.search(coreStart);
  let end = -1;
  for (const match of segment.matchAll(coreEnd)) end = match.index;
  while (start > 0 && leading.has(segment[start - 1] ?? "")) start--;
  let changed = true;
  while (changed) {
    changed = false;
    while (end + 1 < segment.length && trailing.has(segment[end + 1] ?? "")) {
      end++;
      changed = true;
    }
    let run = segment.slice(start, end + 1);
    const dots = /^\.+/.exec(segment.slice(end + 1));
    if (dots && (dots[0].length > 1 || /\s/.test(run))) {
      end += dots[0].length;
      changed = true;
      run = segment.slice(start, end + 1);
    }
    for (const [open, close] of brackets) {
      if (count(run, open) > count(run, close) && segment[end + 1] === close) {
        end++;
        changed = true;
      } else if (count(run, close) > count(run, open) && start > 0 && segment[start - 1] === open) {
        start--;
        changed = true;
      }
      run = segment.slice(start, end + 1);
    }
  }
  const run = segment.slice(start, end + 1);
  const ipaClass = /^\/[^/]+\/$/.test(run) ? ' class="ipa"' : "";
  return `${escapeStudyText(segment.slice(0, start))}<bdi${ipaClass}>${escapeStudyText(run)}</bdi>${escapeStudyText(segment.slice(end + 1))}`;
}

/** Persian prose, with English/IPA isolation and the sole supported markup: **bold**. */
export function renderMixedPersian(value: string): string {
  return value
    .split("**")
    .map((part, index) => {
      const html = part
        .split(arabicBreak)
        .map((piece, pieceIndex) =>
          pieceIndex % 2 ? escapeStudyText(piece) : isolateSegment(piece),
        )
        .join("");
      return index % 2 ? `<b>${html}</b>` : html;
    })
    .join("");
}

/** English blocks allow the same explicit bold markers without adding bidi wrappers. */
export function renderStudyEnglish(value: string): string {
  return value
    .split("**")
    .map((part, index) => (index % 2 ? `<b>${escapeStudyText(part)}</b>` : escapeStudyText(part)))
    .join("");
}
