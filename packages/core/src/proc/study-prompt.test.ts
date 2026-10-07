import { describe, expect, it } from "vitest";
import { FIRST_LANGUAGES } from "../acc";
import { studyPrompt } from "./study-prompt";
import { knowledgePrompt } from "./worker";

describe("Persian lesson response budget", () => {
  it.each(["fa", "en"])(
    "keeps the actual %s primary and repair prompts consistent with their different claim contracts",
    (language) => {
      const primary = knowledgePrompt(language, true, 6144);
      const repair = knowledgePrompt(language, true, 6144, true);
      expect(primary).toContain("All generated claims use creation ai_generation");
      expect(primary).toContain("classNotes, sourceClassifications");
      expect(repair).not.toContain("All generated claims use creation ai_generation");
      expect(repair).not.toContain("All generated claims have creation ai_generation");
      expect(repair).not.toContain("New educational examples must be ai_expansion");
      expect(repair).toContain("New educational examples use null evidenceKey");
      expect(repair).toContain("coverage, classNotes.");
      expect(repair).toContain(
        "All notebook sections, including mistakes, belong inside classNotes",
      );
      if (language === "fa") {
        expect(repair).toContain("Each claim has exactly id, text, evidenceKey and uncertain");
        expect(repair).toContain("Set classNotes.mistakes.speechStatus");
        expect(repair).not.toContain("Set mistakes.speechStatus");
      }
    },
  );
  it("fits the production 6144-token budget with complete cards and an explicit subset notice", () => {
    const prompt = studyPrompt("fa", 6144);
    expect(prompt).toContain("at most 4 complete production items");
    expect(prompt).toContain("at most 2 recognition items");
    expect(prompt).toContain("gapfill has at most 4 NEW sentences");
    expect(prompt).toContain("at most 1 short task groups");
    expect(prompt).toContain("Aim below 4608");
    expect(prompt).toContain("At most 2 mistakes");
    expect(prompt).not.toContain("10–18 production items");
    expect(prompt).not.toContain("8–12 NEW sentences");
    expect(prompt).toContain("always include this Persian sourceNote");
    expect(prompt).toContain("این نسخه گزیده‌ای از درس است");
    expect(prompt).toContain("complete production fields and evidence");
    expect(prompt).toContain("Read all supplied source evidence");
    expect(prompt).toContain("never to the source input");
    expect(prompt).toContain(
      "The separate top-level coverage object remains required with complete and missingSourceIds",
    );
    expect(prompt).toContain("ONE paired sentence, never two different examples");
    expect(prompt).toContain(
      'fullSentence="I get on with my neighbours very well."; gapSentence="I ______ my neighbours very well."',
    );
    expect(prompt).toContain("reproduce fullSentence byte for byte");
    expect(prompt).toContain('Choose study.kind="grammar" ONLY for a grammar task');
    expect(prompt).toContain("both nonempty study.taskFa");
    expect(prompt).toContain("nonempty study.prompt");
    expect(prompt).toContain("study.gapSentence paired with study.fullSentence is mandatory");
  });

  it("reduces supplementary work further when the configured budget is smaller", () => {
    const prompt = studyPrompt("fa", 3072);
    expect(prompt).toContain("at most 2 complete production items");
    expect(prompt).toContain("at most 1 recognition items");
    expect(prompt).toContain("gapfill has at most 2 NEW sentences");
    expect(prompt).toContain("at most 0 short task groups");
    expect(prompt).toContain("always include this Persian sourceNote");
    expect(prompt).toContain("empty arrays are valid");
  });

  it("retains richer lesson targets when enough output capacity is configured", () => {
    const prompt = studyPrompt("fa", 24576);
    expect(prompt).toContain("Normally select 10–18 production items");
    expect(prompt).toContain("gapfill normally has 8–12 NEW sentences");
    expect(prompt).toContain("one to three sentences in the resolved explanation language");
    expect(prompt).not.toContain("always include this Persian sourceNote");
    expect(prompt).toContain(
      "explicitly state in classNotes.sourceNote, in the resolved explanation language",
    );
    expect(prompt).toContain("never grounds to invent or truncate JSON");
  });
});

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

it.each(["en", ...FIRST_LANGUAGES.filter((language) => language !== "fa")])(
  "keeps compact-budget caveats in resolved %s without inserting Persian prose",
  (language) => {
    const primary = knowledgePrompt(language, true, 6144);
    const repair = knowledgePrompt(language, true, 6144, true);
    for (const prompt of [primary, repair]) {
      expect(prompt).toContain("at most 4 complete production items");
      expect(prompt).toContain("Aim below 4608");
      expect(prompt).toContain("always include");
      expect(prompt).toContain("sourceNote");
      expect(prompt).not.toMatch(/\p{Script=Arabic}/u);
    }
    expect(repair).toContain("Each claim has exactly id, text, evidenceKey and uncertain");
    expect(repair).not.toContain("All generated claims use creation ai_generation");
  },
);
