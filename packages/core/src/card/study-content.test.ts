import { expect, it } from "vitest";
import {
  MULTILINGUAL_STUDY_CASES,
  multilingualStudyModel,
} from "../../test/multilingual-study-fixture";
import { safeCardHtml } from "../lkm";
import { readStudyMetadata, studyCardContent } from "./study-content";

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
