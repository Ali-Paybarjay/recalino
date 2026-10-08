import type { AppError } from "../plt";

const budgetScopes = {
  session: "processing_budget_session",
  userMonth: "processing_budget_user_month",
  systemDay: "processing_budget_system_day",
  systemMonth: "processing_budget_system_month",
} as const;
const serviceReasons = {
  cost_policy_missing: "service_cost_policy_missing",
  processing_paused: "service_processing_paused",
  provider_cost_unknown: "service_cost_unknown",
  reservation_missing: "service_reservation_missing",
} as const;

/** Preserve our own cost guard diagnostics without persisting arbitrary exception details. */
export function quotaProcessingFailureCode(error: AppError): string | null {
  if (error.code !== "quota_insufficient") return null;
  const reason = error.details?.reason;
  // A learner-unit reservation reports required/remaining amounts, without a reason.
  if (reason === undefined) return "quota_insufficient";
  if (reason === "cost_limit") {
    const scope = error.details?.scope;
    return typeof scope === "string" && Object.hasOwn(budgetScopes, scope)
      ? budgetScopes[scope as keyof typeof budgetScopes]
      : "service_processing_blocked";
  }
  return typeof reason === "string" && Object.hasOwn(serviceReasons, reason)
    ? serviceReasons[reason as keyof typeof serviceReasons]
    : "service_processing_blocked";
}
