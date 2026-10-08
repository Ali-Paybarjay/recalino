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
  "selection_too_large",
  "no_selected_sources",
  "select_at_least_one",
  "not_verified",
]);

export function isServiceProcessingBlock(code: string | null) {
  return serviceBlocks.has(code ?? "");
}

export function automaticLearningRecovery(status: AutomaticLearningStatus | null): {
  kind: "allowance" | "service" | "material" | "setup" | null;
  retryLabel: string | null;
} {
  const code = status?.lastError ?? "";
  const blocked = status?.state === "blocked";
  if (code === "quota_insufficient")
    return { kind: "allowance", retryLabel: blocked ? "Retry after allowance changes" : null };
  if (isServiceProcessingBlock(code) || unavailableService.has(code))
    return { kind: "service", retryLabel: blocked ? "Retry after service update" : null };
  if (uncertainProviderResults.has(code) || rejectedServiceRequests.has(code))
    return { kind: "service", retryLabel: null };
  if (materialProblems.has(code)) return { kind: "material", retryLabel: null };
  if (code === "acceptance_required") return { kind: "setup", retryLabel: null };
  if (code === "upload_batch_cancelled") return { kind: "material", retryLabel: null };
  return { kind: null, retryLabel: blocked ? "Retry failed attempt" : null };
}
