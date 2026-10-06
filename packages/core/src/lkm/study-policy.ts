import type { ClassNotes, StudyContent, TaskGroup } from "./study-schema";

export interface StudyLessonContext {
  date: string;
  course?: string;
}

/** Explicit Persian prose paths; English examples, IPA, labels and IDs are never translated. */
export function persianStudyFields(model: {
  learningItems: readonly { study?: StudyContent }[];
  classNotes?: ClassNotes;
}): { path: (string | number)[]; text: string }[] {
  const fields: { path: (string | number)[]; text: string }[] = [];
  const add = (path: (string | number)[], text: string | undefined) => {
    // A compact grammar formula is intentionally English, not an explanation to translate.
    const grammarFormula =
      text &&
      path.at(-1) === "whyFa" &&
      /^[A-Za-z][A-Za-z '-]{0,39}\s*\+\s*(?:-?ing|V(?:-ing)?|noun|verb|infinitive|adj(?:ective)?|sb|sth)(?:\s*[+/]\s*(?:-?ing|V(?:-ing)?|noun|verb|infinitive|adj(?:ective)?|sb|sth))*[.!]?$/u.test(
        text,
      );
    if (text && !grammarFormula) fields.push({ path, text });
  };
  model.learningItems.forEach((item, index) => {
    const study = item.study;
    if (!study) return;
    for (const key of ["faMeaning", "faApprox", "trap", "noteFa"] as const)
      add(["learningItems", index, "study", key], study[key]);
    if (study.set === "production") {
      for (const key of ["imageFa", "sourceFa", "taskFa"] as const)
        add(["learningItems", index, "study", key], study[key]);
    }
  });
  const notes = model.classNotes;
  if (!notes) return fields;
  for (const key of ["sourceNote", "coreIntro", "oralIntro"] as const)
    add(["classNotes", key], notes[key]);
  notes.chunks.forEach((row, index) => {
    add(["classNotes", "chunks", index, "noteFa"], row.noteFa);
  });
  notes.register.forEach((row, index) => {
    add(["classNotes", "register", index, "whyFa"], row.whyFa);
  });
  notes.gapfill.forEach((row, index) => {
    add(["classNotes", "gapfill", index, "whyFa"], row.whyFa);
  });
  const groups = (section: "tasks" | "culture", values: TaskGroup[]) => {
    values.forEach((group, groupIndex) => {
      group.blocks.forEach((block, blockIndex) => {
        const path = ["classNotes", section, groupIndex, "blocks", blockIndex];
        if (block.type === "text") add([...path, "textFa"], block.textFa);
        if (block.type === "items")
          block.items.forEach((item, index) => {
            add([...path, "items", index, "whyFa"], item.whyFa);
          });
      });
    });
  };
  groups("tasks", notes.tasks);
  groups("culture", notes.culture ?? []);
  add(["classNotes", "mistakes", "noteFa"], notes.mistakes?.noteFa);
  notes.mistakes?.items
    .filter((item) => item.source === "handwriting")
    .forEach((item) => {
      const index = notes.mistakes?.items.indexOf(item) ?? -1;
      add(["classNotes", "mistakes", "items", index, "whyFa"], item.whyFa);
    });
  return fields;
}

/** Derive aggregates only from correction items the caller has authorized for display. */
export function visibleMistakePatterns(visible: NonNullable<ClassNotes["mistakes"]>["items"]) {
  const labels = {
    grammar: "گرامر",
    "word-choice": "انتخاب واژه",
    collocation: "هم‌آیی واژه‌ها",
    preposition: "حرف اضافه",
    "word-order": "ترتیب کلمات",
    pronunciation: "تلفظ",
    spelling: "املا",
    register: "لحن",
  };
  return Object.entries(labels).flatMap(([kind, labelFa]) => {
    const pairs = new Set<string>();
    const items = visible.filter((item) => {
      if (item.kind !== kind) return false;
      const pair = `${item.said}\u0000${item.correct}`
        .replaceAll("**", "")
        .replace(/\s+/gu, " ")
        .trim()
        .toLocaleLowerCase("en");
      if (pairs.has(pair)) return false;
      pairs.add(pair);
      return true;
    });
    return items.length < 2
      ? []
      : [
          {
            labelFa,
            count: items.length,
            examples: items.map((item) => `${item.said} → ${item.correct}`),
            ruleFa:
              new Set(items.map((item) => item.whyFa)).size === 1
                ? (items[0]?.whyFa ?? "")
                : "به شکل درستِ نمونه‌های بالا دقت کن.",
          },
        ];
  });
}

/** Provider aggregates may contain hidden speech; generated output authorizes writing only. */
export function writtenMistakePatterns(mistakes: ClassNotes["mistakes"]) {
  return visibleMistakePatterns(
    (mistakes?.items ?? []).filter((item) => item.source === "handwriting"),
  );
}

/** The provider supplies teaching content, never a learner's verified identity or profile. */
export function normalizeGeneratedStudyModel<
  T extends {
    language: { explanation: string };
    learningItems: {
      front: string;
      back: string;
      study?: StudyContent;
      claim: { speakerRole: string };
    }[];
    classNotes?: ClassNotes;
  },
>(model: T, hasAudio: boolean, context?: StudyLessonContext): T {
  if (model.language.explanation.split("-")[0] !== "fa") {
    const { classNotes: _classNotes, ...legacy } = model;
    return {
      ...legacy,
      learningItems: model.learningItems.map(({ study: _study, ...item }) => item),
    } as T;
  }
  return {
    ...model,
    learningItems: model.learningItems.map((item) => {
      if (!item.study) return item;
      const study =
        item.study.set === "recognition" &&
        item.study.spoken &&
        item.claim.speakerRole !== "teacher"
          ? { ...item.study, spoken: false }
          : item.study;
      return { ...item, study, front: study.en, back: study.faMeaning };
    }),
    ...(model.classNotes
      ? {
          classNotes: {
            ...model.classNotes,
            ...(context
              ? { date: context.date, course: context.course, institution: undefined }
              : {}),
            mistakes: {
              ...model.classNotes.mistakes,
              speechStatus: hasAudio ? "unverified" : "no_audio",
              pendingSpeech: undefined,
              // An aggregate can reveal a withheld utterance even if its individual item is hidden.
              patterns: writtenMistakePatterns(model.classNotes.mistakes),
              items: (model.classNotes.mistakes?.items ?? []).filter(
                (item) => item.source === "handwriting",
              ),
            },
          },
        }
      : {}),
  };
}
