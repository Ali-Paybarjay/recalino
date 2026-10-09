import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { lexicalFrameModel } from "../../test/lexical-frame-fixture";
import {
  type EvidenceSource,
  type KnowledgeModel,
  matchesExplanationScript,
  validateKnowledgeModel,
} from "./schema";

const source: EvidenceSource = {
  sourceId: randomUUID(),
  contentVersionId: randomUUID(),
  kind: "pdf",
  units: [{ id: "p1", kind: "page", start: 1 }],
  blocks: [{ id: "b1", text: "Present perfect", unitId: "p1" }],
};
function model(): KnowledgeModel {
  return {
    schemaVersion: "1",
    title: "Class",
    language: { learning: "en", explanation: "en" },
    summary: [
      {
        id: "c1",
        text: "Present perfect",
        origin: "from_class",
        creation: "ai_generation",
        evidence: "material",
        sourceRefs: [
          {
            sourceId: source.sourceId,
            contentVersionId: source.contentVersionId ?? "",
            locator: { kind: "page", page: 1, blockId: "b1" },
          },
        ],
        speakerRole: "unknown",
        uncertain: false,
      },
    ],
    topics: [],
    learningItems: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
  };
}
function firstClaim(value: KnowledgeModel) {
  const claim = value.summary[0];
  if (!claim) throw new Error("Missing fixture claim");
  return claim;
}
function firstReference(value: KnowledgeModel) {
  const reference = firstClaim(value).sourceRefs[0];
  if (!reference) throw new Error("Missing fixture reference");
  return reference;
}
describe("PRD-LKM-01..07 and AC-08..10 evidence validation", () => {
  it("accepts valid material evidence but rejects missing and out-of-range references", () => {
    expect(validateKnowledgeModel(model(), [source], "en")).toEqual(model());
    const missing = model();
    firstClaim(missing).sourceRefs = [];
    expect(() => validateKnowledgeModel(missing, [source], "en")).toThrow();
    const outside = model();
    firstReference(outside).locator = { kind: "page", page: 4, blockId: null };
    expect(() => validateKnowledgeModel(outside, [source], "en")).toThrow();
    const foreign = model();
    firstReference(foreign).sourceId = randomUUID();
    expect(() => validateKnowledgeModel(foreign, [source], "en")).toThrow();
  });
  it("never turns PDF content into teacher attribution and preserves AI expansion provenance", () => {
    const teacher = model();
    firstClaim(teacher).speakerRole = "teacher";
    expect(() => validateKnowledgeModel(teacher, [source], "en")).toThrow();
    const ai = model();
    const claim = firstClaim(ai);
    claim.origin = "ai_expansion";
    claim.evidence = "ai";
    claim.sourceRefs = [];
    expect(validateKnowledgeModel(ai, [source], "en").summary[0]?.origin).toBe("ai_expansion");
    claim.speakerRole = "teacher";
    expect(() => validateKnowledgeModel(ai, [source], "en")).toThrow();
  });
  it("rejects unconfirmed speaker roles, corrupt coverage and clear explanation script mismatches", () => {
    const audio: EvidenceSource = {
      ...source,
      kind: "audio",
      units: [{ id: "t1", kind: "time", start: 0, end: 1000 }],
      blocks: [{ id: "b1", text: "Present perfect", unitId: "t1", speakerRole: "unknown" }],
    };
    const teacher = model();
    firstClaim(teacher).speakerRole = "teacher";
    firstClaim(teacher).evidence = "audio";
    firstReference(teacher).locator = { kind: "time", startMs: 0, endMs: 1000 };
    expect(() => validateKnowledgeModel(teacher, [audio], "en")).toThrow();
    const partial = model();
    partial.coverage.missingSourceIds = [source.sourceId];
    expect(() => validateKnowledgeModel(partial, [source], "en")).toThrow();
    const wrongLanguage = model();
    wrongLanguage.language.explanation = "fa";
    expect(() => validateKnowledgeModel(wrongLanguage, [source], "fa")).toThrow();
    expect(matchesExplanationScript("توضیح فارسی", "fa")).toBe(true);
    expect(matchesExplanationScript("中文", "zh")).toBe(true);
  });
});

