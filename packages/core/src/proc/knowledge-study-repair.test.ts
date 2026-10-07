import { describe, expect, it } from "vitest";
import { type KnowledgeModel, validateKnowledgeModel } from "../lkm";
import { buildKnowledgeStudyRepairInput } from "./knowledge-study-repair";

function model(
  fullSentence = "The council clamped down on unsafe parking near schools.",
): KnowledgeModel {
  return {
    schemaVersion: "1",
    title: "Synthetic vocabulary",
    language: { learning: "en", explanation: "fa" },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    learningItems: [
      {
        id: "item-1",
        kind: "expression",
        front: "clamp down on (sth/sb)",
        back: "سخت‌گیری کردن",
        claim: {
          id: "claim-1",
          text: "این یک نمونهٔ آموزشی است.",
          origin: "ai_expansion",
          creation: "ai_generation",
          evidence: "ai",
          sourceRefs: [],
          speakerRole: "unknown",
          uncertain: false,
        },
        study: {
          set: "production",
          en: "clamp down on (sth/sb)",
          faMeaning: "سخت‌گیری کردن",
          topic: "rules",
          ipa: "/klæmp daʊn ɒn/",
          faApprox: "کلمپ داون آن",
          gapSentence: "They will ______ something quite different.",
          fullSentence,
          collocations: [],
          noteFa: "برای اجرای سخت‌گیرانهٔ قانون استفاده می‌شود.",
          imageFa: "درِ بسته را تصور کن.",
          sourceFa: "نمونهٔ آموزشی",
        },
      },
    ],
  };
}
const answer = (...answerParts: string[]) => ({ items: [{ itemId: "item-1", answerParts }] });

describe("bounded production sentence repair", () => {
  it("repairs an inflected target while preserving every original field except its gap", () => {
    const original = model();
    const before = structuredClone(original);
    expect(() => validateKnowledgeModel(original, [], "fa")).toThrow();
    const repair = buildKnowledgeStudyRepairInput(original, 10000);
    expect(JSON.parse(repair.input)).toEqual({
      format: "study_answer_parts_v1",
      items: [
        {
          itemId: "item-1",
          target: "clamp down on (sth/sb)",
          fullSentence: "The council clamped down on unsafe parking near schools.",
        },
      ],
    });
    const fixed = repair.apply(answer("clamped down on"));
    expect(fixed.learningItems[0]?.study).toMatchObject({
      gapSentence: "The council ______ unsafe parking near schools.",
      fullSentence: "The council clamped down on unsafe parking near schools.",
    });
    const expected = structuredClone(before);
    if (expected.learningItems[0]?.study?.set === "production")
      expected.learningItems[0].study.gapSentence =
        "The council ______ unsafe parking near schools.";
    expect(fixed).toEqual(expected);
    expect(original).toEqual(before);
    expect(() => validateKnowledgeModel(fixed, [], "fa")).not.toThrow();
  });

  it("handles genuine separated phrases and counts only whole-word occurrences", () => {
    const repair = buildKnowledgeStudyRepairInput(model("He put the cup up on a shelf."), 10000);
    const fixed = repair.apply(answer("put", "up"));
    expect(fixed.learningItems[0]?.study).toMatchObject({
      gapSentence: "He ______ the cup ______ on a shelf.",
    });
  });

  it("requires exactly the requested IDs and rejects metadata or sentence replacements", () => {
    const repair = buildKnowledgeStudyRepairInput(model(), 10000);
    for (const invalid of [
      { items: [] },
      { items: [{ itemId: "other", answerParts: ["clamped down on"] }] },
      { items: [answer("clamped down on").items[0], answer("clamped down on").items[0]] },
      { items: [{ ...answer("clamped down on").items[0], fullSentence: "Changed sentence." }] },
      { ...answer("clamped down on"), sourceRefs: [] },
    ])
      expect(() => repair.apply(invalid)).toThrowError(
        expect.objectContaining({
          details: { fields: { output: ["study_repair_keyset_invalid"] } },
        }),
      );
  });

  it.each([
    ["He put it up and put it down.", ["put"]],
    ["They clamped down on parking.", ["clamp"]],
    ["They clamped down on parking.", ["Clamped"]],
    ["They clamped down on parking.", ["clamped", "down on"]],
    ["They clamped down on parking.", ["clamped down", "down on"]],
    ["They clamped down on parking.", ["parking", "clamped"]],
    ["They clamped down on parking.", ["They clamped down on parking."]],
    ["They clamped down on parking.", [" clamped"]],
    ["They clamped down on parking.", ["missing"]],
    ["They cannot change road-users' plans.", ["road"]],
    ["The road\u2010users have new plans.", ["road"]],
    ["The road\u2011users have new plans.", ["road"]],
    ["They can't change the plans.", ["can"]],
    ["A cafe\u0301 sells coffee.", ["cafe"]],
    ["The 😀word is visible here.", ["\ude00word"]],
    ["The 😀\ufe0fword is visible here.", ["\ufe0fword"]],
  ])("rejects ambiguous, invented or partial answers in %s", (sentence, parts) => {
    const repair = buildKnowledgeStudyRepairInput(model(sentence as string), 10000);
    expect(() => repair.apply(answer(...parts))).toThrowError(
      expect.objectContaining({ details: { fields: { output: ["study_repair_answer_invalid"] } } }),
    );
  });

  it("preserves Unicode context and does not split complete accented words", () => {
    const repair = buildKnowledgeStudyRepairInput(model("😀 A café serves fresh coffee."), 10000);
    expect(repair.apply(answer("café")).learningItems[0]?.study).toMatchObject({
      fullSentence: "😀 A café serves fresh coffee.",
      gapSentence: "😀 A ______ serves fresh coffee.",
    });
  });

  it("does not dispatch for valid gaps, grammar tasks or an already blanked full sentence", () => {
    const valid = model();
    const study = valid.learningItems[0]?.study;
    if (study?.set !== "production") throw new Error("Fixture missing study");
    study.gapSentence = "The council ______ unsafe parking near schools.";
    expect(() => buildKnowledgeStudyRepairInput(valid, 10000)).toThrow();
    study.gapSentence = "A different ______ sentence.";
    study.kind = "grammar";
    expect(() => buildKnowledgeStudyRepairInput(valid, 10000)).toThrow();
    delete study.kind;
    study.fullSentence = "An already ______ sentence.";
    expect(() => buildKnowledgeStudyRepairInput(valid, 10000)).toThrow();
  });
});
