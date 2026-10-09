import { describe, expect, it } from "vitest";
import {
  interactiveClassNotesHtml,
  NOTE_PRONUNCIATION_BRIDGE,
  pronunciationMessageItem,
} from "./class-notes-pronunciation";

const channel = "c20d799f-388b-476e-89ef-928af55dc773";
const nonce = "a864933a-6efb-40f9-b420-0155a8f4c697";
const frame = {} as Window;
const eligible = new Set(["item-1"]);
const message = { type: "recalino:pronunciation", channel, itemId: "item-1" };
describe("bounded pronunciation frame", () => {
  it("requires exact current frame, channel, eligible ID and fields", () => {
    expect(
      pronunciationMessageItem({ source: frame, data: message }, frame, channel, eligible),
    ).toBe("item-1");
    for (const data of [
      null,
      "item-1",
      { ...message, channel: "old" },
      { ...message, itemId: "other" },
      { ...message, text: "arbitrary billable speech" },
    ])
      expect(
        pronunciationMessageItem({ source: frame, data }, frame, channel, eligible),
      ).toBeNull();
    expect(
      pronunciationMessageItem({ source: {} as Window, data: message }, frame, channel, eligible),
    ).toBeNull();
    expect(
      pronunciationMessageItem({ source: null, data: message }, null, channel, eligible),
    ).toBeNull();
  });
  it("escapes metadata independently from the sole constant executable program", () => {
    const html = interactiveClassNotesHtml(
      '<html><head><base href="about:srcdoc"></head><body><p>Lesson</p></body></html>',
      [{ id: "item-1", target: 'word"/><script>bad()</script>' }],
      channel,
      nonce,
    );
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).toContain(`nonce="${nonce}">${NOTE_PRONUNCIATION_BRIDGE}</script>`);
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain('word"/><script>');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain('base href="about:srcdoc"');
    expect(html).toContain("base-uri about:");
    expect(html).not.toContain("unsafe-eval");
    expect(html).not.toContain("script-src 'unsafe-inline'");
  });
  it("rejects an injected CSP nonce or channel", () => {
    expect(() =>
      interactiveClassNotesHtml("<head></head>", [], channel, 'x" onclick=evil'),
    ).toThrow();
    expect(() => interactiveClassNotesHtml("<head></head>", [], "x</script>", nonce)).toThrow();
  });
});
