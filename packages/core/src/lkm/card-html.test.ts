import { describe, expect, it } from "vitest";
import { cardHtmlToText, safeCardHtml } from "./card-html";

describe("deterministic card HTML boundary", () => {
  it("preserves the reference's restricted face markup", () => {
    const html =
      '<div dir="rtl" style="font-size:1.1em">معنی <bdi>word</bdi></div><br><div dir="ltr"><b style="font-size:1.25em">word</b><br><span class="ipa">/wɜːd/</span><br><i>A sentence.</i></div><hr>';
    expect(safeCardHtml(html)).toBe(html);
    expect(cardHtmlToText(html)).toBe("معنی word word /wɜːd/ A sentence.");
  });
  it.each([
    '<img src=x onerror="alert(1)">',
    "<svg><script>alert(1)</script></svg>",
    '<div onclick="alert(1)">word</div>',
    '<div style="font-size:1.1em;background:url(https://bad.test)">word</div>',
    '<div title="answer">word</div>',
    '<div dir="ltr" dir="rtl">word</div>',
    "<!-- hidden -->word",
    "<broken",
    '<div><iframe srcdoc="bad"></iframe></div>',
  ])("escapes unsupported markup entirely: %s", (value) => {
    expect(safeCardHtml(value)).not.toContain("<");
  });
});
