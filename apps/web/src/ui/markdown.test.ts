import { describe, expect, it } from "vitest";
import { LEGAL_TEXTS } from "../legal/texts.generated";
import { fillPlaceholders, parseInline, parseMarkdown } from "./markdown";

describe("legal Markdown reader", () => {
  it("reads every block the legal texts use", () => {
    const blocks = parseMarkdown(
      [
        "# Title",
        "",
        "> **Draft.** Not final.",
        "",
        "## 1. Who",
        "",
        "First line",
        "second line.",
        "",
        "- one",
        "- two",
        "",
        "| A | B |",
        "|---|---|",
        "| a1 | b1 |",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "quote",
      "heading",
      "paragraph",
      "list",
      "table",
    ]);
    expect(blocks[3]).toEqual({
      kind: "paragraph",
      content: [{ kind: "text", text: "First line second line." }],
    });
    expect(blocks[5]).toMatchObject({
      kind: "table",
      rows: [[[{ text: "a1" }], [{ text: "b1" }]]],
    });
  });

  it("keeps only web links as links", () => {
    expect(parseInline("see [ICO](https://ico.org.uk) and [file](../x.md)")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "ICO", href: "https://ico.org.uk" },
      { kind: "text", text: " and " },
      { kind: "text", text: "file" },
    ]);
  });

  it("fills the placeholders and leaves unknown ones visible", () => {
    expect(fillPlaceholders("{{a}} and {{b}}", { a: "x" })).toBe("x and {{b}}");
  });

  it("reads the real Terms and Privacy Notice", () => {
    for (const text of Object.values(LEGAL_TEXTS)) {
      const blocks = parseMarkdown(text.markdown);
      expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
      expect(blocks.length).toBeGreaterThan(10);
    }
  });
});
