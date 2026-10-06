import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type DefaultTreeAdapterMap, parse, parseFragment, serialize } from "parse5";
import { expect, it } from "vitest";
import { referenceStudyModel } from "../../test/reference-study-fixture";
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

it("copies the reference stylesheet verbatim and reproduces reference sections from structured items", () => {
  expect(CLASS_NOTES_STYLES).toBe(/<style>([\s\S]*?)<\/style>/.exec(notesReference)?.[1]);
  const actual = parse(renderClassNotesHtml(referenceStudyModel()));
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
    const fields = renderStudyCard(item);
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