it("AC-D46-01 rejects an exposed lexical target hidden by grammatical complement notation", () => {
  for (const en of [
    "look forward to + -ing / noun",
    "look forward to + noun or -ing",
    "get on with + person",
  ]) {
    const value = lexicalFrameModel(
      en.startsWith("get")
        ? {
            en,
            gapSentence: "I get on with ______ in my new class.",
            fullSentence: "I get on with everyone in my new class.",
          }
        : { en, gapSentence: "I look forward to ______ my new neighbours." },
    );
    let failure: unknown;
    try {
      validateKnowledgeModel(value, [], "en");
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ details: { fields: { output: ["study_answer_exposed"] } } });
  }
  expect(validateKnowledgeModel(lexicalFrameModel(), [], "en").learningItems).toHaveLength(1);
});

it("AC-D46-01 preserves separable frames, rejects ambiguous notation, and leaves grammar tasks valid", () => {
  const separated = lexicalFrameModel({
    en: "kit sb/sth out",
    gapSentence: "We need to ______ it ______ before our next class.",
    fullSentence: "We need to kit it out before our next class.",
  });
  expect(validateKnowledgeModel(separated, [], "en").learningItems).toHaveLength(1);
  const exposed = lexicalFrameModel({
    en: "kit sb/sth out",
    gapSentence: "We need to kit ______ out before our next class.",
    fullSentence: "We need to kit it out before our next class.",
  });
  expect(() => validateKnowledgeModel(exposed, [], "en")).toThrow();
  const unsupported = lexicalFrameModel({ en: "look forward to + mystery" });
  let failure: unknown;
  try {
    validateKnowledgeModel(unsupported, [], "en");
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ details: { fields: { output: ["study_target_unsupported"] } } });
  const grammar = lexicalFrameModel({ en: "have/has + past participle" });
  const item = grammar.learningItems[0];
  if (item?.study?.set !== "production") throw new Error("Missing grammar fixture");
  item.kind = "grammar";
  item.study = {
    ...item.study,
    kind: "grammar",
    taskFa: "Complete the sentence with the present perfect.",
    prompt: "She ... this film twice this week.",
    fullSentence: "She has seen this film twice this week.",
  };
  expect(validateKnowledgeModel(grammar, [], "en").learningItems).toHaveLength(1);
});

it("AC-D46-01 accepts a taught indefinite pronoun as its own target and keeps slot-only notation unsupported", () => {
  const pronoun = {
    en: "somebody",
    gapSentence: "______ left an umbrella on the bus.",
    fullSentence: "Somebody left an umbrella on the bus.",
  };
  expect(validateKnowledgeModel(lexicalFrameModel(pronoun), [], "en").learningItems).toHaveLength(
    1,
  );
  const labelled = { ...pronoun, en: "somebody (pronunciation)" };
  expect(validateKnowledgeModel(lexicalFrameModel(labelled), [], "en").learningItems).toHaveLength(
    1,
  );
  for (const fields of [pronoun, labelled]) {
    const exposed = lexicalFrameModel({
      ...fields,
      gapSentence: "Somebody left an ______ on the bus.",
    });
    expect(() => validateKnowledgeModel(exposed, [], "en")).toThrow(
      expect.objectContaining({ details: { fields: { output: ["study_answer_exposed"] } } }),
    );
  }
  const frame = lexicalFrameModel({
    en: "remind somebody of something",
    gapSentence: "Please ______ me ______ the meeting.",
    fullSentence: "Please remind me of the meeting.",
  });
  expect(validateKnowledgeModel(frame, [], "en").learningItems).toHaveLength(1);
  for (const en of ["(somebody)", "sb", "sb/sth"]) {
    expect(() => validateKnowledgeModel(lexicalFrameModel({ ...pronoun, en }), [], "en")).toThrow(
      expect.objectContaining({ details: { fields: { output: ["study_target_unsupported"] } } }),
    );
  }
});
