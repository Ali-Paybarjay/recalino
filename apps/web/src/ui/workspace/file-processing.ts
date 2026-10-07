import type { AutomaticLearningStatus } from "./automatic-learning";

interface ProcessingSource {
  assetId: string;
  displayName: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
  uploadState: string | null;
}

const operatorErrors = [
  "provider_outcome_unresolved",
  "provider_outcome_unknown",
  "provider_timestamps_invalid",
  "provider_http_400",
  "provider_request_schema_too_complex",
  "provider_schema_unsupported",
];

export interface FileProcessingReceipt {
  revision: number | null;
  previousRunId: string | null;
  confirmedRunId?: string | null;
  sourceIds: string[];
  total: number;
  failed: number;
  startedAt: number;
  problem?: string;
}

export function fileProcessingFeedback(
  receipt: FileProcessingReceipt,
  status: AutomaticLearningStatus | null,
  sources: ProcessingSource[],
): { state: "processing" | "success" | "error"; message: string; detail: string; retry?: boolean } {
  if (receipt.problem)
    return {
      state: "error",
      message: "Upload needs attention.",
      detail: receipt.problem,
    };
  if (receipt.failed)
    return {
      state: "error",
      message: `${receipt.failed} ${receipt.failed === 1 ? "file could" : "files could"} not be uploaded.`,
      detail:
        "Check the messages beside the selected files, then retry the remaining files. Files already uploaded are saved; their processing continues.",
    };
  const uploaded = sources.filter((source) => receipt.sourceIds.includes(source.assetId));
  const rejected = uploaded.find(
    (source) => source.rejectionReason || source.uploadState === "rejected",
  );
  if (rejected)
    return {
      state: "error",
      message: "A file needs attention before processing can finish.",
      detail: ["needs_password", "wrong_password"].includes(rejected.rejectionReason ?? "")
        ? `Enter the correct password for ${rejected.displayName} in Class sources below. Processing resumes after verification.`
        : `Review ${rejected.displayName} in Class sources below. Remove or replace the rejected file, then retry processing.`,
    };
  const current =
    receipt.revision !== null && status && status.revision >= receipt.revision && !status.batchId;
  if (current && status.state === "blocked")
    return {
      state: "error",
      message: "Processing needs attention.",
      detail: processingRecovery(status),
      retry:
        !operatorErrors.includes(status.lastError ?? "") &&
        !/operator|provider.*configur|storage_unavailable|allowance|quota|password|rejected|acceptance_required|upload_needs_attention|no_selected|select_at_least_one|selection_too_large/.test(
          status.lastError ?? "",
        ),
    };
  // A completed old run can briefly be returned while new, unselected files are verifying.
  // Require both the submitted sources and a fresh run before confirming full success.
  if (
    current &&
    status.state === "ready" &&
    uploaded.length === receipt.sourceIds.length &&
    uploaded.length > 0 &&
    uploaded.every((source) => source.verifiedAt) &&
    status.run &&
    (status.run.id !== receipt.previousRunId || status.run.id === receipt.confirmedRunId)
  ) {
    if (status.run.state === "partial_ready")
      return {
        state: "error",
        message: "Processing completed with some issues.",
        detail:
          "Some material could not be processed. Your available notes are saved. Review the sources and processing details before retrying.",
      };
    if (status.run.state === "ready" && status.notesReady && status.cardsReady)
      return {
        state: "success",
        message: "Processing successful.",
        detail: `${receipt.total} ${receipt.total === 1 ? "file has" : "files have"} been uploaded and processed. Your class notes and flashcards are ready.`,
      };
  }
  return {
    state: "processing",
    message:
      current && status.state === "processing"
        ? "Processing your files…"
        : "Verifying and preparing your files…",
    detail:
      "Large files and audio can take several minutes. Progress updates automatically, and a confirmation appears when processing finishes.",
  };
}

function processingRecovery(status: AutomaticLearningStatus) {
  const code = status.lastError ?? "";
  if (/allowance|quota/.test(code))
    return `${status.message} Your files are saved. Review your allowance or select less material before retrying.`;
  if (operatorErrors.includes(code) || /operator|provider.*configur|storage_unavailable/.test(code))
    return `${status.message} Your files are saved. Processing can continue when the service is available.`;
  if (/selection_too_large/.test(code))
    return `${status.message} Select fewer files or smaller ranges in Class sources, then retry.`;
  if (/no_selected|select_at_least_one/.test(code))
    return `${status.message} Select verified material in Class sources before retrying.`;
  if (code === "acceptance_required")
    return `${status.message} Review and accept the required material notices before processing.`;
  if (code === "upload_needs_attention")
    return `${status.message} Check the file errors in Class sources below. Replace rejected files or enter the PDF password to continue.`;
  return `${status.message} Your files are saved. Review the processing details or retry processing; you do not need to upload them again.`;
}
