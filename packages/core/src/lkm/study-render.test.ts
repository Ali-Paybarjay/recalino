import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type DefaultTreeAdapterMap, parse, parseFragment, serialize } from "parse5";
import { expect, it } from "vitest";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { safeCardHtml } from "./card-html";
import { buildStudyAnkiText } from "./study-export";
import { studyMessage } from "./study-locale";
import {
  CLASS_NOTES_STYLES,
  renderClassNotesHtml,
  renderStudyCard,
  WITHHELD_SPEECH_NOTE,
} from "./study-render";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
function elements(node: Node, tag?: string): Element[] {
  const own = "tagName" in node && (!tag || node.tagName === tag) ? [node] : [];
  return [
    ...own,
    ...("childNodes" in node ? node.childNodes.flatMap((child) => elements(child, tag)) : []),
  ];
}
function attribute(node: Element, key: string): string | undefined {
  return node.attrs.find((attr) => attr.name === key)?.value;
}
function byId(node: Node, id: string): Element {
  const element = elements(node).find((candidate) => attribute(candidate, "id") === id);
  if (!element) throw new Error(`Missing reference element ${id}`);
  return element;
}
function normalized(node: Node): unknown {
  if (node.nodeName === "#comment") return undefined;
  if ("value" in node) return node.value.replace(/\s+/g, " ").trim() || undefined;
  return {
    tag: node.nodeName,
    ...("attrs" in node ? { attrs: node.attrs } : {}),
    children:
      "childNodes" in node
        ? node.childNodes.map(normalized).filter((value) => value !== undefined)
        : [],
  };
}

const notesReference = readFileSync(
  fileURLToPath(new URL("../../test/reference-output/class-notes.html", import.meta.url)),
  "utf8",
).replaceAll("\r\n", "\n");
const cardReference = parse(
  readFileSync(
    fileURLToPath(new URL("../../test/reference-output/flashcards.html", import.meta.url)),
    "utf8",
  ),
);

