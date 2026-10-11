import {
  escapeStudyAttribute as attr,
  renderStudyEnglish as en,
  renderMixedStudy,
  escapeStudyText as text,
} from "./mixed-text";
import type { Claim, KnowledgeModel, LearningItem } from "./schema";
import {
  resolveStudyLocale,
  type StudyLabelKey,
  type StudyLocale,
  studyMessage,
  studyNumber,
  studyWeekday,
} from "./study-locale";
import type { ClassNotes, StudyContent, TaskGroup } from "./study-schema";
import { CLASS_NOTES_STYLES, localizedStudyStyles } from "./study-styles";

export { renderMixedPersian } from "./mixed-text";
export { CLASS_NOTES_STYLES } from "./study-styles";

export const WITHHELD_SPEECH_NOTE =
  "🎙️ اشتباهات گفتاری این جلسه نمایش داده نشده، چون هنوز تأیید نشده کدام صدا مال توست. در اپ صدایت را تأیید کن تا اضافه شود.";
interface RenderContext {
  itemAnchors?: boolean;
  locale: StudyLocale;
  prose: (value: string) => string;
  label: (key: StudyLabelKey) => string;
  number: (value: number) => string;
  explanatoryAttrs: string;
  englishAttrs: string;
}
function context(language: string): RenderContext {
  const locale = resolveStudyLocale(language);
  const prose = (value: string) => renderMixedStudy(value, locale.direction, locale.isPersian);
  return {
    locale,
    prose,
    label: (key) => {
      const message = studyMessage(locale.language, key);
      const html = renderMixedStudy(
        message.text,
        resolveStudyLocale(message.language).direction,
        locale.isPersian,
      );
      return message.language !== locale.language && !locale.isPersian
        ? `<span lang="en" dir="ltr">${html}</span>`
        : html;
    },
    number: (value) => studyNumber(value, locale.language),
    englishAttrs: `dir="ltr"${locale.isPersian ? "" : ' lang="en"'}`,
    explanatoryAttrs:
      'dir="' +
      locale.direction +
      '"' +
      (locale.isPersian ? "" : ` lang="${attr(locale.language)}"`),
  };
}
function fonts(locale: StudyLocale): string {
  const families = locale.isPersian
    ? "Lora:ital,wght@0,400;0,600;1,400&amp;family=Vazirmatn:wght@400;600;800"
    : "Lora:ital,wght@0,400;0,600;1,400&amp;family=" +
      locale.fontGoogleFamily +
      ":wght@400;600;800";
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=' +
    families +
    '&amp;display=swap" rel="stylesheet">'
  );
}

function labelNote(key: StudyLabelKey, ctx: RenderContext): string {
  return `<p class="note">${ctx.label(key)}</p>`;
}

function gap(value: string): string {
  return text(value).replaceAll("______", "<b>______</b>");
}

function note(value: string | undefined, ctx: RenderContext): string {
  const prose = ctx.prose;
  return value ? `<p class="note">${prose(value)}</p>` : "";
}

