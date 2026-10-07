import { describe, expect, it } from "vitest";
import { automaticLearningMessage } from "./automatic-learning";

describe("automatic creation recovery guidance", () => {
  it.each(["provider_http_400", "provider_request_schema_too_complex"])(
    "explains %s as a service request failure without asking for duplicate uploads",
    (code) => {
      const message = automaticLearningMessage("blocked", code);
      expect(message).toContain("AI service rejected");
      expect(message).toContain("needs a fix before retrying");
      expect(message).toContain("do not need to upload the same files again");
    },
  );

  it("does not promise automatic retry for an uncertain paid outcome", () => {
    expect(automaticLearningMessage("blocked", "provider_outcome_unknown")).toContain(
      "Contact the operator before retrying",
    );
  });
});
