import { expect, it } from "vitest";
import {
  MULTILINGUAL_STUDY_CASES,
  multilingualStudyModel,
} from "../../test/multilingual-study-fixture";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { safeCardHtml } from "../lkm";
import {
  readStudyMetadata,
  savedStudyMetadata,
  studyCardContent,
  studyPronunciationTarget,
} from "./study-content";

it.each(MULTILINGUAL_STUDY_CASES)(
  "prepares $language faces in the immutable notebook explanation language",
  (value) => {
    const model = multilingualStudyModel(value);
    for (const item of model.learningItems) {
      const content = studyCardContent(item, model);
      const meaningFace = item.study?.set === "production" ? content.front : content.back;
      expect(meaningFace).toContain(value.meaning);
      expect(meaningFace).toContain(`lang="${value.language}"`);
      expect(meaningFace).toContain(`dir="${value.dir}"`);
      expect(safeCardHtml(content.front)).toBe(content.front);
      expect(safeCardHtml(content.back)).toBe(content.back);
      expect(content.front + content.back).not.toMatch(/معنی|استهلاک|فارسی/);
      expect(readStudyMetadata(content.study_metadata)).toMatchObject({
        contentFormat: "lesson_html",
        studySet: item.study?.set,
        studyPosition: model.learningItems.indexOf(item),
      });
    }
  },
);

it("AC-D46-04 speaks the words a grammar IPA transcribes, never its pattern label", () => {
  const model = referenceStudyModel();
  const item = model.learningItems[0];
  if (item?.study?.set !== "production") throw new Error("Missing reference target");
  const { gapSentence: _gap, ...study } = item.study;
  const grammar = {
    ...item,
    kind: "grammar" as const,
    study: {
      ...study,
      en: "present simple questions",
      kind: "grammar" as const,
      ipa: "/dʌz ʃi wɔːk/",
      ipaText: "Does she walk",
      taskFa: "جمله را سؤالی کن:",
      prompt: "She walks to school every day.",
      fullSentence: "Does she walk to school every day?",
    },
  };
  expect(studyPronunciationTarget(grammar)).toBe("Does she walk");
  expect(
    readStudyMetadata(studyCardContent(grammar, model).study_metadata).pronunciationTarget,
  ).toBe("Does she walk");
  // Words unfit for speech leave the card silent rather than speaking the label instead.
  expect(
    studyPronunciationTarget({
      ...grammar,
      study: { ...grammar.study, ipaText: "Does [she] walk" },
    }),
  ).toBeUndefined();
});

it("AC-D46-01 extracts only the structured target and preserves old metadata", () => {
  const model = referenceStudyModel();
  const item = model.learningItems[0];
  if (item?.study?.set !== "production") throw new Error("Missing reference target");
  expect(studyPronunciationTarget(item)).toBe("wear and tear");
  expect(readStudyMetadata(studyCardContent(item, model).study_metadata).pronunciationTarget).toBe(
    "wear and tear",
  );
  const legacy = {
    contentFormat: "lesson_html" as const,
    studySet: "production" as const,
    studyTags: [],
    studyPosition: 0,
  };
  expect(readStudyMetadata(savedStudyMetadata(legacy))).toEqual(legacy);
  expect(studyPronunciationTarget({ ...item, study: undefined })).toBeUndefined();
  for (const en of [
    "واژه",
    "wear <b>and</b> tear",
    "wear &amp; tear",
    "{{c1::hidden}}",
    "x".repeat(501),
  ]) {
    expect(studyPronunciationTarget({ ...item, study: { ...item.study, en } })).toBeUndefined();
  }
  const separable = model.learningItems[1];
  if (separable?.study?.set !== "production") throw new Error("Missing frame");
  expect(studyPronunciationTarget(separable)).toBe("kit it out");
  expect(
    studyPronunciationTarget({
      ...separable,
      study: { ...separable.study, fullSentence: "A mismatched answer." },
    }),
  ).toBeUndefined();
  expect(studyPronunciationTarget(model.learningItems[3] as typeof item)).toBeUndefined();
  expect(
    studyPronunciationTarget({
      ...item,
      study: {
        ...item.study,
        en: "look forward to + -ing / noun",
        gapSentence: "I look forward to ______ my new neighbours.",
        fullSentence: "I look forward to meeting my new neighbours.",
      },
    }),
  ).toBe("look forward to");
  expect(
    studyPronunciationTarget({
      ...separable,
      study: {
        ...separable.study,
        en: "kit sb/sth out",
        gapSentence: "We need to kit it out before ______.",
        fullSentence: "We need to kit it out before Monday.",
      },
    }),
  ).toBeUndefined();
});

it.each([
  ["someone else", "someone else"],
  ["something like that", "something like that"],
  ["do something about sth", "do something about"],
])("AC-D46-01 pronounces the literal pronoun phrase %s in full", (en, spoken) => {
  const item = referenceStudyModel().learningItems[0];
  if (item?.study?.set !== "production") throw new Error("Missing reference target");
  expect(studyPronunciationTarget({ ...item, study: { ...item.study, en } })).toBe(spoken);
});