/** The same two fields are consumed by the application and the Anki text export. */
export function renderStudyCard(
  item: Pick<LearningItem, "study" | "front" | "back"> & { claim?: Pick<Claim, "origin"> },
  explanationLanguage = "fa",
): {
  front: string;
  back: string;
} {
  const ctx = context(explanationLanguage);
  const prose = ctx.prose;
  const value = item.study;
  if (!value)
    return {
      front: `<div dir="auto">${text(item.front).replace(/\r?\n/g, "<br>")}</div>`,
      back: `<div dir="auto">${text(item.back).replace(/\r?\n/g, "<br>")}</div>`,
    };
  if (value.set === "recognition")
    return {
      front: `<div ${ctx.englishAttrs}><b>${text(value.en)}</b><br><br><i>${text(value.example)}</i></div>`,
      back: `<div ${ctx.explanatoryAttrs} style="font-size:1.1em">${prose(value.faMeaning)}</div>${value.ipa ? `<br><div ${ctx.englishAttrs}><span class="ipa">${text(value.ipa)}</span></div>` : ""}${value.noteFa ? `<br><div ${ctx.explanatoryAttrs}>📝 ${prose(value.noteFa)}</div>` : ""}${item.claim?.origin === "ai_expansion" ? `<br><div ${ctx.explanatoryAttrs}><b>${ctx.label("aiExpansion")}</b></div>` : ""}`,
    };
  if (value.kind === "grammar" && value.taskFa && value.prompt)
    return {
      front: `<div ${ctx.explanatoryAttrs} style="font-size:1.1em">${prose(value.taskFa)}</div><br><div ${ctx.englishAttrs}>${text(value.prompt)}</div>`,
      back: `<div ${ctx.englishAttrs}><b style="font-size:1.25em">${text(value.fullSentence)}</b></div>${value.noteFa ? `<br><div ${ctx.explanatoryAttrs}>📝 ${prose(value.noteFa)}</div>` : ""}`,
    };
  const english = [
    `<b style="font-size:1.25em">${text(value.en)}</b>${value.ipa ? `<br>${value.ipaText ? `${text(value.ipaText)} ` : ""}<span class="ipa">${text(value.ipa)}</span>` : ""}`,
    value.fullSentence ? `<i>${text(value.fullSentence)}</i>` : "",
    value.collocations.length
      ? `<b>Collocations:</b> ${value.collocations.map(text).join(" · ")}`
      : "",
  ]
    .filter(Boolean)
    .join("<br><br>");
  const explanation = [
    (ctx.locale.isPersian && value.faApprox) || value.trap
      ? [
          ctx.locale.isPersian && value.faApprox ? `🔊 ${prose(value.faApprox)}` : "",
          value.trap ? `⚠️ ${prose(value.trap)}` : "",
        ]
          .filter(Boolean)
          .join(" — ")
      : "",
    value.noteFa ? `📝 ${prose(value.noteFa)}` : "",
    value.imageFa ? `🖼️ ${prose(value.imageFa)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
  return {
    front: `<div ${ctx.explanatoryAttrs} style="font-size:1.1em">${prose(value.faMeaning)}</div><br><div ${ctx.englishAttrs}>${gap(value.gapSentence ?? "")}</div>`,
    back: `<div ${ctx.englishAttrs}>${english}</div>${explanation ? `<br><div ${ctx.explanatoryAttrs}>${explanation}</div>` : ""}`,
  };
}

/**
 * A grammar IPA transcribes the class words in ipaText, not the pattern label in en, so those
 * words come first: "Does she walk /dʌz ʃi wɔːk/". Other IPA transcribes en and stands alone.
 */
function transcription(value: StudyContent, ctx: RenderContext): string | undefined {
  return value.set === "production" && value.ipaText && value.ipa
    ? `${text(value.ipaText)} <bdi ${ctx.englishAttrs} class="ipa">${text(value.ipa)}</bdi>`
    : undefined;
}

function pronunciation(value: StudyContent, ctx: RenderContext): string {
  const prose = ctx.prose;
  const transcribed = transcription(value, ctx);
  const parts = [
    transcribed
      ? `<bdi ${ctx.englishAttrs}>${transcribed}</bdi>`
      : value.ipa
        ? `<bdi ${ctx.englishAttrs} class="ipa">${text(value.ipa)}</bdi>`
        : "",
    ctx.locale.isPersian && value.faApprox ? prose(value.faApprox) : "",
    value.trap ? `<span ${ctx.explanatoryAttrs} class="trap">⚠️ ${prose(value.trap)}</span>` : "",
  ].filter(Boolean);
  return parts.length ? `<p class="pron">🔊 ${parts.join(" · ")}</p>` : "";
}

function entry(item: LearningItem, ctx: RenderContext, index?: number): string {
  const prose = ctx.prose;
  const value = item.study;
  if (!value) return "";
  const production = value.set === "production";
  const example = production ? value.fullSentence : value.example;
  const expansion =
    !production && item.claim.origin === "ai_expansion"
      ? `<p class="src">${ctx.label("aiExpansion")}</p>`
      : "";
  const sourceKey = item.claim.origin === "from_class" ? "fromClass" : "aiExpansion";
  const sourceLabel = studyMessage(ctx.locale.language, sourceKey);
  const sourceHtml =
    production && value.sourceFa === sourceLabel.text
      ? ctx.label(sourceKey)
      : production
        ? prose(value.sourceFa)
        : "";
  return `<article class="entry" id="${attr(item.id)}">\n<h3>${index !== undefined ? `<span class="n">${index + 1}</span>` : ""}<span ${ctx.englishAttrs} class="en"${ctx.itemAnchors ? ` data-learning-item-id="${attr(item.id)}"` : ""}>${text(value.en)}</span></h3>\n${pronunciation(value, ctx)}\n${value.faMeaning ? `<p class="mean">${prose(value.faMeaning)}</p>` : ""}\n${example ? `<p class="ex" ${ctx.englishAttrs}>${text(example)}</p>` : ""}\n${production && value.collocations.length ? `<p class="col" ${ctx.englishAttrs}><b>Collocations:</b> ${value.collocations.map(text).join(" · ")}</p>` : ""}\n${value.noteFa ? `<p>📝 ${prose(value.noteFa)}</p>` : ""}\n${production && value.imageFa ? `<p class="img">🖼️ ${prose(value.imageFa)}</p>` : ""}\n${production && value.sourceFa ? `<p class="src">${ctx.label("source")} ${sourceHtml}</p>` : ""}\n${expansion}</article>`;
}

function table(
  headers: readonly string[],
  rows: readonly string[][],
  ctx: RenderContext,
  headingsHtml = false,
): string {
  const prose = ctx.prose;
  return `<div class="tw"><table>\n<tr>${headers.map((header) => `<th>${headingsHtml ? header : prose(header)}</th>`).join("")}</tr>\n${rows.map((row) => `<tr>${row.join("")}</tr>`).join("\n")}\n</table></div>`;
}

function taskGroups(groups: readonly TaskGroup[], ctx: RenderContext): string {
  const prose = ctx.prose;
  return groups
    .filter((group) => group.blocks.length)
    .map(
      (group) =>
        `<h3>${prose(group.title)}</h3>\n${group.blocks
          .map((block) => {
            if (block.type === "text") return `<p>${prose(block.textFa)}</p>`;
            if (block.type === "quote")
              return `<p class="ex" ${ctx.englishAttrs}>${en(block.quoteEn)}</p>`;
            if (block.type === "table")
              return table(
                block.headers,
                block.rows.map((row) =>
                  row.map((cell) =>
                    ctx.locale.isPersian
                      ? /\p{Script=Arabic}/u.test(cell)
                        ? `<td>${prose(cell)}</td>`
                        : `<td ${ctx.englishAttrs}>${en(cell)}</td>`
                      : `<td dir="auto">${prose(cell)}</td>`,
                  ),
                ),
                ctx,
              );
            return block.items
              .map(
                (item, index) =>
                  `<div class="sc">\n<p class="q" ${ctx.englishAttrs}><b>${index + 1}.</b> ${en(item.prompt)}</p>\n${item.learnerAnswer ? `<p class="yours" ${ctx.englishAttrs}>✗ ${en(item.learnerAnswer)}</p>\n` : ""}<p class="model" ${ctx.englishAttrs}>✓ ${en(item.model)}</p>\n${item.whyFa ? `<p class="why">${prose(item.whyFa)}</p>\n` : ""}</div>`,
              )
              .join("\n");
          })
          .join("\n")}`,
    )
    .join("\n");
}

/** Bold the exact span(s) a gap sentence removes, only when the pair aligns exactly. */
function revealedSentence(gapSentence: string, fullSentence: string): string {
  const parts = gapSentence.split("______");
  if (parts.length < 2 || parts.length > 4) return text(fullSentence);
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = new RegExp(`^${escaped.join("(.+?)")}$`, "su").exec(fullSentence);
  if (!match) return text(fullSentence);
  return parts
    .map((part, index) =>
      index === 0 ? text(part) : `<b>${text(match[index] ?? "")}</b>${text(part)}`,
    )
    .join("");
}

/**
 * D49 retrieval check: each core item asks the same question as its flashcard front
 * (renderStudyCard), so notes and cards stay one canonical source. Answers stay hidden until
 * opened; a gap already practised in the gap-fill section is not asked twice.
 */
function checkYourself(
  core: readonly LearningItem[],
  gapfill: ClassNotes["gapfill"],
  ctx: RenderContext,
): string {
  const prose = ctx.prose;
  const practised = new Set(gapfill.map((item) => item.sentence.trim()));
  const questions = core.flatMap((item, index) => {
    const study = item.study;
    if (study?.set !== "production") return [];
    if (study.kind === "grammar") {
      if (!study.taskFa || !study.prompt) return [];
      return [
        {
          item,
          index,
          instruction: prose(study.taskFa),
          question: text(study.prompt),
          answer: text(study.fullSentence),
          key: study.fullSentence,
        },
      ];
    }
    const gapSentence = study.gapSentence;
    if (!gapSentence?.includes("______") || practised.has(gapSentence.trim())) return [];
    return [
      {
        item,
        index,
        instruction: prose(study.faMeaning),
        question: gap(gapSentence),
        answer: revealedSentence(gapSentence, study.fullSentence),
        key: study.fullSentence,
      },
    ];
  });
  if (!questions.length) return "";
  // The reference drill structure: print hides each toggle (ol.gaps details) and shows the key.
  return `${labelNote("checkNote", ctx)}<ol class="gaps">\n${questions
    .map(
      (question) =>
        `<li><p class="mean">${question.instruction}</p><p class="q" ${ctx.englishAttrs}>${question.question}</p><details><summary>${ctx.label("answer")}</summary><p class="model" ${ctx.englishAttrs}>✓ ${question.answer}</p><p class="src"><a href="#${attr(encodeURIComponent(question.item.id))}">↩ ${ctx.label("card")} ${ctx.number(question.index + 1)}</a></p></details></li>`,
    )
    .join(
      "\n",
    )}\n</ol>\n<p class="key">${ctx.label("answers")} <bdi ${ctx.englishAttrs}>${questions.map((question, position) => `${position + 1}. ${text(question.key)}`).join(" · ")}</bdi></p>`;
}

/** Preserve supported notebook content that is not represented by a reference section. */
function additionalLessonNotes(model: KnowledgeModel, ctx: RenderContext): string {
  const prose = ctx.prose;
  const claim = (value: Claim) => {
    const labels = [
      ctx.label(value.origin === "from_class" ? "fromClass" : "aiExpansion"),
      value.uncertain ? (ctx.locale.isPersian ? "نیاز به بررسی" : ctx.label("uncertainties")) : "",
      ...value.sourceRefs.map((ref) => {
        if (ref.locator.kind === "page")
          return `${ctx.label("page")} ${ctx.number(ref.locator.page)}`;
        if (ref.locator.kind === "time")
          return `${ctx.label("audio")} <bdi ${ctx.englishAttrs}>${(ref.locator.startMs / 1000).toFixed(1)}–${(ref.locator.endMs / 1000).toFixed(1)}</bdi> ${ctx.label("seconds")}`;
        return `${ctx.label("textRange")} <bdi ${ctx.englishAttrs}>${ref.locator.start}–${ref.locator.end}</bdi>`;
      }),
    ].filter(Boolean);
    return `<article class="entry"><p>${prose(value.text).replace(/\r?\n/g, "<br>")}</p><p class="src">${labels.join(" · ")}</p></article>`;
  };
  return [
    model.summary.length
      ? `<h3>${ctx.label("summary")}</h3>${model.summary.map(claim).join("\n")}`
      : "",
    model.topics.length
      ? `<h3>${ctx.label("topics")}</h3>${model.topics.map((topic) => `<h4>${prose(topic.title)}</h4>${topic.claims.map(claim).join("\n")}`).join("\n")}`
      : "",
    model.homework.length
      ? `<h3>${ctx.label("homework")}</h3>${model.homework.map(claim).join("\n")}`
      : "",
    model.uncertainties.length
      ? `<h3>${ctx.label("uncertainties")}</h3>${model.uncertainties.map(claim).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const MISTAKE_KINDS: Record<
  NonNullable<ClassNotes["mistakes"]>["items"][number]["kind"],
  StudyLabelKey
> = {
  grammar: "mistakeGrammar",
  "word-choice": "mistakeWordChoice",
  collocation: "mistakeCollocation",
  preposition: "mistakePreposition",
  "word-order": "mistakeWordOrder",
  pronunciation: "mistakePronunciation",
  spelling: "mistakeSpelling",
  register: "mistakeRegister",
};

function mistakesContent(
  notes: ClassNotes,
  core: readonly LearningItem[],
  ctx: RenderContext,
): string {
  const prose = ctx.prose;
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
  const patternProse = (value: string, keys: readonly StudyLabelKey[]): string => {
    const key = keys.find(
      (candidate) => studyMessage(ctx.locale.language, candidate).text === value,
    );
    return key ? ctx.label(key) : prose(value);
  };
  const patternHtml = patterns.length
    ? `<h3>${ctx.label("patterns")}</h3>\n${patterns.map((pattern) => `<div class="sc">\n<p class="mean">${patternProse(pattern.labelFa, Object.values(MISTAKE_KINDS))} · ${ctx.number(pattern.examples.length)} ${ctx.label("occurrences")}</p>\n<p ${ctx.englishAttrs}>${pattern.examples.map(en).join("<br>")}</p>\n<p class="why">${patternProse(pattern.ruleFa, ["patternRule"])}</p>\n</div>`).join("\n")}`
    : "";
  const rows = written.map((item) => {
    const linkedIndex = core.findIndex((candidate) => candidate.id === item.itemId);
    const source = [
      `✍️ ${ctx.label(MISTAKE_KINDS[item.kind])}`,
      item.teacherCorrected ? ctx.label("teacherCorrected") : "",
      item.where ? prose(item.where) : "",
      linkedIndex >= 0 && item.itemId
        ? `<a href="#${attr(encodeURIComponent(item.itemId))}">${ctx.label("card")} ${ctx.number(linkedIndex + 1)}</a>`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `<div class="sc">\n<p class="yours" ${ctx.englishAttrs}>✗ ${en(item.said)}</p>\n<p class="model" ${ctx.englishAttrs}>✓ ${en(item.correct)}</p>\n<p class="why">${prose(item.whyFa)}</p>\n<p class="src">${source}</p>\n</div>`;
  });
  const speechRows = spoken.map(
    (item) =>
      `<div class="sc">\n<p class="yours" ${ctx.englishAttrs}>✗ ${en(item.said)}</p>\n<p class="model" ${ctx.englishAttrs}>✓ ${en(item.correct)}</p>\n<p class="why">${prose(item.whyFa)}</p>\n<p class="src">🎙️ ${ctx.label(MISTAKE_KINDS[item.kind])} · ${item.where ? prose(item.where) : ctx.label("verifiedVoice")}</p>\n</div>`,
  );
  const withheld =
    mistakes.speechStatus === "unverified" || mistakes.pendingSpeech
      ? labelNote("withheldSpeech", ctx)
      : "";
  // Legacy/model-written 'verified' without server evidence still fails closed.
  const untrustedVerified =
    mistakes.speechStatus === "verified" &&
    !spoken.length &&
    mistakes.items.some((item) => item.source === "speech" && !item.voiceEvidence);
  return `${withheld}${untrustedVerified ? labelNote("withheldSpeech", ctx) : ""}${mistakes.speechStatus === "no_audio" ? note(mistakes.noteFa, ctx) : ""}${patternHtml}${speechRows.length ? `<h3>${ctx.label("spoken")}</h3>\n${speechRows.join("\n")}` : ""}${rows.length ? `<h3>${ctx.label("written")}</h3>\n${rows.join("\n")}` : ""}`;
}

/** A passive standalone document; optional item anchors let the app attach its trusted controls. */
export function renderClassNotesHtml(
  model: KnowledgeModel,
  options: { itemAnchors?: boolean } = {},
): string {
  const ctx = context(model.language.explanation);
  ctx.itemAnchors = options.itemAnchors;
  const prose = ctx.prose;
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
      `${ctx.number(core.length)} ${ctx.label("coreCards")}`,
      ctx.label("coreHeading"),
      `${note(notes?.coreIntro, ctx)}${core.map((item, index) => entry(item, ctx, index)).join("\n")}`,
    );
  if (oral.length)
    add(
      "oral",
      ctx.label("oralPill"),
      ctx.label("oralHeading"),
      `${note(notes?.oralIntro, ctx)}${oral.map((item) => entry(item, ctx)).join("\n")}`,
    );
  if (notes) {
    add(
      "chunks",
      ctx.label("chunksPill"),
      ctx.label("chunksHeading"),
      `${
        notes.chunks.length
          ? table(
              [ctx.label("pattern"), ctx.label("classSentence"), ctx.label("note")],
              notes.chunks.map((chunk) => [
                `<td ${ctx.englishAttrs}><b>${text(chunk.pattern)}</b></td>`,
                `<td ${ctx.englishAttrs}><i>${text(chunk.classSentence)}</i></td>`,
                `<td>${prose(chunk.noteFa)}</td>`,
              ]),
              ctx,
              true,
            )
          : ""
      }${notes.board.length ? `<p>${ctx.label("boardAlso")}</p>\n<ul ${ctx.englishAttrs}>\n${notes.board.map((line) => `<li><b>${text(line)}</b></li>`).join("\n")}\n</ul>` : ""}`,
    );
    add("tasks", ctx.label("tasks"), ctx.label("tasks"), taskGroups(notes.tasks, ctx));
    add(
      "mistakes",
      ctx.label("mistakes"),
      ctx.label("mistakes"),
      mistakesContent(notes, core, ctx),
    );
  }
  if (extra.length)
    add(
      "extra",
      ctx.label("extraPill"),
      ctx.label("extraHeading"),
      table(
        [ctx.label("english"), ctx.label("meaning"), ctx.label("example")],
        extra.flatMap((item) =>
          item.study?.set === "recognition"
            ? [
                [
                  `<td ${ctx.englishAttrs}><b${ctx.itemAnchors ? ` data-learning-item-id="${attr(item.id)}"` : ""}>${text(item.study.en)}</b></td>`,
                  `<td>${prose(item.study.faMeaning)}${item.study.noteFa ? `<p ${ctx.explanatoryAttrs}>📝 ${prose(item.study.noteFa)}</p>` : ""}${item.claim.origin === "ai_expansion" ? `<p class="src">${ctx.label("aiExpansion")}</p>` : ""}</td>`,
                  `<td ${ctx.englishAttrs}><i>${text(item.study.example)}</i></td>`,
                ],
              ]
            : [],
        ),
        ctx,
        true,
      ),
    );
  if (notes) {
    if (notes.register.length)
      add(
        "register",
        ctx.label("registerPill"),
        ctx.label("registerHeading"),
        table(
          [ctx.label("notThis"), ctx.label("sayThis"), ctx.label("why")],
          notes.register.map((item) => [
            `<td ${ctx.englishAttrs} class="bad">${en(item.notThis)}</td>`,
            `<td ${ctx.englishAttrs} class="good">${en(item.sayThis)}</td>`,
            `<td>${prose(item.whyFa)}</td>`,
          ]),
          ctx,
          true,
        ),
      );
    if (notes.gapfill.length)
      add(
        "gap",
        ctx.label("gapPill"),
        ctx.label("gapHeading"),
        `<ol class="gaps" ${ctx.englishAttrs}>\n${notes.gapfill.map((item) => `<li>${gap(item.sentence)}<details><summary>${ctx.label("answer")}</summary><b>${text(item.answer)}</b>${item.whyFa ? ` — <span class="why" ${ctx.explanatoryAttrs}>${prose(item.whyFa)}</span>` : ""}</details></li>`).join("\n")}\n</ol>\n<p class="key">${ctx.label("answers")} <bdi ${ctx.englishAttrs}>${notes.gapfill.map((item, index) => `${index + 1}. ${text(item.answer)}`).join(" · ")}</bdi></p>`,
      );
    add(
      "culture",
      ctx.label("culturePill"),
      ctx.label("cultureHeading"),
      taskGroups(notes.culture ?? [], ctx),
    );
  }
  if (appendix.length)
    add(
      "pron",
      ctx.label("pronunciationPill"),
      ctx.label("pronunciationHeading"),
      `${labelNote("pronunciationNote", ctx)}${table(
        [
          ctx.label("expression"),
          ctx.label("ipa"),
          ...(ctx.locale.isPersian ? [ctx.label("persianApprox")] : []),
          ctx.label("trap"),
        ],
        appendix.flatMap((item) => {
          if (!item.study) return [];
          const transcribed = transcription(item.study, ctx);
          return [
            [
              `<td ${ctx.englishAttrs}><b>${text(item.study.en)}</b></td>`,
              transcribed
                ? `<td ${ctx.englishAttrs}>${transcribed}</td>`
                : `<td ${ctx.englishAttrs} class="ipa">${text(item.study.ipa ?? "")}</td>`,
              ...(ctx.locale.isPersian ? [`<td>${prose(item.study.faApprox ?? "")}</td>`] : []),
              `<td>${prose(item.study.trap ?? "")}</td>`,
            ],
          ];
        }),
        ctx,
        true,
      )}`,
    );
  add(
    "check",
    ctx.label("checkPill"),
    ctx.label("checkHeading"),
    checkYourself(core, notes?.gapfill ?? [], ctx),
  );
  const plainItems = model.learningItems.filter((item) => !item.study);
  if (plainItems.length)
    add(
      "edited",
      ctx.label("edited"),
      ctx.label("edited"),
      `${labelNote("editedNote", ctx)}${plainItems.map((item) => `<article class="entry" id="${attr(item.id)}"><h3 dir="auto">${text(item.front)}</h3><p dir="auto">${text(item.back).replace(/\r?\n/g, "<br>")}</p></article>`).join("\n")}`,
    );
  add(
    "lesson-notes",
    ctx.label("lessonNotes"),
    ctx.label("lessonNotes"),
    additionalLessonNotes(model, ctx),
  );
  const date = notes?.date ?? "";
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : undefined;
  const weekdayLanguage = Intl.DateTimeFormat.supportedLocalesOf(ctx.locale.language).length
    ? ctx.locale.language
    : "en";
  const weekday =
    parsedDate && Number.isFinite(parsedDate.getTime())
      ? weekdayLanguage === ctx.locale.language
        ? text(studyWeekday(parsedDate, weekdayLanguage))
        : `<span lang="en" dir="ltr">${text(studyWeekday(parsedDate, weekdayLanguage))}</span>`
      : "";
  const institution = [notes?.institution, notes?.course].filter(Boolean).join(" · ");
  return `<!doctype html>\n<html lang="${attr(ctx.locale.language)}" dir="${ctx.locale.direction}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${text(model.title)}${date ? ` · ${text(date)}` : ""}</title>\n${fonts(ctx.locale)}\n<style>${CLASS_NOTES_STYLES}${localizedStudyStyles(ctx.locale)}</style>\n</head>\n<body id="top">\n${sections.length ? `<nav>${sections.map((section) => `<a href="#${section.id}">${section.pill}</a>`).join("")}</nav>` : ""}\n<main>\n<header>\n<h1>${prose(model.title)}</h1>\n${institution || date ? `<p>${institution ? `${prose(institution)}${date ? " · " : ""}` : ""}${date ? `${weekday} <bdi ${ctx.englishAttrs} class="date">${text(date)}</bdi>` : ""}</p>` : ""}\n${notes?.coverage ? `<p>${prose(notes.coverage)}</p>` : ""}\n${note(notes?.sourceNote, ctx)}\n</header>\n${sections.map((section, index) => `<section id="${section.id}">\n<h2>${ctx.number(index + 1)}. ${section.heading}</h2>\n${section.body}\n<a class="top" href="#top">${ctx.label("backToTop")}</a>\n</section>`).join("\n\n")}\n</main>\n</body>\n</html>`;
}
