// A small Markdown reader for the app's own legal texts (docs/legal). It understands only what
// those texts use — headings, paragraphs, lists, tables, a block quote, bold, code and links —
// and returns plain data. The renderer turns it into React text nodes, so no HTML is ever
// injected (PRD-SEC-03 keeps that rule for every text, ours included).

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "quote"; content: Inline[] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: "text", text: text.slice(last, index) });
    if (match[1] !== undefined) out.push({ kind: "strong", text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: "code", text: match[2] });
    else if (match[3] !== undefined && match[4] !== undefined) {
      // Only web links; anything else (a repository path, a script) stays plain text.
      out.push(
        /^https?:\/\//.test(match[4])
          ? { kind: "link", text: match[3], href: match[4] }
          : { kind: "text", text: match[3] },
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? "#").length as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, content: parseInline(heading[2] ?? "") });
      i += 1;
      continue;
    }
    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith(">")) {
        parts.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", content: parseInline(parts.join(" ")) });
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("|")) {
        rows.push(lines[i] ?? "");
        i += 1;
      }
      const [head = "", , ...body] = rows;
      blocks.push({
        kind: "table",
        head: cells(head).map(parseInline),
        rows: body.map((row) => cells(row).map(parseInline)),
      });
      continue;
    }
    const bullet = /^(-|\d+\.) /;
    if (bullet.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && bullet.test(lines[i] ?? "")) {
        items.push(parseInline((lines[i] ?? "").replace(bullet, "")));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const parts: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "" || /^(#{1,3} |>|\||- |\d+\. )/.test(next)) break;
      parts.push(next.trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", content: parseInline(parts.join(" ")) });
  }
  return blocks;
}

/** Fills {{name}} placeholders; an unknown one is left visible, never silently dropped. */
export function fillPlaceholders(source: string, values: Record<string, string>): string {
  return source.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole);
}
