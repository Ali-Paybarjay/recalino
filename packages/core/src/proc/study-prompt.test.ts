import { expect, it } from "vitest";
import { FIRST_LANGUAGES } from "../acc";
import { studyPrompt } from "./study-prompt";

it.each(["en", ...FIRST_LANGUAGES])(
  "uses resolved %s explanation language for shared rich notes/cards",
  (language) => {
    const prompt = studyPrompt(language, 8192);
    expect(prompt).toContain(`explanationLanguage is exactly ${JSON.stringify(language)}`);
    expect(prompt).toContain("populate classNotes and each learningItem.study");
    expect(prompt).toContain("stable field names");
    expect(prompt).toContain("English exemplifies");
    expect(prompt).toContain("8192 output tokens");
    expect(prompt).toContain(
      language === "fa" ? "faApprox in Persian with vowel marks" : "Omit faApprox",
    );
    expect(prompt).not.toContain("Persian-speaking learner");
    expect(prompt).not.toContain("Address the learner plainly as تو");
  },
);
