import { describe, expect, it } from "vitest";
import { type ContentVersion, sourceRefText } from "./source-ref-text";

function version(...blocks: [id: string, text: string, unitId?: string][]): ContentVersion {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    blocks: blocks.map(([id, text, unitId = "unit"]) => ({ id, text, unitId })),
    units: [
      { id: "unit", kind: "text", start: 0, status: "succeeded" },
      { id: "page-2", kind: "page", start: 2, status: "succeeded" },
      { id: "audio", kind: "time", start: 1000, end: 5000, status: "succeeded" },
    ],
  };
}
function text(blockId: string, start: number, end: number) {
  return { kind: "text" as const, blockId, start, end };
}

// FR-SRC-010 / PRD-LKM-05: text locator offsets are code points, as the LKM validator counts them.
describe("text SourceRef excerpts", () => {
  const emoji = "😀 Hello, world 🌍!";
  const pinned = version(["emoji", emoji]);

  it("slices a block with emoji by code point, not UTF-16 unit", () => {
    expect(sourceRefText(pinned, text("emoji", 2, 7))).toBe("Hello");
    expect(sourceRefText(pinned, text("emoji", 0, 1))).toBe("😀");
  });

  it("keeps the whole trailing emoji when the locator ends at the validator's code-point length", () => {
    const end = Array.from(emoji).length;
    expect(end).toBeLessThan(emoji.length);
    expect(sourceRefText(pinned, text("emoji", 15, end))).toBe("🌍!");
    expect(sourceRefText(pinned, text("emoji", 0, end))).toBe(emoji);
  });

  // PRD-ONB-01 / D31: RTL and CJK content keeps its characters intact around emoji.
  it("keeps RTL and CJK text intact next to emoji", () => {
    const content = version(["fa", "سلام 👋 دنیا"], ["zh", "你好😀世界"]);
    expect(sourceRefText(content, text("fa", 5, 11))).toBe("👋 دنیا");
    expect(sourceRefText(content, text("zh", 2, 5))).toBe("😀世界");
  });

  it("shows nothing when the referenced block is missing", () => {
    expect(sourceRefText(pinned, text("missing", 0, 1))).toBe("");
  });
});

describe("page and time SourceRef excerpts", () => {
  const content = version(
    ["intro", "Intro 😀", "unit"],
    ["page", "Page two 📄", "page-2"],
    ["first", "First line", "audio"],
    ["second", "Second line", "audio"],
  );

  it("shows the whole blocks of the referenced page", () => {
    expect(sourceRefText(content, { kind: "page", page: 2, blockId: null })).toBe("Page two 📄");
  });

  it("shows the whole blocks overlapping the referenced time range", () => {
    expect(sourceRefText(content, { kind: "time", startMs: 2000, endMs: 3000 })).toBe(
      "First line\n\nSecond line",
    );
  });
});
