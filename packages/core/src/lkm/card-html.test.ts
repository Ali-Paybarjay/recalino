import { describe, expect, it } from "vitest";
import { cardHtmlToText, cardHtmlWithLanguages, safeCardHtml } from "./card-html";

describe("deterministic card HTML boundary", () => {
  it("preserves the reference's restricted face markup", () => {
    const html =
      '<div dir="rtl" style="font-size:1.1em">معنی <bdi>word</bdi></div><br><div dir="ltr"><b style="font-size:1.25em">word</b><br><span class="ipa">/wɜːd/</span><br><i>A sentence.</i></div><hr>';
    expect(safeCardHtml(html)).toBe(html);
    expect(cardHtmlToText(html)).toBe("معنی word word /wɜːd/ A sentence.");
  });
  it.each(["es", "ar", "he", "en", "zh-Hans", "zh-Hant"])(
    "preserves passive language annotations for %s",
    (language) => {
      const html = `<div lang="${language}" dir="auto">A meaning <bdi lang="en" dir="ltr">word</bdi></div>`;
      expect(safeCardHtml(html)).toBe(html);
      expect(cardHtmlToText(html)).toBe("A meaning word");
    },
  );
  it.each([
    '<img src=x onerror="alert(1)">',
    "<svg><script>alert(1)</script></svg>",
    '<div onclick="alert(1)">word</div>',
    '<div style="font-size:1.1em;background:url(https://bad.test)">word</div>',
    '<div title="answer">word</div>',
    '<div lang="es" onclick="alert(1)">word</div>',
    '<div lang="en javascript:alert(1)">word</div>',
    '<div lang="zh-Hans&quot; onclick=&quot;alert(1)">word</div>',
    '<div lang="es" lang="ar">word</div>',
    '<div lang="../../evil">word</div>',
    '<div dir="ltr" dir="rtl">word</div>',
    "<!-- hidden -->word",
    "<broken",
    '<div><iframe srcdoc="bad"></iframe></div>',
  ])("escapes unsupported markup entirely: %s", (value) => {
    expect(safeCardHtml(value)).not.toContain("<");
  });
});

// A11Y-02: the Persian reference output keeps its direction blocks without `lang` (the reference
// comparison tests need that), while the app page is lang="en". Display adds the missing language.
describe("language hints for display", () => {
  it("tags the lang-less blocks of the Persian reference output", () => {
    const html =
      '<div dir="rtl" style="font-size:1.1em">معنی <b>مهم</b> <bdi>wear</bdi> و <bdi dir="ltr" class="ipa">/weə/</bdi></div><br><div dir="ltr"><b>wear and tear</b><br><span class="ipa">/ˌweər/</span></div>';
    expect(cardHtmlWithLanguages(html)).toBe(
      '<div dir="rtl" style="font-size:1.1em" lang="fa">معنی <b>مهم</b> <bdi lang="en">wear</bdi> و <bdi dir="ltr" class="ipa" lang="en">/weə/</bdi></div><br><div dir="ltr" lang="en"><b>wear and tear</b><br><span class="ipa">/ˌweər/</span></div>',
    );
  });

  it("leaves blocks that already name their language alone, including what is inside them", () => {
    const html =
      '<div lang="es" dir="ltr">Desgaste <bdi dir="ltr" class="ipa">/x/</bdi> <bdi dir="rtl">ع</bdi></div><br><div dir="ltr" lang="en">word</div>';
    expect(cardHtmlWithLanguages(html)).toBe(html);
  });

  it("does not guess the language of nested blocks or direction-less wrappers", () => {
    const legacy = '<div dir="auto">Some text</div>';
    expect(cardHtmlWithLanguages(legacy)).toBe(legacy);
    const nested = '<div lang="ar" dir="rtl"><div dir="ltr">word</div></div>';
    expect(cardHtmlWithLanguages(nested)).toBe(nested);
    // An English isolate only gains a language inside a block that was itself tagged Persian.
    const english = '<div dir="ltr">a <bdi>b</bdi></div>';
    expect(cardHtmlWithLanguages(english)).toBe('<div dir="ltr" lang="en">a <bdi>b</bdi></div>');
  });

  it("keeps closing a tagged block from tagging the next one's contents", () => {
    const html = '<div dir="rtl">الف <bdi>a</bdi></div><div lang="es" dir="ltr"><bdi>b</bdi></div>';
    expect(cardHtmlWithLanguages(html)).toBe(
      '<div dir="rtl" lang="fa">الف <bdi lang="en">a</bdi></div><div lang="es" dir="ltr"><bdi>b</bdi></div>',
    );
  });

  it("still escapes anything that is not the restricted vocabulary", () => {
    expect(cardHtmlWithLanguages("<b>literal</b><img src=x>")).toBe(
      safeCardHtml("<b>literal</b><img src=x>"),
    );
    expect(cardHtmlWithLanguages('<div dir="rtl" onclick="x">a</div>')).not.toContain("<div");
    expect(cardHtmlWithLanguages("plain & text")).toBe(safeCardHtml("plain & text"));
  });

  it("is a no-op for text that has no direction block", () => {
    expect(cardHtmlWithLanguages("<b>x</b>")).toBe("<b>x</b>");
  });
});