it("AC-D46-01 exposes only escaped item anchors on app opt-in and keeps standalone notes passive", () => {
  const model = referenceStudyModel();
  const first = model.learningItems[0];
  if (!first) throw new Error("Missing synthetic learning item");
  first.id = 'unsafe" onclick="alert(1)';
  const passive = renderClassNotesHtml(model);
  const app = renderClassNotesHtml(model, { itemAnchors: true });
  expect(passive).not.toContain("data-learning-item-id");
  const anchors = elements(parse(app)).filter((element) =>
    attribute(element, "data-learning-item-id"),
  );
  expect(anchors.some((element) => attribute(element, "data-learning-item-id") === first.id)).toBe(
    true,
  );
  expect(anchors.every((element) => !attribute(element, "onclick"))).toBe(true);
  expect(elements(parse(app), "script")).toHaveLength(0);
  expect(elements(parse(app), "button")).toHaveLength(0);
  expect(app.replace(/ data-learning-item-id="[^"]*"/g, "")).toBe(passive);
});

it("copies the reference stylesheet verbatim and reproduces reference sections from structured items", () => {
  expect(CLASS_NOTES_STYLES).toBe(/<style>([\s\S]*?)<\/style>/.exec(notesReference)?.[1]);
  const model = referenceStudyModel();
  // The archived visual reference predates AI labels; its class-sourced rendering stays identical.
  for (const item of model.learningItems) {
    if (item.study?.set === "recognition") item.claim.origin = "from_class";
  }
  const actual = parse(renderClassNotesHtml(model));
  const reference = parse(notesReference);
  for (const id of ["core", "chunks", "tasks", "extra", "register", "gap", "pron"]) {
    expect(normalized(byId(actual, id)), id).toEqual(normalized(byId(reference, id)));
  }
});

it("produces the exact reference production, separable, grammar and recognition card faces", () => {
  const model = referenceStudyModel();
  const first = model.learningItems[0];
  const second = model.learningItems[1];
  const recognition = model.learningItems.find((item) => item.id === "cant-fault");
  if (first?.study?.set !== "production" || !second || !recognition) throw new Error("fixture");
  const grammar = {
    ...first,
    study: {
      ...first.study,
      kind: "grammar" as const,
      taskFa: "جمله را با ضمیر it بازنویسی کن:",
      prompt: "We need to kit out the new office.",
      fullSentence: "We need to kit it out.",
      noteFa: "با ضمیر، مفعول همیشه وسطِ phrasal verb جداشدنی می‌آید: kit it out — نه «kit out it».",
    },
  };
  const referenceFaces = elements(cardReference, "div").filter(
    (node) => attribute(node, "class") === "fc-face",
  );
  for (const [index, item] of [first, second, grammar, recognition].entries()) {
    const { claim: _, ...legacyFields } = item;
    const fields = renderStudyCard(legacyFields);
    const front = referenceFaces[index * 2];
    const revealed = referenceFaces[index * 2 + 1];
    if (!front || !revealed) throw new Error("Missing reference card");
    expect(normalized(parseFragment(fields.front)), item.id).toEqual(
      normalized(parseFragment(serialize(front))),
    );
    expect(normalized(parseFragment(`${fields.front}<hr>${fields.back}`)), item.id).toEqual(
      normalized(parseFragment(serialize(revealed))),
    );
  }
});

it.each(["en", "fa"])(
  "AC-D46 labels AI recognition notes and exported card backs in %s without changing class or legacy faces",
  (language) => {
    const model = referenceStudyModel();
    model.language.explanation = language;
    const item = model.learningItems.find((entry) => entry.study?.set === "recognition");
    if (item?.study?.set !== "recognition") throw new Error("Missing recognition fixture");
    item.study.spoken = false;
    item.claim = {
      ...item.claim,
      origin: "ai_expansion",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
    };
    const label = studyMessage(language, "aiExpansion").text;
    const recognitionRow = (document: Node): Element => {
      const row = elements(byId(document, "extra"), "tr").find((candidate) =>
        elements(candidate, "b").some((entry) => serialize(entry) === item.study?.en),
      );
      if (!row) throw new Error("Missing recognition table row");
      return row;
    };
    const notes = parse(renderClassNotesHtml(model));
    expect(serialize(recognitionRow(notes))).toContain(label);
    item.study.spoken = true;
    expect(serialize(byId(parse(renderClassNotesHtml(model)), item.id))).toContain(label);
    item.study.spoken = false;
    const ai = renderStudyCard(item, language);
    expect(ai.back).toContain(label);
    expect(ai.front).not.toContain(label);
    expect(safeCardHtml(ai.back)).toBe(ai.back);
    const exported = buildStudyAnkiText(
      [{ ...ai, contentFormat: "lesson_html", studySet: "recognition" }],
      { set: "recognition", deckName: "Synthetic recognition" },
    );
    expect(exported).toContain(label);
    expect(exported).not.toContain("&lt;div");
    const { claim: _, ...legacy } = item;
    const legacyFaces = renderStudyCard(legacy, language);
    item.claim = { ...item.claim, origin: "from_class", evidence: "material" };
    expect(renderStudyCard(item, language)).toEqual(legacyFaces);
    expect(serialize(recognitionRow(parse(renderClassNotesHtml(model))))).not.toContain(label);
  },
);

it.each([
  ["fa", 'dir="ltr"'],
  ["ja", 'dir="ltr" lang="en"'],
] as const)(
  "AC-D46-04 shows the words a grammar IPA transcribes beside it in %s notes and card faces",
  (language, english) => {
    const model = referenceStudyModel();
    model.language.explanation = language;
    const item = model.learningItems[0];
    if (item?.study?.set !== "production") throw new Error("Missing production fixture");
    const { gapSentence: _gap, ...study } = item.study;
    item.kind = "grammar";
    item.study = {
      ...study,
      en: "present simple questions",
      kind: "grammar",
      ipa: "/dʌz ʃi wɔːk/",
      ipaText: "Does she walk",
      taskFa: "جمله را سؤالی کن:",
      prompt: "She walks to school every day.",
      fullSentence: "Does she walk to school every day?",
    };
    const { ipaText: _ipaText, ...legacyStudy } = item.study;
    const legacyItem = { ...item, study: legacyStudy };
    const legacy = { ...model, learningItems: [legacyItem, ...model.learningItems.slice(1)] };
    const transcribed = `Does she walk <bdi ${english} class="ipa">/dʌz ʃi wɔːk/</bdi>`;
    const notes = parse(renderClassNotesHtml(model));
    const entry = serialize(byId(notes, item.id));
    expect(entry).toContain(`<p class="pron">🔊 <bdi ${english}>${transcribed}</bdi>`);
    // The pattern label stays the heading; it is not what the IPA transcribes.
    expect(entry).toContain(`<span ${english} class="en">present simple questions</span>`);
    const appendix = serialize(byId(notes, "pron"));
    expect(appendix).toContain(`<td ${english}>${transcribed}</td>`);
    // Older revisions without the words keep their exact IPA rendering.
    const legacyNotes = parse(renderClassNotesHtml(legacy));
    expect(serialize(byId(legacyNotes, item.id))).toContain(
      `<p class="pron">🔊 <bdi ${english} class="ipa">/dʌz ʃi wɔːk/</bdi>`,
    );
    expect(serialize(byId(legacyNotes, "pron"))).toContain(
      `<td ${english} class="ipa">/dʌz ʃi wɔːk/</td>`,
    );
    expect(serialize(byId(legacyNotes, "pron"))).not.toContain("Does she walk");
    // A grammar task card shows no IPA; a card face that shows one names its words too.
    const task = renderStudyCard(item, language);
    expect(task).toEqual(renderStudyCard(legacyItem, language));
    const { taskFa: _task, ...untasked } = item.study;
    const face = renderStudyCard({ ...item, study: untasked }, language);
    expect(face.back).toContain('Does she walk <span class="ipa">/dʌz ʃi wɔːk/</span>');
    expect(safeCardHtml(face.back)).toBe(face.back);
  },
);

it.each([
  ["en", "Use the base form **like** after don't; the quoted example is incorrect.", "ltr"],
  ["fa", "بعد از don't فعل **like** می‌آید؛ جملهٔ نقل‌شده نادرست است.", "rtl"],
] as const)(
  "shows escaped recognition correction context below its meaning in %s notes",
  (language, explanation, direction) => {
    const model = referenceStudyModel();
    model.language.explanation = language;
    const item = model.learningItems.find((entry) => entry.study?.set === "recognition");
    if (item?.study?.set !== "recognition") throw new Error("Missing recognition fixture");
    item.study.spoken = false;
    item.study.example = "I don't likes coffee.";
    item.study.noteFa = `${explanation} <img src=x onerror="alert(1)"><script>alert(1)</script>&`;
    item.claim = { ...item.claim, origin: "ai_expansion", evidence: "ai", sourceRefs: [] };
    const document = parse(renderClassNotesHtml(model));
    const row = elements(byId(document, "extra"), "tr").find((candidate) =>
      elements(candidate, "b").some((entry) => serialize(entry) === item.study?.en),
    );
    if (!row) throw new Error("Missing recognition row");
    const cells = elements(row, "td");
    expect(cells).toHaveLength(3);
    const meaning = cells[1];
    if (!meaning) throw new Error("Missing recognition meaning");
    const paragraphs = elements(meaning, "p");
    expect(paragraphs).toHaveLength(2);
    const correction = paragraphs[0];
    if (!correction) throw new Error("Missing recognition correction");
    expect(attribute(correction, "dir")).toBe(direction);
    if (language === "en") expect(attribute(correction, "lang")).toBe("en");
    expect(serialize(correction)).toContain("📝");
    expect(
      elements(correction, "b")
        .map((entry) => serialize(entry))
        .join(""),
    ).toContain("like");
    if (language === "fa")
      expect(
        elements(correction, "bdi")
          .map((entry) => serialize(entry))
          .join(""),
      ).toContain("don't");
    expect(serialize(correction)).toContain("&lt;");
    expect(serialize(correction)).toContain("&amp;");
    expect(
      elements(row).some((node) => ["img", "script", "iframe", "object"].includes(node.tagName)),
    ).toBe(false);
    expect(
      elements(row)
        .flatMap((node) => node.attrs)
        .some((attr) => attr.name.startsWith("on")),
    ).toBe(false);
    expect(serialize(paragraphs[1] as Element)).toContain(
      studyMessage(language, "aiExpansion").text,
    );
    expect(serialize(cells[2] as Element)).toContain("I don't likes coffee.");
  },
);

it("leaves recognition rows without explanatory notes unchanged", () => {
  const model = referenceStudyModel();
  const item = model.learningItems.find((entry) => entry.study?.set === "recognition");
  if (item?.study?.set !== "recognition") throw new Error("Missing recognition fixture");
  item.study.spoken = false;
  item.claim = { ...item.claim, origin: "from_class", evidence: "material" };
  delete item.study.noteFa;
  const withoutNote = renderClassNotesHtml(model);
  item.study.noteFa = "";
  expect(renderClassNotesHtml(model)).toBe(withoutNote);
});

it("omits empty sections and pills, renumbers headings, and keeps all jumps inside the document", () => {
  const model = referenceStudyModel();
  if (!model.classNotes) throw new Error("fixture");
  model.classNotes.chunks = [];
  model.classNotes.board = [];
  model.classNotes.tasks = [];
  model.classNotes.gapfill = [];
  model.classNotes.register = [];
  delete model.classNotes.mistakes;
  model.learningItems = model.learningItems.filter((item) => item.study?.set === "production");
  const html = renderClassNotesHtml(model);
  const document = parse(html);
  expect(elements(document, "section").map((node) => attribute(node, "id"))).toEqual([
    "core",
    "pron",
    "check",
  ]);
  expect(html).toContain("<h2>۲. پیوست تلفظ");
  expect(html).toContain("دوشنبه");
  const ids = new Set(elements(document).map((node) => attribute(node, "id")));
  for (const link of elements(document, "a")) {
    const href = attribute(link, "href");
    expect(href).toMatch(/^#/);
    expect(ids.has(decodeURIComponent(href?.slice(1) ?? ""))).toBe(true);
  }
  for (const table of elements(document, "table"))
    expect(attribute(table.parentNode as Element, "class")).toBe("tw");
});

it.each(["verified", "unverified", "no_audio"] as const)(
  "never accepts model-owned %s as voice confirmation or leaks speech via aggregates",
  (speechStatus) => {
    const model = referenceStudyModel();
    const mistakes = model.classNotes?.mistakes;
    if (!mistakes) throw new Error("fixture");
    mistakes.speechStatus = speechStatus;
    mistakes.patterns = [
      {
        labelFa: "الگوی خطرناک",
        count: 3,
        examples: [
          "The quality was really disappointed. → The quality was really disappointing.",
          "responsible about → responsible for",
        ],
        ruleFa: "فقط نمونه‌های معتبر",
      },
    ];
    const html = renderClassNotesHtml(model);
    expect(html).not.toContain("The quality was really");
    expect(html).not.toContain("responsible about");
    expect(html).not.toContain("الگوی خطرناک");
    expect(html).not.toContain("گفتاری (از صدای کلاس)");
    expect(html).toContain('href="#pressed-time">کارت ۳');
    if (speechStatus !== "no_audio") expect(html).toContain(WITHHELD_SPEECH_NOTE);
  },
);

it("derives recurring pattern counts from distinct written evidence and ignores a forged aggregate count", () => {
  const model = referenceStudyModel();
  const mistakes = model.classNotes?.mistakes;
  if (!mistakes) throw new Error("fixture");
  const examples = mistakes.items
    .filter((item) => item.source === "handwriting")
    .slice(0, 2)
    .map((item) => `${item.said} → ${item.correct}`);
  mistakes.patterns = [
    {
      labelFa: "دو نمونه‌ی نوشتاری",
      count: 14,
      examples: [...examples, examples[0] ?? "", "responsible about → responsible for"],
      ruleFa: "نمونه‌های نوشتاری را مرور کن.",
    },
  ];
  const html = renderClassNotesHtml(model);
  expect(html).toContain("دو نمونه‌ی نوشتاری · ۲ بار");
  expect(html).not.toContain("۱۴ بار");
  expect(html).not.toContain("responsible about");
});

it("escapes hostile payloads in every rendered context and keeps card fronts free of hidden answer metadata", () => {
  const model = referenceStudyModel();
  const first = model.learningItems[0];
  if (first?.study?.set !== "production" || !model.classNotes) throw new Error("fixture");
  const original = renderStudyCard(first);
  expect(original.front).not.toContain(first.study.en);
  expect(original.front).not.toMatch(/title=|alt=/);
  const poison = '<img src=x onerror="alert(1)"><script>alert(1)</script>&';
  first.id = '" onclick="alert(1)';
  first.study.en = poison;
  first.study.faMeaning = `متن **${poison}**`;
  first.study.ipa = poison;
  first.study.fullSentence = poison;
  first.study.gapSentence = `______ ${poison}`;
  model.title = poison;
  model.classNotes.sourceNote = poison;
  model.classNotes.tasks = [
    {
      title: poison,
      blocks: [
        { type: "quote", quoteEn: poison },
        { type: "table", headers: [poison], rows: [[poison]] },
      ],
    },
  ];
  const html = renderClassNotesHtml(model);
  const faces = renderStudyCard(first);
  for (const output of [html, faces.front, faces.back]) {
    const document = parse(output);
    expect(
      elements(document).some((node) =>
        ["script", "img", "iframe", "form", "object"].includes(node.tagName),
      ),
    ).toBe(false);
    expect(
      elements(document)
        .flatMap((node) => node.attrs)
        .some((attr) => attr.name.startsWith("on")),
    ).toBe(false);
    expect(output).toContain("&lt;");
  }
});

it("keeps edited legacy items readable alongside structured notes without reusing stale fields", () => {
  const model = referenceStudyModel();
  const first = model.learningItems[0];
  if (!first) throw new Error("fixture");
  delete first.study;
  first.front = "Edited <front>";
  first.back = "Edited answer\nsecond line";
  const html = renderClassNotesHtml(model);
  expect(html).toContain('id="edited"');
  expect(html).toContain("Edited &lt;front&gt;");
  expect(html).toContain('href="#core">۲ کارت اصلی');
  expect(
    elements(byId(parse(html), "core"), "article").map((node) => attribute(node, "id")),
  ).not.toContain(first.id);
  expect(renderStudyCard(first)).toEqual({
    front: '<div dir="auto">Edited &lt;front&gt;</div>',
    back: '<div dir="auto">Edited answer<br>second line</div>',
  });
});

it("preserves summary, topic explanations, homework and uncertainty with source labels in rich models", () => {
  const model = referenceStudyModel();
  const original = model.learningItems[0]?.claim;
  if (!original) throw new Error("fixture");
  model.summary = [{ ...original, id: "summary", text: "خلاصه‌ی کامل **درس**" }];
  model.topics = [
    {
      id: "topic",
      title: "Topic <script>",
      claims: [{ ...original, id: "topic-claim", text: "توضیح موضوع", origin: "from_class" }],
    },
  ];
  model.homework = [{ ...original, id: "homework", text: "برای جلسه‌ی بعد سه جمله بنویس." }];
  model.uncertainties = [
    { ...original, id: "uncertainty", text: "بخش صوت واضح نبود <img src=x>", uncertain: true },
  ];
  const document = parse(renderClassNotesHtml(model));
  const section = byId(document, "lesson-notes");
  const html = serialize(section);
  expect(html).toContain("خلاصه‌ی کامل <b>درس</b>");
  expect(html).toContain("توضیح موضوع");
  expect(html).toContain("برای جلسه‌ی بعد سه جمله بنویس.");
  expect(html).toContain("بخش صوت واضح نبود");
  expect(html).toContain("از کلاس");
  expect(html).toContain("توضیح افزوده‌ی هوش مصنوعی");
  expect(html).toContain("نیاز به بررسی");
  expect(elements(section).some((node) => ["script", "img"].includes(node.tagName))).toBe(false);
  expect(elements(document, "section").at(-1)).toBe(section);
  expect(elements(document, "a").some((node) => attribute(node, "href") === "#lesson-notes")).toBe(
    true,
  );
});

it("D49 asks each core item's flashcard question with a hidden, linked answer and no repeated gap", () => {
  const model = referenceStudyModel();
  if (!model.classNotes) throw new Error("fixture");
  const production = model.learningItems.filter((item) => item.study?.set === "production");
  const first = production[0];
  if (first?.study?.set !== "production" || !first.study.gapSentence) throw new Error("fixture");
  // The gap-fill section already asks this exact sentence; the check must not ask it twice.
  model.classNotes.gapfill = [{ sentence: first.study.gapSentence, answer: "wear and tear" }];
  const html = renderClassNotesHtml(model);
  const document = parse(html);
  const check = byId(document, "check");
  const list = elements(check, "ol").find((node) => attribute(node, "class") === "gaps");
  if (!list) throw new Error("Missing check list");
  const blocks = elements(list, "li");
  expect(blocks.length).toBe(production.length - 1);
  // Print hides toggles inside ol.gaps and shows the key instead (verbatim reference stylesheet).
  expect(CLASS_NOTES_STYLES).toContain("ol.gaps details{display:none}");
  expect(serialize(check)).not.toContain(
    first.study.gapSentence.replace("______", "<b>______</b>"),
  );
  const kitOut = production.find((item) => item.id === "kit-out");
  if (kitOut?.study?.set !== "production") throw new Error("fixture");
  const block = blocks.find((node) => serialize(node).includes("we need to <b>______</b> it"));
  if (!block) throw new Error("Missing separable question");
  // The visible question is the card front's meaning and gap; the answer sits inside <details>.
  const card = renderStudyCard(kitOut);
  const visible = elements(block).filter(
    (node) => node.tagName === "p" && node.parentNode === block,
  );
  expect(visible.map((node) => serialize(node)).join(" ")).not.toContain("kit it out");
  expect(card.front).toContain("we need to <b>______</b> it <b>______</b>.");
  const details = elements(block, "details")[0];
  if (!details) throw new Error("Missing hidden answer");
  expect(serialize(details)).toContain("need to <b>kit</b> it <b>out</b>.");
  const back = elements(details, "a")[0];
  expect(attribute(back as Element, "href")).toBe("#kit-out");
  // Print shows answers; the screen keeps them hidden behind the toggle (.key is display:none).
  const key = elements(check, "p").find((node) => attribute(node, "class") === "key");
  expect(serialize(key as Element)).toContain("kit it out");
  expect(CLASS_NOTES_STYLES).toContain(".key{display:none}");
});

it("D49 check-yourself uses grammar tasks, a numbered list and English chrome outside Persian", () => {
  const model = referenceStudyModel();
  model.language.explanation = "en";
  const item = model.learningItems.find((entry) => entry.id === "pressed-time");
  if (item?.study?.set !== "production") throw new Error("fixture");
  item.study = {
    ...item.study,
    kind: "grammar",
    taskFa: "Rewrite the sentence with the correct preposition.",
    prompt: "I have been pressed by time all week.",
    fullSentence: "I have been pressed for time all week.",
  };
  const check = byId(parse(renderClassNotesHtml(model)), "check");
  const text = serialize(check);
  expect(text).toContain(studyMessage("en", "checkNote").text);
  expect(text).toContain("Rewrite the sentence with the correct preposition.");
  expect(text).toMatch(
    /<li><p class="mean">[^<]*<\/p><p class="q"[^>]*>I have been pressed by time all week\./,
  );
  expect(text).toMatch(/<p class="key">[\s\S]*\b1\. /);
  expect(text).not.toMatch(/<p class="q"[^>]*>[^<]*pressed for time/);
  for (const language of ["fa", "ja"]) {
    expect(studyMessage(language, "checkHeading").language).toBe(language === "fa" ? "fa" : "en");
  }
});
