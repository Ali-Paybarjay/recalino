import { describe, expect, it } from "vitest";
import {
  interactiveClassNotesHtml,
  NOTE_PRONUNCIATION_BRIDGE,
  NOTE_READER_BRIDGE,
  NOTES_READER_MAX_HEIGHT,
  NOTES_READER_MIN_HEIGHT,
  notesReaderMessage,
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

describe("bounded standalone notes reader", () => {
  const document =
    '<html><head><base href="about:srcdoc"></head><body><section id="section">Lesson</section></body></html>';
  it("gives a passive reader only the trusted layout bridge under its nonce policy", () => {
    const html = interactiveClassNotesHtml(document, [], channel, nonce, { fitContent: true });
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).toContain(`nonce="${nonce}">${NOTE_READER_BRIDGE}</script>`);
    expect(html).toContain("recalino-notes-reader");
    expect(html).not.toContain("recalino-pronunciation");
    expect(html).not.toContain(NOTE_PRONUNCIATION_BRIDGE);
    expect(html).toContain(`script-src 'nonce-${nonce}'`);
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain("unsafe-eval");
    expect(html).not.toContain("script-src 'unsafe-inline'");
  });
  it("keeps both fixed bridges available for playable reader notes and leaves normal frames unchanged", () => {
    const playable = interactiveClassNotesHtml(
      document,
      [{ id: "item-1", target: "hello" }],
      channel,
      nonce,
      { fitContent: true },
    );
    expect(playable.match(/<script\b/g)).toHaveLength(2);
    expect(playable).toContain(NOTE_PRONUNCIATION_BRIDGE);
    expect(playable).toContain(NOTE_READER_BRIDGE);
    const ordinary = interactiveClassNotesHtml(
      document,
      [{ id: "item-1", target: "hello" }],
      channel,
      nonce,
    );
    expect(ordinary.match(/<script\b/g)).toHaveLength(1);
    expect(ordinary).not.toContain(NOTE_READER_BRIDGE);
    expect(ordinary).not.toContain("overflow:hidden!important");
  });
  it("accepts geometry only from the current frame and channel with exact finite-number fields", () => {
    const resize = { type: "recalino:notes-height", channel, height: 1234.2 };
    const anchor = { type: "recalino:notes-anchor", channel, offset: 640.5 };
    expect(notesReaderMessage({ source: frame, data: resize }, frame, channel)).toEqual({
      type: "resize",
      height: 1235,
    });
    expect(notesReaderMessage({ source: frame, data: anchor }, frame, channel)).toEqual({
      type: "anchor",
      offset: 640.5,
    });
    for (const data of [
      null,
      "height:1234",
      { ...resize, channel: "stale-document" },
      { ...resize, height: "1234" },
      { ...resize, height: -1 },
      { ...resize, height: Infinity },
      { ...resize, height: NaN },
      { ...resize, itemId: "item-1" },
      { ...anchor, offset: -1 },
      { ...anchor, offset: Infinity },
      { ...anchor, href: "javascript:evil()" },
      message,
    ])
      expect(notesReaderMessage({ source: frame, data }, frame, channel)).toBeNull();
    expect(notesReaderMessage({ source: {} as Window, data: resize }, frame, channel)).toBeNull();
    expect(notesReaderMessage({ source: null, data: resize }, null, channel)).toBeNull();
  });
  it("bounds finite geometry so a malformed document cannot allocate unbounded layout or scrolling", () => {
    const read = (type: "height" | "anchor", value: number) =>
      notesReaderMessage(
        {
          source: frame,
          data:
            type === "height"
              ? { type: "recalino:notes-height", channel, height: value }
              : { type: "recalino:notes-anchor", channel, offset: value },
        },
        frame,
        channel,
      );
    expect(read("height", 0)).toEqual({ type: "resize", height: NOTES_READER_MIN_HEIGHT });
    expect(read("height", Number.MAX_VALUE)).toEqual({
      type: "resize",
      height: NOTES_READER_MAX_HEIGHT,
    });
    expect(read("anchor", 0)).toEqual({ type: "anchor", offset: 0 });
    expect(read("anchor", Number.MAX_VALUE)).toEqual({
      type: "anchor",
      offset: NOTES_READER_MAX_HEIGHT,
    });
  });
});
