import { type DefaultTreeAdapterMap, parse, parseFragment } from "parse5";
import { expect, it } from "vitest";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { FIRST_LANGUAGES } from "../acc";
import { isStudyCardHtml } from "./card-html";
import { renderMixedStudy } from "./mixed-text";
import type { KnowledgeModel } from "./schema";
import { resolveStudyLocale, studyMessage } from "./study-locale";
import { visibleMistakePatterns } from "./study-policy";
import { renderClassNotesHtml, renderStudyCard } from "./study-render";
import { localizedStudyStyles } from "./study-styles";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
function elements(node: Node, tag?: string): Element[] {
  return [
    ...("tagName" in node && (!tag || node.tagName === tag) ? [node] : []),
    ...("childNodes" in node ? node.childNodes.flatMap((child) => elements(child, tag)) : []),
  ];
}
function attr(node: Element, name: string): string | undefined {
  return node.attrs.find((item) => item.name === name)?.value;
}
function visible(node: Node): string {
  if ("value" in node) return node.value;
  if ("tagName" in node && ["style", "script", "head"].includes(node.tagName)) return "";
  return "childNodes" in node ? node.childNodes.map(visible).join(" ") : "";
}
function modelIn(language: string, explanation: string): KnowledgeModel {
  const model = referenceStudyModel();
  const replace = (value: unknown): unknown => {
    if (typeof value === "string" && /\p{Script=Arabic}/u.test(value)) return explanation;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    return value;
  };
  const translated = replace(model) as KnowledgeModel;
  translated.language.explanation = language;
  translated.title = explanation;
  const first = translated.learningItems[0];
  if (first?.study?.set !== "production") throw new Error("fixture");
  first.study.faApprox = "PERSIAN_APPROX_SENTINEL";
  first.study.noteFa = explanation;
  translated.summary = [
    { ...first.claim, id: "summary", text: explanation, origin: "ai_expansion" },
  ];
  return translated;
}

it.each([
  ["fa", "rtl"],
  ["ar", "rtl"],
  ["ur", "rtl"],
  ["he", "rtl"],
  ["yi", "rtl"],
  ["dv", "rtl"],
  ["ps", "rtl"],
  ["ug", "rtl"],
  ["es", "ltr"],
  ["en", "ltr"],
  ["ru", "ltr"],
  ["hi", "ltr"],
  ["zh-Hans", "ltr"],
  ["zh-Hant", "ltr"],
  ["ja", "ltr"],
  ["ko", "ltr"],
  ["ks", "auto"],
  ["ku", "auto"],
  ["sd", "auto"],
  ["pa", "auto"],
  ["az", "auto"],
  ["pa-Arab", "rtl"],
  ["pa-Guru", "ltr"],
] as const)("resolves %s to %s without conflating learner scripts", (language, direction) => {
  expect(resolveStudyLocale(language).direction).toBe(direction);
});

it.each([
  ["es", "Una explicación clara", "Tarjetas principales"],
  ["en", "A clear explanation", "Core cards"],
  ["ar", "شرح واضح", "البطاقات الأساسية"],
  ["ur", "واضح وضاحت", "بنیادی کارڈ"],
  ["he", "הסבר ברור", "כרטיסים עיקריים"],
  ["ru", "Понятное объяснение", "Основные карточки"],
  ["hi", "स्पष्ट व्याख्या", "मुख्य कार्ड"],
  ["bn", "স্পষ্ট ব্যাখ্যা", "মূল কার্ড"],
  ["ja", "分かりやすい説明", "主要カード"],
  ["ko", "명확한 설명", "주요 카드"],
  ["zh-Hans", "清楚的解释", "核心卡片"],
  ["zh-Hant", "清楚的解釋", "核心卡片"],
] as const)(
  "renders %s notes and card faces in the selected language without Persian chrome or approximation",
  (language, explanation, heading) => {
    const model = modelIn(language, explanation);
    const html = renderClassNotesHtml(model);
    const document = parse(html);
    const root = elements(document, "html")[0];
    expect(root && attr(root, "lang")).toBe(resolveStudyLocale(language).language);
    expect(root && attr(root, "dir")).toBe(resolveStudyLocale(language).direction);
    expect(visible(document)).toContain(heading);
    expect(visible(document)).toContain(explanation);
    expect(visible(document)).not.toContain("تقریب فارسی");
    expect(visible(document)).not.toContain("کارت‌های اصلی");
    expect(visible(document)).not.toContain("منبع:");
    expect(html).not.toContain("PERSIAN_APPROX_SENTINEL");
    const first = model.learningItems[0];
    if (!first?.study) throw new Error("fixture");
    const card = renderStudyCard(first, language);
    const proseDiv = elements(parseFragment(card.front), "div")[0];
    expect(proseDiv && attr(proseDiv, "lang")).toBe(language);
    expect(proseDiv && attr(proseDiv, "dir")).toBe(resolveStudyLocale(language).direction);
    expect(card.front).not.toContain(first.study.en);
    expect(card.back).toContain(first.study.ipa);
    expect(card.back).not.toContain("PERSIAN_APPROX_SENTINEL");
    expect(isStudyCardHtml(card.front)).toBe(true);
    expect(isStudyCardHtml(card.back)).toBe(true);
    const pronSection = elements(document, "section").find((item) => attr(item, "id") === "pron");
    expect(pronSection && elements(pronSection, "th").length).toBe(3);
  },
);

