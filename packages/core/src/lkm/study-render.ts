import {
  escapeStudyAttribute as attr,
  renderStudyEnglish as en,
  renderMixedPersian as fa,
  escapeStudyText as text,
} from "./mixed-text";
import type { Claim, KnowledgeModel, LearningItem } from "./schema";
import type { ClassNotes, StudyContent, TaskGroup } from "./study-schema";
import { CLASS_NOTES_STYLES } from "./study-styles";

export { renderMixedPersian } from "./mixed-text";
export { CLASS_NOTES_STYLES } from "./study-styles";

export const WITHHELD_SPEECH_NOTE =
  "🎙️ اشتباهات گفتاری این جلسه نمایش داده نشده، چون هنوز تأیید نشده کدام صدا مال توست. در اپ صدایت را تأیید کن تا اضافه شود.";
const PRONUNCIATION_NOTE =
  "تقریب فارسی فقط عصاست؛ ملاک IPA است، چون خط فارسی برای /æ/، /ə/ و /ɜː/ حرفی ندارد.";
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&amp;family=Vazirmatn:wght@400;600;800&amp;display=swap" rel="stylesheet">';
const BACK_TO_TOP = '<a class="top" href="#top">↑ بالا</a>';

function persianNumber(value: number): string {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)] ?? digit);
}

function gap(value: string): string {
  return text(value).replaceAll("______", "<b>______</b>");
}

function note(value: string | undefined): string {
  return value ? `<p class="note">${fa(value)}</p>` : "";
}

