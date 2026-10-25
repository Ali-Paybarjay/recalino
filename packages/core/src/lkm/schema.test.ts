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

it.each([
  {
    en: "kit out (separable phrasal verb)",
    gapSentence: "We need to ______ it ______ before our next class.",
    fullSentence: "We need to kit it out before our next class.",
    exposed: "We need to kit ______ out before our next class.",
  },
  {
    en: "gig (noun)",
    gapSentence: "She has a ______ at the pub on Saturday.",
    fullSentence: "She has a gig at the pub on Saturday.",
    exposed: "She has a gig at the ______ on Saturday.",
  },
  {
    en: "donkey's years (noun phrase)",
    gapSentence: "We have lived here for ______ without any problems.",
    fullSentence: "We have lived here for donkey's years without any problems.",
    exposed: "We have lived here for donkey's years without any ______.",
  },
  {
    en: "somebody (pronunciation)",
    gapSentence: "______ left an umbrella on the bus.",
    fullSentence: "Somebody left an umbrella on the bus.",
    exposed: "Somebody left an ______ on the bus.",
  },
])("validates the paid dictionary label $en without exposing its lexical answer", (fields) => {
  const valid = lexicalFrameModel(fields);
  expect(validateKnowledgeModel(valid, [], "en").learningItems).toHaveLength(1);
  const exposed = lexicalFrameModel({ ...fields, gapSentence: fields.exposed });
  expect(() => validateKnowledgeModel(exposed, [], "en")).toThrowError(
    expect.objectContaining({ details: { fields: { output: ["study_answer_exposed"] } } }),
  );
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

it("AC-D46-04 stores the words a grammar IPA transcribes and keeps older grammar revisions valid", () => {
  const grammar = (fields: { ipaText?: string; kind?: "grammar" | "collocation" } = {}) => {
    const value = lexicalFrameModel({ en: "present simple questions" });
    const item = value.learningItems[0];
    if (item?.study?.set !== "production") throw new Error("Missing grammar fixture");
    const { gapSentence: _gap, ...study } = item.study;
    item.kind = "grammar";
    item.study = {
      ...study,
      kind: fields.kind ?? "grammar",
      ipa: "/dʌz ʃi wɔːk/",
      ...(fields.ipaText === undefined ? {} : { ipaText: fields.ipaText }),
      taskFa: "Make a question from the statement.",
      prompt: "Make a question: She walks to school every day.",
      fullSentence: "Does she walk to school every day?",
    };
    return value;
  };
  const rejected = (value: KnowledgeModel) => {
    expect(() => validateKnowledgeModel(value, [], "en")).toThrow(
      expect.objectContaining({ details: { fields: { output: ["schema_invalid"] } } }),
    );
  };
  // Older stored revisions never had the field and stay valid unchanged.
  const legacy = validateKnowledgeModel(grammar(), [], "en").learningItems[0]?.study;
  expect(legacy).toMatchObject({ kind: "grammar", ipa: "/dʌz ʃi wɔːk/" });
  expect(legacy).not.toHaveProperty("ipaText");
  for (const ipaText of [
    "Does she walk",
    "Yes, she does",
    "does not walk to school every",
    // Shared symbols and a modifier-letter apostrophe belong to Latin-script text.
    "It costs £5",
    "is 20°C",
    "She doesnʼt walk",
  ])
    expect(
      validateKnowledgeModel(grammar({ ipaText }), [], "en").learningItems[0]?.study,
    ).toMatchObject({ ipaText });
  for (const ipaText of [
    "",
    " Does she walk",
    "does she walk to school every day",
    "آیا او راه می‌رود",
    "彼女は歩きますか",
    "Does she walk コーヒー",
    "Does she <b>walk</b>",
    "Does she walk &amp; talk",
    "/dʌz ʃi wɔːk/",
    // A task's blank, cue brackets or option slash are never words the IPA transcribes.
    "She ______ (walk",
    "walk) to the",
    "She walks / walk",
    "Does [she] walk",
  ])
    rejected(grammar({ ipaText }));
  // Lexical IPA transcribes en itself, so only a grammar item may name transcribed words.
  rejected(grammar({ ipaText: "Does she walk", kind: "collocation" }));
  const lexical = lexicalFrameModel();
  const item = lexical.learningItems[0];
  if (item?.study?.set !== "production") throw new Error("Missing lexical fixture");
  item.study.ipaText = "look forward to";
  rejected(lexical);
});

it("D78 keeps up to 25 production cards in one class and rejects the 26th", () => {
  const cards = (count: number): KnowledgeModel => {
    const value = lexicalFrameModel();
    const [card] = value.learningItems;
    if (!card) throw new Error("Missing fixture card");
    value.learningItems = Array.from({ length: count }, (_, index) => ({
      ...card,
      id: `card-${index}`,
      claim: { ...card.claim, id: `card-claim-${index}` },
    }));
    return value;
  };
  expect(validateKnowledgeModel(cards(25), [], "en").learningItems).toHaveLength(25);
  expect(() => validateKnowledgeModel(cards(26), [], "en")).toThrow(
    expect.objectContaining({ details: { fields: { output: ["study_core_limit"] } } }),
  );
});

it.each([
  {
    en: "someone else",
    gapSentence: "If you are busy, I can ask ______, or else we can wait.",
    fullSentence: "If you are busy, I can ask someone else, or else we can wait.",
    exposed: "If you are busy, I can ask someone else, or ______ we can wait.",
  },
  {
    en: "something like that",
    gapSentence: "If you'd like that, we can paint it blue or ______.",
    fullSentence: "If you'd like that, we can paint it blue or something like that.",
    exposed: "If you'd like ______, we can paint it blue or something like that.",
  },
  {
    en: "do something about sth",
    gapSentence: "What do you think about it? We must ______ the noise.",
    fullSentence: "What do you think about it? We must do something about the noise.",
    exposed: "What do you think about ______? We must do something about the noise.",
  },
])("AC-D46-01 validates the literal pronoun phrase $en by its whole target", (fields) => {
  // The leftover chunk alone (else / like that / do … about) is not the answer.
  const { exposed, ...valid } = fields;
  expect(validateKnowledgeModel(lexicalFrameModel(valid), [], "en").learningItems).toHaveLength(1);
  let failure: unknown;
  try {
    validateKnowledgeModel(lexicalFrameModel({ ...valid, gapSentence: exposed }), [], "en");
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ details: { fields: { output: ["study_answer_exposed"] } } });
});