it("keeps LTR Latin, Cyrillic and Indic prose intact, isolates RTL fragments and keeps IPA styling", () => {
  expect(renderMixedStudy("Usa **present perfect** aquí.", "ltr")).toBe(
    "Usa <b>present perfect</b> aquí.",
  );
  expect(renderMixedStudy("Произнеси /θ/ правильно.", "ltr")).toBe(
    'Произнеси <bdi dir="ltr" class="ipa">/θ/</bdi> правильно.',
  );
  expect(renderMixedStudy("व्याकरण **present perfect** है।", "ltr")).toBe(
    "व्याकरण <b>present perfect</b> है।",
  );
  expect(renderMixedStudy("Compare שלום with hello", "ltr")).toContain('<bdi dir="rtl">שלום</bdi>');
  expect(renderMixedStudy("דוגמה: **I was about to leave.**", "rtl")).toBe(
    'דוגמה: <b><bdi dir="ltr">I was about to leave.</bdi></b>',
  );
  expect(renderMixedStudy("شرح: /θ/ ثم the", "rtl")).toContain(
    '<bdi dir="ltr" class="ipa">/θ/</bdi>',
  );
});

it("chooses script fonts without changing Persian reference styling", () => {
  expect(localizedStudyStyles(resolveStudyLocale("fa"))).toBe("");
  expect(localizedStudyStyles(resolveStudyLocale("zh-Hans"))).toContain("Noto Sans SC");
  expect(localizedStudyStyles(resolveStudyLocale("he"))).toContain("Noto Sans Hebrew");
  expect(localizedStudyStyles(resolveStudyLocale("hi"))).toContain("Noto Sans Devanagari");
  expect(localizedStudyStyles(resolveStudyLocale("ur"))).toContain("Noto Nastaliq Urdu");
  expect(localizedStudyStyles(resolveStudyLocale("ru"))).toContain("Noto Sans");
});

it("resolves a locale with a local font stack and no web font family (audit SEC-04)", () => {
  expect(resolveStudyLocale("ru")).toEqual({
    language: "ru",
    direction: "ltr",
    isPersian: false,
    fontFamily: '"Noto Sans", Arial, Tahoma, sans-serif',
  });
  expect(resolveStudyLocale("zh-Hant")).toEqual({
    language: "zh-Hant",
    direction: "ltr",
    isPersian: false,
    fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif',
  });
});

it.each(FIRST_LANGUAGES.filter((language) => language !== "fa"))(
  "preserves catalog language %s and explicitly tags untranslated chrome as English",
  (language) => {
    const html = renderClassNotesHtml(modelIn(language, "Learner explanation"));
    const document = parse(html);
    const root = elements(document, "html")[0];
    expect(root && attr(root, "lang")).toBe(resolveStudyLocale(language).language);
    expect(visible(document)).not.toContain("کارت‌های اصلی");
    expect(html).not.toContain("PERSIAN_APPROX_SENTINEL");
    const label = studyMessage(language, "coreHeading");
    if (label.language === "en" && language !== "en") {
      expect(
        elements(document, "span").some(
          (item) => attr(item, "lang") === "en" && visible(item).includes("Core cards"),
        ),
      ).toBe(true);
    }
  },
);

it.each(["es", "he", "ar", "ja", "hi", 'es"><script>'])(
  "escapes hostile explanation and locale payloads in %s output",
  (language) => {
    const poison = '<img src=x onerror="alert(1)"><script>alert(1)</script>&';
    const model = modelIn(language, poison);
    const first = model.learningItems[0];
    if (!first?.study || !model.classNotes) throw new Error("fixture");
    first.id = '" onclick="alert(1)';
    model.classNotes.tasks = [
      { title: poison, blocks: [{ type: "table", headers: [poison], rows: [[poison]] }] },
    ];
    const faces = renderStudyCard(first, language);
    for (const output of [renderClassNotesHtml(model), faces.front, faces.back]) {
      const document = parse(output);
      expect(
        elements(document).some((item) =>
          ["img", "script", "iframe", "object"].includes(item.tagName),
        ),
      ).toBe(false);
      expect(
        elements(document)
          .flatMap((item) => item.attrs)
          .some((item) => item.name.startsWith("on")),
      ).toBe(false);
      expect(output).toContain("&lt;");
    }
  },
);

