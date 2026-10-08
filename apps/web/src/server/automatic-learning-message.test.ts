import { describe, expect, it } from "vitest";
import { automaticLearningMessage } from "./automatic-learning";

describe("automatic creation recovery guidance", () => {
  it.each([
    "processing_budget_session",
    "processing_budget_user_month",
    "processing_budget_system_day",
    "processing_budget_system_month",
    "service_processing_paused",
    "service_cost_policy_missing",
    "service_cost_unknown",
    "service_reservation_missing",
    "service_processing_blocked",
  ])("directs %s to operator help without blaming learner allowance", (code) => {
    const message = automaticLearningMessage("blocked", code);
    expect(message).toContain("pilot operator");
    expect(message).toContain("material is saved");
    expect(message).toContain("do not need to upload the same files again");
    expect(message).not.toContain("More allowance is needed");
  });

  it("keeps learner-unit shortage guidance separate from AI spending", () => {
    expect(automaticLearningMessage("blocked", "quota_insufficient")).toContain(
      "More allowance is needed",
    );
    expect(automaticLearningMessage("blocked", "processing_budget_session")).toContain(
      "class's AI spending limit",
    );
  });

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