/** The same two fields are consumed by the application and the Anki text export. */
export function renderStudyCard(item: Pick<LearningItem, "study" | "front" | "back">): {
  front: string;
  back: string;
} {
  const value = item.study;
  if (!value)
    return {
      front: `<div dir="auto">${text(item.front).replace(/\r?\n/g, "<br>")}</div>`,
      back: `<div dir="auto">${text(item.back).replace(/\r?\n/g, "<br>")}</div>`,
    };
  if (value.set === "recognition")
    return {
      front: `<div dir="ltr"><b>${text(value.en)}</b><br><br><i>${text(value.example)}</i></div>`,
      back: `<div dir="rtl" style="font-size:1.1em">${fa(value.faMeaning)}</div>${value.ipa ? `<br><div dir="ltr"><span class="ipa">${text(value.ipa)}</span></div>` : ""}${value.noteFa ? `<br><div dir="rtl">📝 ${fa(value.noteFa)}</div>` : ""}`,
    };
  if (value.kind === "grammar" && value.taskFa && value.prompt)
    return {
      front: `<div dir="rtl" style="font-size:1.1em">${fa(value.taskFa)}</div><br><div dir="ltr">${text(value.prompt)}</div>`,
      back: `<div dir="ltr"><b style="font-size:1.25em">${text(value.fullSentence)}</b></div>${value.noteFa ? `<br><div dir="rtl">📝 ${fa(value.noteFa)}</div>` : ""}`,
    };
  const english = [
    `<b style="font-size:1.25em">${text(value.en)}</b>${value.ipa ? `<br><span class="ipa">${text(value.ipa)}</span>` : ""}`,
    value.fullSentence ? `<i>${text(value.fullSentence)}</i>` : "",
    value.collocations.length
      ? `<b>Collocations:</b> ${value.collocations.map(text).join(" · ")}`
      : "",
  ]
    .filter(Boolean)
    .join("<br><br>");
  const persian = [
    value.faApprox || value.trap
      ? [value.faApprox ? `🔊 ${fa(value.faApprox)}` : "", value.trap ? `⚠️ ${fa(value.trap)}` : ""]
          .filter(Boolean)
          .join(" — ")
      : "",
    value.noteFa ? `📝 ${fa(value.noteFa)}` : "",
    value.imageFa ? `🖼️ ${fa(value.imageFa)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
  return {
    front: `<div dir="rtl" style="font-size:1.1em">${fa(value.faMeaning)}</div><br><div dir="ltr">${gap(value.gapSentence ?? "")}</div>`,
    back: `<div dir="ltr">${english}</div>${persian ? `<br><div dir="rtl">${persian}</div>` : ""}`,
  };
}

function pronunciation(value: StudyContent): string {
  const parts = [
    value.ipa ? `<bdi dir="ltr" class="ipa">${text(value.ipa)}</bdi>` : "",
    value.faApprox ? fa(value.faApprox) : "",
    value.trap ? `<span dir="rtl" class="trap">⚠️ ${fa(value.trap)}</span>` : "",
  ].filter(Boolean);
  return parts.length ? `<p class="pron">🔊 ${parts.join(" · ")}</p>` : "";
}

function entry(item: LearningItem, index?: number): string {
  const value = item.study;
  if (!value) return "";
  const production = value.set === "production";
  const example = production ? value.fullSentence : value.example;
  return `<article class="entry" id="${attr(item.id)}">\n<h3>${index !== undefined ? `<span class="n">${index + 1}</span>` : ""}<span dir="ltr" class="en">${text(value.en)}</span></h3>\n${pronunciation(value)}\n${value.faMeaning ? `<p class="mean">${fa(value.faMeaning)}</p>` : ""}\n${example ? `<p class="ex" dir="ltr">${text(example)}</p>` : ""}\n${production && value.collocations.length ? `<p class="col" dir="ltr"><b>Collocations:</b> ${value.collocations.map(text).join(" · ")}</p>` : ""}\n${value.noteFa ? `<p>📝 ${fa(value.noteFa)}</p>` : ""}\n${production && value.imageFa ? `<p class="img">🖼️ ${fa(value.imageFa)}</p>` : ""}\n${production && value.sourceFa ? `<p class="src">منبع: ${fa(value.sourceFa)}</p>` : ""}\n</article>`;
}

function table(headers: readonly string[], rows: readonly string[][]): string {
  return `<div class="tw"><table>\n<tr>${headers.map((header) => `<th>${fa(header)}</th>`).join("")}</tr>\n${rows.map((row) => `<tr>${row.join("")}</tr>`).join("\n")}\n</table></div>`;
}

function taskGroups(groups: readonly TaskGroup[]): string {
  return groups
    .filter((group) => group.blocks.length)
    .map(
      (group) =>
        `<h3>${fa(group.title)}</h3>\n${group.blocks
          .map((block) => {
            if (block.type === "text") return `<p>${fa(block.textFa)}</p>`;
            if (block.type === "quote") return `<p class="ex" dir="ltr">${en(block.quoteEn)}</p>`;
            if (block.type === "table")
              return table(
                block.headers,
                block.rows.map((row) =>
                  row.map((cell) =>
                    /\p{Script=Arabic}/u.test(cell)
                      ? `<td>${fa(cell)}</td>`
                      : `<td dir="ltr">${en(cell)}</td>`,
                  ),
                ),
              );
            return block.items
              .map(
                (item, index) =>
                  `<div class="sc">\n<p class="q" dir="ltr"><b>${index + 1}.</b> ${en(item.prompt)}</p>\n${item.learnerAnswer ? `<p class="yours" dir="ltr">✗ ${en(item.learnerAnswer)}</p>\n` : ""}<p class="model" dir="ltr">✓ ${en(item.model)}</p>\n${item.whyFa ? `<p class="why">${fa(item.whyFa)}</p>\n` : ""}</div>`,
              )
              .join("\n");
          })
          .join("\n")}`,
    )
    .join("\n");
}

/** Preserve supported notebook content that is not represented by a reference section. */
function additionalLessonNotes(model: KnowledgeModel): string {
  const claim = (value: Claim) => {
    const labels = [
      value.origin === "from_class" ? "از کلاس" : "توضیح افزوده‌ی هوش مصنوعی",
      value.uncertain ? "نیاز به بررسی" : "",
      ...value.sourceRefs.map((ref) => {
        if (ref.locator.kind === "page") return `صفحه ${ref.locator.page}`;
        if (ref.locator.kind === "time")
          return `صوت: ${(ref.locator.startMs / 1000).toFixed(1)}–${(ref.locator.endMs / 1000).toFixed(1)} ثانیه`;
        return `بخش متن: ${ref.locator.start}–${ref.locator.end}`;
      }),
    ].filter(Boolean);
    return `<article class="entry"><p>${fa(value.text).replace(/\r?\n/g, "<br>")}</p><p class="src">${labels.map(fa).join(" · ")}</p></article>`;
  };
  return [
    model.summary.length ? `<h3>خلاصه‌ی کلاس</h3>${model.summary.map(claim).join("\n")}` : "",
    model.topics.length
      ? `<h3>موضوع‌ها</h3>${model.topics.map((topic) => `<h4>${fa(topic.title)}</h4>${topic.claims.map(claim).join("\n")}`).join("\n")}`
      : "",
    model.homework.length ? `<h3>تکلیف</h3>${model.homework.map(claim).join("\n")}` : "",
    model.uncertainties.length
      ? `<h3>موارد نیازمند بررسی</h3>${model.uncertainties.map(claim).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const MISTAKE_KINDS = {
  grammar: "گرامر",
  "word-choice": "انتخاب واژه",
  collocation: "collocation",
  preposition: "حرف اضافه",
  "word-order": "ترتیب کلمات",
  pronunciation: "تلفظ",
  spelling: "املا",
  register: "لحن",
} as const;

function mistakesContent(notes: ClassNotes, core: readonly LearningItem[]): string {
  const mistakes = notes.mistakes;
  if (!mistakes) return "";
  // Provider fields alone do not authorize speech: the server adds evidence on each owned read.
  const written = mistakes.items.filter((item) => item.source === "handwriting");
  const spoken =
    mistakes.speechStatus === "verified"
      ? mistakes.items.filter(
          (item) =>
            item.source === "speech" &&
            item.voiceEvidence &&
            item.voiceEvidence.endMs - item.voiceEvidence.startMs >= 2000,
        )
      : [];
  // A model's aggregate count cannot authorize a speech-derived example. Require two
  // distinct, exact authorized correction pairs and derive the visible count from them.
  const normalizePair = (value: string) => value.replaceAll("**", "").trim();
  const visiblePairs = new Set(
    [...written, ...spoken].map((item) => normalizePair(`${item.said} → ${item.correct}`)),
  );
  const patterns = mistakes.patterns
    .map((pattern) => ({
      ...pattern,
      examples: [...new Set(pattern.examples.map(normalizePair))].filter((example) =>
        visiblePairs.has(example),
      ),
    }))
    .filter((pattern) => pattern.examples.length >= 2);
  const patternHtml = patterns.length
    ? `<h3>الگوهای تکراری</h3>\n${patterns.map((pattern) => `<div class="sc">\n<p class="mean">${fa(pattern.labelFa)} · ${persianNumber(pattern.examples.length)} بار</p>\n<p dir="ltr">${pattern.examples.map(en).join("<br>")}</p>\n<p class="why">${fa(pattern.ruleFa)}</p>\n</div>`).join("\n")}`
    : "";
  const rows = written.map((item) => {
    const linkedIndex = core.findIndex((candidate) => candidate.id === item.itemId);
    const source = [
      `✍️ ${fa(MISTAKE_KINDS[item.kind])}`,
      item.teacherCorrected ? "اصلاح معلم" : "",
      item.where ? fa(item.where) : "",
      linkedIndex >= 0 && item.itemId
        ? `<a href="#${attr(encodeURIComponent(item.itemId))}">کارت ${persianNumber(linkedIndex + 1)}</a>`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `<div class="sc">\n<p class="yours" dir="ltr">✗ ${en(item.said)}</p>\n<p class="model" dir="ltr">✓ ${en(item.correct)}</p>\n<p class="why">${fa(item.whyFa)}</p>\n<p class="src">${source}</p>\n</div>`;
  });
  const speechRows = spoken.map(
    (item) =>
      `<div class="sc">\n<p class="yours" dir="ltr">✗ ${en(item.said)}</p>\n<p class="model" dir="ltr">✓ ${en(item.correct)}</p>\n<p class="why">${fa(item.whyFa)}</p>\n<p class="src">🎙️ ${fa(MISTAKE_KINDS[item.kind])} · ${fa(item.where ?? "صدای تأییدشدهٔ تو")}</p>\n</div>`,
  );
  const withheld =
    mistakes.speechStatus === "unverified" || mistakes.pendingSpeech
      ? note(WITHHELD_SPEECH_NOTE)
      : "";
  // Legacy/model-written 'verified' without server evidence still fails closed.
  const untrustedVerified =
    mistakes.speechStatus === "verified" &&
    !spoken.length &&
    mistakes.items.some((item) => item.source === "speech" && !item.voiceEvidence);
  return `${withheld}${untrustedVerified ? note(WITHHELD_SPEECH_NOTE) : ""}${mistakes.speechStatus === "no_audio" ? note(mistakes.noteFa) : ""}${patternHtml}${speechRows.length ? `<h3>گفتاری (از صدای تأییدشدهٔ تو)</h3>\n${speechRows.join("\n")}` : ""}${rows.length ? `<h3>نوشتاری (از دست‌خط تو)</h3>\n${rows.join("\n")}` : ""}`;
}

/** A passive, standalone document. The app adds only its frame base and theme. */
export function renderClassNotesHtml(model: KnowledgeModel): string {
  const notes = model.classNotes;
  const items = model.learningItems.filter((item) => item.study);
  const core = items.filter((item) => item.study?.set === "production");
  const supplementary = items.filter((item) => item.study?.set === "recognition");
  const oral = supplementary.filter(
    (item) => item.study?.set === "recognition" && item.study.spoken,
  );
  const extra = supplementary.filter(
    (item) => item.study?.set === "recognition" && !item.study.spoken,
  );
  const appendix = [...core, ...supplementary].filter((item) => item.study?.ipa);
  const sections: { id: string; pill: string; heading: string; body: string }[] = [];
  function add(id: string, pill: string, heading: string, body: string): void {
    if (body) sections.push({ id, pill, heading, body });
  }
  if (core.length)
    add(
      "core",
      `${persianNumber(core.length)} کارت اصلی`,
      "کارت‌های اصلی (production)",
      `${note(notes?.coreIntro)}${core.map((item, index) => entry(item, index)).join("\n")}`,
    );
  if (oral.length)
    add(
      "oral",
      "نکته‌های شفاهی معلم",
      "چیزهایی که معلم شفاهی توضیح داد",
      `${note(notes?.oralIntro)}${oral.map((item) => entry(item)).join("\n")}`,
    );
  if (notes) {
    add(
      "chunks",
      "چانک‌های خط‌کشیده",
      "چانک‌های خط‌کشیده + الگوی استفاده",
      `${
        notes.chunks.length
          ? table(
              ["الگو", "جمله‌ی کلاس", "نکته"],
              notes.chunks.map((chunk) => [
                `<td dir="ltr"><b>${text(chunk.pattern)}</b></td>`,
                `<td dir="ltr"><i>${text(chunk.classSentence)}</i></td>`,
                `<td>${fa(chunk.noteFa)}</td>`,
              ]),
            )
          : ""
      }${notes.board.length ? `<p>روی تخته همچنین:</p>\n<ul dir="ltr">\n${notes.board.map((line) => `<li><b>${text(line)}</b></li>`).join("\n")}\n</ul>` : ""}`,
    );
    add("tasks", "جواب تمرین‌ها", "جواب تمرین‌ها", taskGroups(notes.tasks));
    add("mistakes", "اشتباهات تو", "اشتباهات تو", mistakesContent(notes, core));
  }
  if (extra.length)
    add(
      "extra",
      "بقیه‌ی عبارت‌ها",
      "بقیه‌ی عبارت‌ها (recognition)",
      table(
        ["English", "معنی", "مثال"],
        extra.flatMap((item) =>
          item.study?.set === "recognition"
            ? [
                [
                  `<td dir="ltr"><b>${text(item.study.en)}</b></td>`,
                  `<td>${fa(item.study.faMeaning)}</td>`,
                  `<td dir="ltr"><i>${text(item.study.example)}</i></td>`,
                ],
              ]
            : [],
        ),
      ),
    );
  if (notes) {
    if (notes.register.length)
      add(
        "register",
        "این را بگو/آن را نه",
        "این را بگو — آن را نه",
        table(
          ["✗ نه این", "✓ این", "چرا"],
          notes.register.map((item) => [
            `<td dir="ltr" class="bad">${en(item.notThis)}</td>`,
            `<td dir="ltr" class="good">${en(item.sayThis)}</td>`,
            `<td>${fa(item.whyFa)}</td>`,
          ]),
        ),
      );
    if (notes.gapfill.length)
      add(
        "gap",
        "جای خالی",
        "جای خالی (با جواب پنهان)",
        `<ol class="gaps" dir="ltr">\n${notes.gapfill.map((item) => `<li>${gap(item.sentence)}<details><summary>جواب</summary><b>${text(item.answer)}</b>${item.whyFa ? ` — <span class="why" dir="rtl">${fa(item.whyFa)}</span>` : ""}</details></li>`).join("\n")}\n</ol>\n<p class="key">پاسخ‌ها: <bdi dir="ltr">${notes.gapfill.map((item, index) => `${index + 1}. ${text(item.answer)}`).join(" · ")}</bdi></p>`,
      );
    add("culture", "فرهنگ", "فرهنگ و زندگی در بریتانیا", taskGroups(notes.culture ?? []));
  }
  if (appendix.length)
    add(
      "pron",
      "تلفظ",
      "پیوست تلفظ (British IPA)",
      `${note(PRONUNCIATION_NOTE)}${table(
        ["عبارت", "IPA", "تقریب فارسی", "تله"],
        appendix.flatMap((item) =>
          item.study
            ? [
                [
                  `<td dir="ltr"><b>${text(item.study.en)}</b></td>`,
                  `<td dir="ltr" class="ipa">${text(item.study.ipa ?? "")}</td>`,
                  `<td>${fa(item.study.faApprox ?? "")}</td>`,
                  `<td>${fa(item.study.trap ?? "")}</td>`,
                ],
              ]
            : [],
        ),
      )}`,
    );
  const plainItems = model.learningItems.filter((item) => !item.study);
  if (plainItems.length)
    add(
      "edited",
      "یادداشت‌های ویرایش‌شده",
      "یادداشت‌های ویرایش‌شده",
      `${note("این موارد با متن فعلی تو نمایش داده می‌شوند؛ قالب ساختاریافته‌ی قبلی آن‌ها پس از ویرایش کنار گذاشته شده است.")}${plainItems.map((item) => `<article class="entry" id="${attr(item.id)}"><h3 dir="auto">${text(item.front)}</h3><p dir="auto">${text(item.back).replace(/\r?\n/g, "<br>")}</p></article>`).join("\n")}`,
    );
  add(
    "lesson-notes",
    "یادداشت‌های تکمیلی کلاس",
    "یادداشت‌های تکمیلی کلاس",
    additionalLessonNotes(model),
  );
  const date = notes?.date ?? "";
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : undefined;
  const weekday =
    parsedDate && Number.isFinite(parsedDate.getTime())
      ? ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"][
          parsedDate.getUTCDay()
        ]
      : "";
  const institution = [notes?.institution, notes?.course].filter(Boolean).join(" · ");
  return `<!doctype html>\n<html lang="fa" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${text(model.title)}${date ? ` · ${text(date)}` : ""}</title>\n${FONTS}\n<style>${CLASS_NOTES_STYLES}</style>\n</head>\n<body id="top">\n${sections.length ? `<nav>${sections.map((section) => `<a href="#${section.id}">${section.pill}</a>`).join("")}</nav>` : ""}\n<main>\n<header>\n<h1>${fa(model.title)}</h1>\n${institution || date ? `<p>${institution ? `${fa(institution)}${date ? " · " : ""}` : ""}${date ? `${weekday} <bdi dir="ltr" class="date">${text(date)}</bdi>` : ""}</p>` : ""}\n${notes?.coverage ? `<p>${fa(notes.coverage)}</p>` : ""}\n${note(notes?.sourceNote)}\n</header>\n${sections.map((section, index) => `<section id="${section.id}">\n<h2>${persianNumber(index + 1)}. ${fa(section.heading)}</h2>\n${section.body}\n${BACK_TO_TOP}\n</section>`).join("\n\n")}\n</main>\n</body>\n</html>`;
}
