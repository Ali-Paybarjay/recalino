import { renderStudyCard } from "@recalino/core/study-render";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { referenceStudyModel } from "../../../../../packages/core/test/reference-study-fixture";
import { CardFace } from "./CardFace";
import { framedClassNotesHtml } from "./ClassNotesFrame";

describe("study card faces", () => {
  const card = {
    contentFormat: "lesson_html",
    front: '<div dir="rtl">استهلاک</div><br><div dir="ltr">Some <b>______</b>.</div>',
    back: '<div dir="ltr"><b>wear and tear</b><br><span class="ipa">/ˌweər ən ˈteə/</span></div>',
  };
  const tagged = {
    front:
      '<div dir="rtl" lang="fa">استهلاک</div><br><div dir="ltr" lang="en">Some <b>______</b>.</div>',
    back: '<div dir="ltr" lang="en"><b>wear and tear</b><br><span class="ipa">/ˌweər ən ˈteə/</span></div>',
  };
  it("keeps answers out of the unrevealed DOM and repeats the front above the revealed answer", () => {
    const front = renderToStaticMarkup(createElement(CardFace, { card }));
    expect(front).toContain(tagged.front);
    expect(front).not.toContain("wear and tear");
    const revealed = renderToStaticMarkup(createElement(CardFace, { card, revealed: true }));
    expect(revealed).toContain(`${tagged.front}<hr>${tagged.back}`);
  });
  // A11Y-02: the app page is lang="en", so the lang-less Persian reference faces need hints.
  it("tells a screen reader which parts of a Persian-notes card are Persian and which English", () => {
    const html = renderToStaticMarkup(createElement(CardFace, { card, revealed: true }));
    expect(html).toContain('<div dir="rtl" lang="fa">استهلاک</div>');
    expect(html).toContain('<div dir="ltr" lang="en">Some <b>______</b>.</div>');
    expect(html).toContain('<div dir="ltr" lang="en"><b>wear and tear</b>');
  });
  it("labels every direction block the Persian renderer produces, leaving the stored face as it is", () => {
    const model = referenceStudyModel();
    for (const item of model.learningItems) {
      const stored = renderStudyCard(item, "fa");
      const html = renderToStaticMarkup(
        createElement(CardFace, {
          card: { ...stored, contentFormat: "lesson_html" },
          revealed: true,
        }),
      );
      // Every block that names a direction names its language too.
      expect(html).not.toMatch(/<div dir="(?:ltr|rtl)"(?: style="[^"]*")?>/);
      expect(html).toContain('lang="fa"');
      expect(html).toContain('lang="en"');
      expect(stored.front).not.toContain("lang=");
    }
  });
  it.each([
    ["es", "ltr", "Desgaste"],
    ["ar", "rtl", "التآكل"],
    ["he", "rtl", "בלאי"],
    ["zh-Hans", "ltr", "损耗"],
  ])("retains language and direction of safe %s rich faces", (language, direction, meaning) => {
    const face = `<div lang="${language}" dir="${direction}">${meaning}</div>`;
    const html = renderToStaticMarkup(createElement(CardFace, { card: { ...card, front: face } }));
    expect(html).toContain(face);
    expect(html).not.toContain("&lt;div");
  });
  it("escapes older plain text and rejects active markup even with a rich discriminator", () => {
    expect(
      renderToStaticMarkup(
        createElement(CardFace, { card: { front: "<b>literal</b>", back: "answer" } }),
      ),
    ).toContain("&lt;b&gt;literal&lt;/b&gt;");
    const html = renderToStaticMarkup(
      createElement(CardFace, { card: { ...card, front: '<img src="x" onerror="alert(1)">' } }),
    );
    expect(html).not.toContain("<img");
  });
});

describe("framed class notes", () => {
  it("adds only a local base URL and the selected theme", () => {
    const source =
      '<!doctype html><html lang="fa" dir="rtl"><head><title>Lesson</title></head><body><a href="#core">Core</a></body></html>';
    expect(framedClassNotesHtml(source, "dark")).toBe(
      source
        .replace('<html lang="fa" dir="rtl">', '<html lang="fa" dir="rtl" data-theme="dark">')
        .replace("<head>", '<head><base href="about:srcdoc">'),
    );
  });
});
