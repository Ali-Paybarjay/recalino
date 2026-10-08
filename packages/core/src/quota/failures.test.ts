import { describe, expect, it } from "vitest";
import { errors } from "../plt";
import { quotaProcessingFailureCode } from "./failures";

describe("processing cost guard diagnostics", () => {
  it.each([
    ["session", "processing_budget_session"],
    ["userMonth", "processing_budget_user_month"],
    ["systemDay", "processing_budget_system_day"],
    ["systemMonth", "processing_budget_system_month"],
  ])("preserves the separate %s service budget", (scope, code) => {
    expect(
      quotaProcessingFailureCode(errors.quotaInsufficient({ reason: "cost_limit", scope })),
    ).toBe(code);
  });

  it.each([
    ["cost_policy_missing", "service_cost_policy_missing"],
    ["processing_paused", "service_processing_paused"],
    ["provider_cost_unknown", "service_cost_unknown"],
    ["reservation_missing", "service_reservation_missing"],
  ])("preserves the %s service guard", (reason, code) => {
    expect(quotaProcessingFailureCode(errors.quotaInsufficient({ reason }))).toBe(code);
  });

  it("keeps learner-unit shortages and old reason-free errors distinct", () => {
    expect(
      quotaProcessingFailureCode(
        errors.quotaInsufficient({
          required: { document: 2 },
          remaining: { document: 1 },
        }),
      ),
    ).toBe("quota_insufficient");
    expect(quotaProcessingFailureCode(errors.quotaInsufficient())).toBe("quota_insufficient");
    expect(quotaProcessingFailureCode(errors.notFound())).toBeNull();
  });

  it.each([
    { reason: "cost_limit", scope: "untrusted provider text" },
    { reason: "cost_limit" },
    { reason: "constructor" },
    { reason: ["provider_cost_unknown"] },
  ])("uses neutral guidance for unrecognized diagnostics %j", (details) => {
    expect(quotaProcessingFailureCode(errors.quotaInsufficient(details))).toBe(
      "service_processing_blocked",
    );
  });
});
