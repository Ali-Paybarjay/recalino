import { expect, it } from "vitest";
import { extractHtml, extractPlainText, MAX_EXTRACTED_BLOCK_LENGTH } from "./extract";

it.each(["text", "html"])(
  "FR-SRC-006 splits a long %s paragraph into lossless schema-sized blocks",
  (kind) => {
    const text = `${"a".repeat(MAX_EXTRACTED_BLOCK_LENGTH - 1)}🙂${"ب".repeat(30)}`;
    const blocks =
      kind === "text"
        ? extractPlainText(new TextEncoder().encode(text))
        : extractHtml(new TextEncoder().encode(`<p>${text}</p>`), {
            htmlMaxDepth: 100,
            htmlMaxNodes: 1000,
          });
    expect(blocks.map((block) => block.text).join("")).toBe(text);
    expect(blocks.map((block) => block.id)).toEqual(["block-1", "block-2"]);
    expect(blocks.every((block) => block.text.length <= MAX_EXTRACTED_BLOCK_LENGTH)).toBe(true);
    for (const block of blocks)
      expect(new TextDecoder().decode(new TextEncoder().encode(block.text))).toBe(block.text);
  },
);
