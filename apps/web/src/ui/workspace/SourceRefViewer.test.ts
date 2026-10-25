import { describe, expect, it } from "vitest";
import { textExcerpt } from "./SourceRefViewer";

describe("SourceRef text excerpts (PRD-LKM-05)", () => {
  it("cuts a text locator by code point, as the LKM schema counts it", () => {
    // The emoji is one code point but two UTF-16 units, so a plain slice starts one letter late.
    const text = "🎧 I look forward to it";
    expect(textExcerpt(text, 4, 19)).toBe("look forward to");
    expect(text.slice(4, 19)).not.toBe("look forward to");
    expect(textExcerpt("学习 𠮷野家 menu", 3, 6)).toBe("𠮷野家");
  });

  it("keeps plain text and empty ranges as they are", () => {
    expect(textExcerpt("Present perfect", 0, 7)).toBe("Present");
    expect(textExcerpt("Present perfect", 3, 3)).toBe("");
  });
});
