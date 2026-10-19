import { describe, expect, it } from "vitest";
import { mediaAlt } from "./media-alt";

// A11Y-05: images attached to cards describe themselves from the card text or the source name.
describe("card media alt text", () => {
  it("uses the card text, flattened onto one line", () => {
    expect(mediaAlt("Which animal is this?\n\n  Say it aloud")).toBe(
      "Which animal is this? Say it aloud",
    );
  });

  it("reduces lesson markup to text without interpreting it", () => {
    expect(mediaAlt('<div dir="ltr"><b>wear</b> and tear</div>')).toBe("wear and tear");
    expect(mediaAlt("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });

  it("keeps Persian and mixed-direction text as it is", () => {
    expect(mediaAlt("معنی «wear and tear» چیست؟")).toBe("معنی «wear and tear» چیست؟");
  });

  it("falls through to the next candidate, such as the source name", () => {
    expect(mediaAlt("", "  ", "board-photo-2.jpg")).toBe("board-photo-2.jpg");
    expect(mediaAlt(null, undefined, "board-photo-2.jpg")).toBe("board-photo-2.jpg");
    expect(mediaAlt("board-photo-2.jpg", "Which animal is this?")).toBe("board-photo-2.jpg");
  });

  it("is empty, marking the image decorative, when nothing describes it", () => {
    expect(mediaAlt()).toBe("");
    expect(mediaAlt("", null, undefined, "   ")).toBe("");
  });

  it("shortens long text without splitting a character", () => {
    const long = `${"word ".repeat(60)}end`;
    const alt = mediaAlt(long);
    expect(Array.from(alt).length).toBeLessThanOrEqual(125);
    expect(alt.endsWith("…")).toBe(true);
    const emoji = mediaAlt("😀".repeat(200));
    expect(Array.from(emoji)).toHaveLength(125);
    expect(emoji.endsWith("😀…")).toBe(true);
  });

  it("never shortens text that already fits", () => {
    const exact = "a".repeat(125);
    expect(mediaAlt(exact)).toBe(exact);
  });
});
