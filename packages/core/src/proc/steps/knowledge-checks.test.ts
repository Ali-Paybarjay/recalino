import { describe, expect, it } from "vitest";
import { AppError, errors } from "../../plt";
import { processingFailureCode, semanticRepairReason } from "./knowledge-checks";

// QUA-01 characterization: the failure codes a run records, unchanged by the stage split.
const output = (code: string) => errors.validationFailed({ output: [code] });

describe("semanticRepairReason", () => {
  it("names only a single code-owned repairable problem", () => {
    expect(semanticRepairReason(output("study_sentence_mismatch"))).toBe("study_sentence_mismatch");
    expect(semanticRepairReason(output("language_script_mismatch"))).toBe(
      "language_script_mismatch",
    );
    expect(semanticRepairReason(output("knowledge_repair_exhausted"))).toBeNull();
    expect(
      semanticRepairReason(errors.validationFailed({ output: ["language_mismatch", "x"] })),
    ).toBeNull();
    expect(semanticRepairReason(errors.conflict())).toBeNull();
    expect(semanticRepairReason(new Error("language_mismatch"))).toBeNull();
  });
});

describe("processingFailureCode", () => {
  it("keeps quota, semantic, allow-listed and repair diagnostics, and nothing else", () => {
    expect(processingFailureCode(new AppError("quota_insufficient"))).toBe("quota_insufficient");
    expect(processingFailureCode(output("source_reference_invalid"))).toBe(
      "output_source_reference_invalid",
    );
    expect(
      processingFailureCode(errors.validationFailed({ sources: ["no_extractable_content"] })),
    ).toBe("no_extractable_content");
    expect(processingFailureCode(errors.validationFailed({ pdf: ["page_manifest_invalid"] }))).toBe(
      "page_manifest_invalid",
    );
    expect(processingFailureCode(output("translation_keyset_invalid"))).toBe(
      "output_translation_keyset_invalid",
    );
    expect(processingFailureCode(output("knowledge_repair_exhausted"))).toBe(
      "knowledge_repair_exhausted",
    );
    expect(processingFailureCode(errors.validationFailed({ source: ["free text"] }))).toBeNull();
    expect(processingFailureCode(errors.conflict())).toBeNull();
  });
});
