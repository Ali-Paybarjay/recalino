import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
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
