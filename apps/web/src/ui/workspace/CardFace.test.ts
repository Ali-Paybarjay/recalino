import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardFace } from "./CardFace";
import { framedClassNotesHtml } from "./ClassNotesFrame";

describe("study card faces", () => {
  const card = {
    contentFormat: "lesson_html",
    front: '<div dir="rtl">استهلاک</div><br><div dir="ltr">Some <b>______</b>.</div>',
    back: '<div dir="ltr"><b>wear and tear</b><br><span class="ipa">/ˌweər ən ˈteə/</span></div>',
  };
  it("keeps answers out of the unrevealed DOM and repeats the front above the revealed answer", () => {
    const front = renderToStaticMarkup(createElement(CardFace, { card }));
    expect(front).toContain(card.front);
    expect(front).not.toContain("wear and tear");
    const revealed = renderToStaticMarkup(createElement(CardFace, { card, revealed: true }));
    expect(revealed).toContain(`${card.front}<hr>${card.back}`);
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