it("formats numbering and weekdays for the selected locale", () => {
  const spanish = renderClassNotesHtml(modelIn("es", "Explicación"));
  const arabic = renderClassNotesHtml(modelIn("ar", "شرح"));
  expect(spanish).toContain("lunes");
  expect(spanish).toContain("<h2>1.");
  expect(arabic).toContain("الاثنين");
  expect(arabic).not.toContain("دوشنبه");
  expect(spanish).not.toContain("دوشنبه");
});

it("keeps voice confirmation fail-closed in non-Persian documents", () => {
  const model = modelIn("es", "Explicación");
  const mistakes = model.classNotes?.mistakes;
  if (!mistakes) throw new Error("fixture");
  mistakes.speechStatus = "verified";
  const html = renderClassNotesHtml(model);
  expect(visible(parse(html))).toContain("Los errores orales se ocultan");
  expect(html).not.toContain("The quality was really disappointed");
  expect(html).not.toContain("Tu voz confirmada</h3>");
});

it.each([
  ["es", "Reescribe la frase", "Significado claro"],
  ["he", "כתוב מחדש את המשפט", "משמעות ברורה"],
  ["ja", "文を書き換えてください", "分かりやすい意味"],
] as const)(
  "tags %s grammar instructions and recognition meanings independently from English exercises",
  (language, instruction, meaning) => {
    const model = modelIn(language, meaning);
    const first = model.learningItems[0];
    const recognition = model.learningItems.find((item) => item.study?.set === "recognition");
    if (first?.study?.set !== "production" || !recognition?.study) throw new Error("fixture");
    first.study.kind = "grammar";
    first.study.taskFa = instruction;
    first.study.prompt = "We need to kit out the new office.";
    first.study.fullSentence = "We need to kit it out.";
    const grammar = renderStudyCard(first, language);
    expect(grammar.front).toContain(instruction);
    expect(grammar.front).not.toContain(first.study.fullSentence);
    expect(grammar.back).toContain(first.study.fullSentence);
    const frontDivs = elements(parseFragment(grammar.front), "div");
    expect(frontDivs[0] && attr(frontDivs[0], "lang")).toBe(language);
    expect(frontDivs[1] && attr(frontDivs[1], "lang")).toBe("en");
    recognition.study.faMeaning = meaning;
    const recognized = renderStudyCard(recognition, language);
    expect(recognized.front).toContain(recognition.study.en);
    expect(recognized.back).toContain(meaning);
    const backDivs = elements(parseFragment(recognized.back), "div");
    expect(backDivs[0] && attr(backDivs[0], "lang")).toBe(language);
    expect(backDivs[0] && attr(backDivs[0], "dir")).toBe(resolveStudyLocale(language).direction);
    for (const face of [grammar.front, grammar.back, recognized.front, recognized.back]) {
      expect(isStudyCardHtml(face)).toBe(true);
    }
  },
);

it("tags derived English pattern labels and rules in an unlocalized script while preserving native generated prose", () => {
  const model = modelIn("ta", "தெளிவான விளக்கம்");
  const mistakes = model.classNotes?.mistakes;
  if (!mistakes) throw new Error("fixture");
  mistakes.items = mistakes.items.filter((item) => item.source === "handwriting").slice(0, 2);
  for (const [index, item] of mistakes.items.entries()) {
    item.kind = "grammar";
    item.whyFa = index === 0 ? "முதல் விளக்கம்" : "இரண்டாவது விளக்கம்";
  }
  mistakes.patterns = visibleMistakePatterns(mistakes.items, "ta");
  expect(mistakes.patterns).toHaveLength(1);
  const document = parse(renderClassNotesHtml(model));
  const patternMeaning = elements(document, "p").find(
    (item) => attr(item, "class") === "mean" && visible(item).includes("Grammar"),
  );
  const patternRule = elements(document, "p").find(
    (item) =>
      attr(item, "class") === "why" &&
      visible(item).includes("Review the corrected examples above."),
  );
  for (const node of [patternMeaning, patternRule]) {
    expect(node).toBeDefined();
    expect(
      node &&
        elements(node, "span").some(
          (item) => attr(item, "lang") === "en" && attr(item, "dir") === "ltr",
        ),
    ).toBe(true);
  }
  const firstPattern = mistakes.patterns[0];
  if (!firstPattern) throw new Error("fixture");
  firstPattern.labelFa = "தமிழ்ப் பிழைகள்";
  firstPattern.ruleFa = "மேலுள்ள எடுத்துக்காட்டுகளைப் பார்க்கவும்";
  const native = parse(renderClassNotesHtml(model));
  for (const text of [firstPattern.labelFa, firstPattern.ruleFa]) {
    const paragraph = elements(native, "p").find((item) => visible(item).includes(text));
    expect(paragraph).toBeDefined();
    expect(
      paragraph &&
        elements(paragraph, "span").some(
          (item) => attr(item, "lang") === "en" && visible(item).includes(text),
        ),
    ).toBe(false);
  }
});
