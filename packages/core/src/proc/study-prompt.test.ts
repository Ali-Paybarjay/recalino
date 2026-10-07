import { describe, expect, it } from "vitest";
import { FIRST_LANGUAGES } from "../acc";
import { personalisedTeachingPrompt, studyPrompt } from "./study-prompt";
import { knowledgePrompt } from "./worker";

describe("AC-D46-06 friendly declared-level teaching", () => {
  it.each([
    ["A1", "short, concrete steps"],
    ["A2", "short, concrete steps"],
    ["B1", "Connect each explanation to its use"],
    ["B2", "Connect each explanation to its use"],
    ["C1", "useful nuance, register and contrasts"],
    ["C2", "useful nuance, register and contrasts"],
  ] as const)(
    "adapts newly written teaching to declared %s without changing source evidence",
    (declaredLevel, instruction) => {
      const learnerContext = { version: 1 as const, declaredLevel, goal: "ielts" as const };
      for (const usesEvidenceKeys of [false, true]) {
        const prompt = knowledgePrompt("en", false, 6144, usesEvidenceKeys, learnerContext);
        expect(prompt).toContain(instruction);
        expect(prompt).toContain("declared IELTS goal");
        expect(prompt).toContain("warm, calm, friendly and non-judgmental");
        expect(prompt).toContain("explain the idea, show how it is used");
        expect(prompt).toContain("Preserve exact class quotations");
        expect(prompt).toContain("Never claim complete knowledge of the learner, proven mastery");
        expect(prompt).toContain("Aim below 4608");
        expect(prompt).toContain("at most 4 complete production items");
      }
    },
  );

  it.each([
    undefined,
    { version: 1 as const },
    { version: 1 as const, declaredLevel: "not_sure" as const, goal: "none" as const },
  ])("does not infer unknown level or goal from sources: %j", (context) => {
    const prompt = personalisedTeachingPrompt(context);
    expect(prompt).toContain("without guessing or assigning a level");
    expect(prompt).toContain("do not infer an exam or personal goal");
  });

  it.each(["esol", "general"] as const)(
    "uses the declared %s goal only for relevant new examples",
    (goal) => {
      const prompt = personalisedTeachingPrompt({ version: 1, declaredLevel: "A2", goal });
      expect(prompt).toContain(
        goal === "esol" ? "declared ESOL goal" : "declared general-English goal",
      );
      expect(prompt).toContain("when space is tight, prefer fewer complete teaching points");
    },
  );
});

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
