import { describe, expect, it } from "vitest";
import { assignGeneratedKnowledgeIds } from "./generated-identities";
import { type KnowledgeModel, modelClaims, validateKnowledgeModel } from "./schema";

describe("generated identities", () => {
  it("assigns unique content-based labels without changing evidence and retains strict raw validation", () => {
    const claim = {
      id: "reused",
      text: "A synthetic English explanation.",
      origin: "ai_expansion" as const,
      creation: "ai_generation" as const,
      evidence: "ai" as const,
      speakerRole: "unknown" as const,
      sourceRefs: [],
      uncertain: false,
    };
    const input: KnowledgeModel = {
      schemaVersion: "1",
      title: "Synthetic",
      language: { learning: "en", explanation: "en" },
      summary: [claim],
      topics: [{ id: "reused", title: "Synthetic", claims: [claim] }],
      learningItems: [
        {
          id: "reused",
          kind: "concept",
          front: "Synthetic question?",
          back: "Synthetic answer.",
          claim,
        },
      ],
      homework: [],
      uncertainties: [],
      coverage: { complete: true, missingSourceIds: [] },
    };
    expect(() => validateKnowledgeModel(input, [], "en")).toThrow();
    const result = assignGeneratedKnowledgeIds(input);
    expect(new Set(modelClaims(result).map((value) => value.id)).size).toBe(3);
    expect(validateKnowledgeModel(result, [], "en")).toEqual(result);
    expect(modelClaims(input).every((value) => value.id === "reused")).toBe(true);
    for (const value of modelClaims(result)) {
      const { id: _id, ...content } = value;
      const { id: _originalId, ...original } = claim;
      expect(content).toEqual(original);
    }
    expect(assignGeneratedKnowledgeIds(input)).toEqual(result);
    const changed = structuredClone(input);
    const summary = changed.summary[0];
    if (!summary) throw new Error("Expected summary fixture");
    summary.text = "A different synthetic fact.";
    expect(assignGeneratedKnowledgeIds(changed).summary[0]?.id).not.toBe(result.summary[0]?.id);
  });
});
