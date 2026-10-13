import type { AutomaticLearningStatus } from "./automatic-learning";

const serviceBlocks = new Set([
  "processing_budget_session",
  "processing_budget_user_month",
  "processing_budget_system_day",
  "processing_budget_system_month",
  "service_processing_blocked",
  "service_processing_paused",
  "service_cost_policy_missing",
  "service_cost_unknown",
  "service_reservation_missing",
]);
const uncertainProviderResults = new Set([
  "provider_outcome_unresolved",
  "provider_outcome_unknown",
  "provider_timestamps_invalid",
]);
const rejectedServiceRequests = new Set([
  "provider_http_400",
  "provider_request_schema_too_complex",
  "provider_schema_unsupported",
]);
const unavailableService = new Set([
  "configuration_unavailable",
  "storage_unavailable",
  "settings_changed",
]);
const materialProblems = new Set([
  "upload_needs_attention",
  // The verifier refused the audio itself: the same file would be refused again, so the next
  // step is to replace or deselect it, never a retry (2026-10-13 audit).
  "audio_upload_rejected",
  "selection_too_large",
  "no_selected_sources",
  "select_at_least_one",
  "not_verified",
]);

export function isServiceProcessingBlock(code: string | null) {
  return serviceBlocks.has(code ?? "");
}

/**
 * Which learner-allowance stop this is (FR-QUOTA-007): still short, no active allowance at all, or
 * an allowance that now covers the class. A stop without amounts is treated as short.
 */
export type AllowanceBlock = "shortage" | "none" | "covered";
export function allowanceBlock(status: AutomaticLearningStatus | null): AllowanceBlock | null {
  if (status?.lastError !== "quota_insufficient") return null;
  const allowance = status.allowance;
  if (!allowance) return "shortage";
  if (!allowance.active) return "none";
  return Object.entries(allowance.required).every(
    ([dimension, needed]) =>
      needed <= (allowance.available[dimension as keyof typeof allowance.available] ?? 0),
  )
    ? "covered"
    : "shortage";
}

/**
 * Whether selecting less material can end a shortage: it lowers class audio and pages, never the
 * new version a class with published notes needs. Unknown amounts may be either.
 */
function lessMaterialHelps(status: AutomaticLearningStatus | null) {
  const allowance = status?.allowance;
  if (!allowance) return true;
  return (["audio", "document"] as const).some(
    (dimension) => allowance.required[dimension] > allowance.available[dimension],
  );
}

export function automaticLearningRecovery(status: AutomaticLearningStatus | null): {
  kind: "allowance" | "service" | "material" | "setup" | null;
  allowance: AllowanceBlock | null;
  /** For a shortage, whether "select less material" can help. */
  lessMaterial: boolean;
  retryLabel: string | null;
} {
  const code = status?.lastError ?? "";
  const blocked = status?.state === "blocked";
  const allowance = allowanceBlock(status);
  // An allowance that now covers the class needs only a retry. One known to be short or missing
  // would only stop again, so its retry appears once the allowance covers the class (the status
  // is read again while the page is open). Unknown amounts keep the conditional retry.
  if (allowance)
    return {
      kind: "allowance",
      allowance,
      lessMaterial: allowance === "shortage" && lessMaterialHelps(status),
      retryLabel: !blocked
        ? null
        : allowance === "covered"
          ? "Retry processing"
          : status?.allowance
            ? null
            : "Retry after allowance changes",
    };
  if (isServiceProcessingBlock(code) || unavailableService.has(code))
    return {
      kind: "service",
      allowance: null,
      lessMaterial: false,
      retryLabel: blocked ? "Retry after service update" : null,
    };
  if (uncertainProviderResults.has(code) || rejectedServiceRequests.has(code))
    return { kind: "service", allowance: null, lessMaterial: false, retryLabel: null };
  if (materialProblems.has(code))
    return { kind: "material", allowance: null, lessMaterial: false, retryLabel: null };
  if (code === "acceptance_required")
    return { kind: "setup", allowance: null, lessMaterial: false, retryLabel: null };
  if (code === "upload_batch_cancelled")
    return { kind: "material", allowance: null, lessMaterial: false, retryLabel: null };
  return {
    kind: null,
    allowance: null,
    lessMaterial: false,
    retryLabel: blocked ? "Retry failed attempt" : null,
  };
}
