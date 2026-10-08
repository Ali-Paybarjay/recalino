import { type DefaultTreeAdapterMap, parse } from "parse5";
import { errors } from "../plt";
import type { InputContract } from "./contracts";
import { decodeSourceText } from "./contracts";

export interface ExtractedTextBlock {
  id: string;
  kind: "heading" | "paragraph" | "list_item" | "table";
  text: string;
  level?: number;
}

/** Match the content schema without cutting a UTF-16 surrogate pair in two. */
export const MAX_EXTRACTED_BLOCK_LENGTH = 100_000;
function textChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + MAX_EXTRACTED_BLOCK_LENGTH, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
type Node = DefaultTreeAdapterMap["node"];
const OMIT = new Set([
  "script",
  "style",
  "form",
  "input",
  "textarea",
  "button",
  "select",
  "iframe",
  "object",
  "embed",
  "meta",
  "link",
  "template",
  "noscript",
  "svg",
  "math",
]);
const BOUNDARY = new Set([
  "p",
  "div",
  "article",
  "section",
  "li",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
]);
function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}
function attribute(node: Node, name: string): string {
  return "attrs" in node ? (node.attrs.find((item) => item.name === name)?.value ?? "") : "";
}
function tag(node: Node): string {
  return "tagName" in node ? node.tagName : "";
}
function normalized(value: string): string {
  return value
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** FR-SRC-006: a passive parser, with no DOM, JavaScript execution or network capability. */
export function extractHtml(
  bytes: Uint8Array,
  contract: Pick<InputContract, "htmlMaxDepth" | "htmlMaxNodes">,
): ExtractedTextBlock[] {
  const document = parse(decodeSourceText(bytes));
  let count = 0;
  function check(node: Node, depth: number): void {
    if (++count > contract.htmlMaxNodes || depth > contract.htmlMaxDepth)
      throw errors.validationFailed({ html: ["structure_limit"] });
    for (const child of children(node)) check(child, depth + 1);
  }
  check(document, 0);
  function inline(node: Node): string {
    if ("value" in node && node.nodeName === "#text") return node.value;
    const name = tag(node);
    if (OMIT.has(name)) return "";
    if (name === "br") return "\n";
    if (name === "img") return attribute(node, "alt");
    const value = children(node)
      .map(inline)
      .join(name === "td" || name === "th" ? " " : "");
    if (name === "a") {
      const href = attribute(node, "href");
      return href ? `${value} (${href})` : value;
    }
    return name === "tr" ? `${value}\n` : name === "td" || name === "th" ? `${value}\t` : value;
  }
  const blocks: ExtractedTextBlock[] = [];
  const containsBoundary = (node: Node): boolean =>
    BOUNDARY.has(tag(node)) || children(node).some(containsBoundary);
  const push = (kind: ExtractedTextBlock["kind"], text: string, level?: number) => {
    const clean = normalized(text);
    if (!clean) return;
    for (const text of textChunks(clean))
      blocks.push({
        id: `block-${blocks.length + 1}`,
        kind,
        text,
        ...(level === undefined ? {} : { level }),
      });
  };
  function visit(node: Node): void {
    const name = tag(node);
    if (OMIT.has(name) || name === "head") return;
    if (BOUNDARY.has(name) && !children(node).some((child) => BOUNDARY.has(tag(child)))) {
      const kind = /^h[1-6]$/.test(name)
        ? "heading"
        : name === "li"
          ? "list_item"
          : name === "table"
            ? "table"
            : "paragraph";
      push(kind, inline(node), kind === "heading" ? Number(name[1]) : undefined);
      return;
    }
    if (name === "table") {
      push("table", inline(node));
      return;
    }
    let pending = "";
    for (const child of children(node)) {
      if (containsBoundary(child)) {
        push("paragraph", pending);
        pending = "";
        visit(child);
      } else pending += inline(child);
    }
    push("paragraph", pending);
  }
  visit(document);
  return blocks;
}

/** FR-SRC-006: plain text is never interpreted as HTML or instruction. */
export function extractPlainText(bytes: Uint8Array): ExtractedTextBlock[] {
  return decodeSourceText(bytes)
    .split(/(?:\r?\n){2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .flatMap(textChunks)
    .map((text, index) => ({ id: `block-${index + 1}`, kind: "paragraph", text }));
}
