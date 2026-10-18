import { pendingCopy } from "../pending-copy";
import { retryAllowanceCopy } from "../retry-allowance-copy";
import type { AutomaticLearningStatus, AutomaticUploadProgress } from "./automatic-learning";
import { automaticLearningRecovery } from "./automatic-learning-recovery";
import type { UploadBatch, UploadEntry } from "./upload-store";

export type LearningStage = "upload" | "verify" | "process" | "ready";
export interface LearningProgressFile {
  id: string;
  displayName: string;
  sentBytes: number;
  totalBytes: number;
  percent: number | null;
  label: string;
  preparing: boolean;
}
export interface LearningProgress {
  stage: LearningStage;
  heading: string;
  guidance: string;
  active: boolean;
  preparing: boolean;
  needsMaterialReview: boolean;
  steps: {
    id: LearningStage;
    label: string;
    state: "complete" | "current" | "pending" | "blocked";
  }[];
  upload: {
    sentBytes: number;
    totalBytes: number;
    percent: number | null;
    files: LearningProgressFile[];
  } | null;
}

const stages: { id: LearningStage; label: string }[] = [
  { id: "upload", label: "Upload material" },
  { id: "verify", label: "Check files" },
  { id: "process", label: "Create notes & flashcards" },
  { id: "ready", label: "Ready" },
];

function bytes(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function transfer(sent: number, total: number) {
  const totalBytes = bytes(total);
  const sentBytes = Math.min(bytes(sent), totalBytes);
  return {
    sentBytes,
    totalBytes,
    percent: totalBytes > 0 ? Math.floor((sentBytes / totalBytes) * 100) : null,
  };
}

function batchFile(entry: UploadEntry): LearningProgressFile {
  const labels: Record<UploadEntry["phase"], string> = {
    queued: "Waiting to upload",
    checking: "Checking file before upload",
    uploading: "Uploading",
    saving: "Saving on this device",
    local_saved: "Saved on this device · upload pending",
    verifying: "Checking upload",
    complete: "Upload complete",
    failed: "Upload needs attention",
    skipped: "Skipped",
  };
  const progress = transfer(
    entry.phase === "local_saved" || entry.phase === "saving" ? 0 : entry.sentBytes,
    entry.sizeBytes,
  );
  return {
    id: entry.source?.assetId ?? entry.id,
    displayName: entry.displayName,
    // Saving audio to IndexedDB is not a transfer to the server.
    ...progress,
    percent: entry.phase === "checking" || entry.phase === "saving" ? null : progress.percent,
    label: labels[entry.phase],
    preparing: entry.phase === "checking",
  };
}

function currentBatch(status: AutomaticLearningStatus, batches: readonly UploadBatch[]) {
  if (status.batchId)
    return batches.find((batch) => batch.id === status.batchId && batch.phase !== "cancelled");
  // Closed batches persist on the device across later revisions. Their old 100%
  // must never become the apparent progress of a new upload.
  return batches
    .filter(
      (batch) =>
        batch.phase !== "cancelled" &&
        (batch.receipt.revision === status.revision ||
          (status.state === "idle" && batch.receipt.revision === null)),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

function blockedStage(status: AutomaticLearningStatus, batch: UploadBatch | undefined) {
  const code = status.lastError ?? status.run?.lastError ?? "";
  if (
    status.run?.state === "awaiting_upload" ||
    /audio_upload|upload_batch_cancelled/.test(code) ||
    (!status.run && batch?.entries.some((entry) => ["failed", "local_saved"].includes(entry.phase)))
  )
    return "upload";
  if (automaticLearningRecovery(status).kind === "material") return "verify";
  return "process";
}

function recoveryGuidance(status: AutomaticLearningStatus, termsAccepted: boolean) {
  const recovery = automaticLearningRecovery(status, termsAccepted);
  if (recovery.kind === "allowance") {
    if (recovery.allowance === "covered")
      return "Your allowance now covers this session. Choose Retry processing to continue with your saved material.";
    if (recovery.allowance === "none")
      return "Ask the pilot operator for an allowance, then retry using your saved material.";
    return recovery.lessMaterial
      ? "Ask for more allowance or open Review material to select less material, then retry."
      : "Ask for more allowance, then retry using your saved material.";
  }
  if (recovery.kind === "service")
    return status.processingReview?.requestedAt
      ? "Your review request is recorded. Follow its status in Processing review below."
      : "Open Processing review below for the next step.";
  if (recovery.kind === "material")
    return status.lastError === "upload_batch_cancelled"
      ? "Add a new group of files to continue."
      : "Open Review material and resolve the message for the affected file to continue.";
  if (recovery.kind === "setup") return pendingCopy.termsAcceptance.guidance;
  return `Retry this attempt to continue. ${retryAllowanceCopy(status)}`;
}

/** A stage timeline, with measured transfer bytes only; processing has no estimated percentage. */
export function learningProgress(
  status: AutomaticLearningStatus,
  batches: readonly UploadBatch[] = [],
  uploadProgress?: AutomaticUploadProgress | null,
  /** The learner has no new Terms waiting, so a stop for them is out of date (UX-09). */
  termsAccepted = false,
): LearningProgress {
  const batch = currentBatch(status, batches);
  const entries = batch?.entries.filter((entry) => entry.phase !== "skipped") ?? [];
  const audio =
    uploadProgress?.runId === status.run?.id &&
    (status.state === "waiting_upload" || status.state === "blocked")
      ? uploadProgress
      : null;
  const audioTransferred =
    !!audio?.files.length &&
    audio.files.every((file) => file.phase === "verifying" || file.phase === "complete");
  const batchTransferred =
    entries.length > 0 &&
    entries.every((entry) => entry.phase === "verifying" || entry.phase === "complete");
  const localAudioPending = entries.some((entry) => entry.phase === "local_saved");
  const ready = status.state === "ready";
  const needsMaterialReview =
    status.state !== "processing" &&
    !ready &&
    (batch?.phase === "attention" || entries.some((entry) => entry.phase === "failed"));
  const blocked = status.state === "blocked" || needsMaterialReview;
  const stage: LearningStage = needsMaterialReview
    ? "upload"
    : blocked
      ? blockedStage(status, batch)
      : ready
        ? "ready"
        : status.state === "processing"
          ? "process"
          : status.state === "waiting_upload"
            ? audioTransferred
              ? "verify"
              : "upload"
            : status.state === "waiting_sources"
              ? status.lastError === "batch_open" && !batchTransferred
                ? "upload"
                : status.lastError === "select_at_least_one"
                  ? "upload"
                  : "verify"
              : "upload";

  const preparingAudio =
    !!audio?.files.some((file) => file.phase === "checking") &&
    !audio.files.some((file) => file.phase === "uploading");
  const preparing =
    stage === "upload" &&
    !blocked &&
    (preparingAudio ||
      (!audio &&
        entries.some((entry) => entry.phase === "checking") &&
        !entries.some((entry) => entry.phase === "uploading")));
  const localWork = entries.some((entry) =>
    ["queued", "checking", "uploading", "saving", "verifying"].includes(entry.phase),
  );
  const idle =
    (status.state === "idle" || status.lastError === "select_at_least_one") && !localWork;
  const active = !idle && !blocked && !ready;
  let heading: string;
  let guidance: string;
  if (needsMaterialReview) {
    heading = "Your upload needs attention";
    guidance = "Open Review material and retry the affected file to continue.";
  } else if (blocked) {
    heading = "Your session needs attention";
    guidance = recoveryGuidance(status, termsAccepted);
  } else if (idle) {
    heading = "Add your session material";
    guidance = "Add documents, audio or photos to start creating notes and flashcards.";
  } else if (ready) {
    heading =
      status.run?.state === "partial_ready"
        ? "Your session is ready to review"
        : status.notesReady && status.cardsReady
          ? "Notes and flashcards are ready"
          : status.notesReady
            ? "Your session notes are ready"
            : status.cardsReady
              ? "Your flashcards are ready"
              : "Your session is ready to review";
    guidance =
      status.run?.state === "partial_ready"
        ? status.notesReady
          ? "Open your session notes to review the result and any material that could not be processed."
          : "Review the session result and any material that could not be processed."
        : status.notesReady && status.cardsReady
          ? "Open your session notes or flashcards to start reviewing."
          : status.notesReady
            ? "Open your session notes to start reviewing."
            : status.cardsReady
              ? "Open your flashcards to start reviewing."
              : "Return to your session to review the result.";
  } else if (stage === "upload") {
    heading = preparing
      ? preparingAudio
        ? "Preparing audio for upload"
        : "Preparing your files for upload"
      : "Uploading your material";
    guidance = preparing
      ? "Checking your files on this device before sending them. Larger files can take a little longer. Keep this app open; the upload starts automatically."
      : "Keep this device connected and this app open until the upload finishes.";
  } else if (stage === "verify") {
    heading = "Checking your files";
    guidance = localAudioPending
      ? "Files are being checked. Keep this device connected and this app open for the saved audio to upload."
      : "Your files are being checked automatically. Notes and flashcards will start when they are ready.";
  } else {
    heading =
      status.run?.state === "queued" ? "Waiting to process" : "Creating notes and flashcards";
    guidance =
      "You can leave this page. Processing continues automatically, and progress updates here.";
  }

  const cloudProcessing = status.state === "processing" || ready;
  const completedTransfer =
    cloudProcessing ||
    audioTransferred ||
    (batchTransferred && status.state !== "waiting_upload") ||
    (status.state === "waiting_sources" && stage === "verify" && !localAudioPending);
  // A quota/setup block can happen before local audio is uploaded. A stopped
  // stage alone is not evidence that earlier steps succeeded.
  const verified = cloudProcessing;
  const completed: Record<LearningStage, boolean> = {
    upload: completedTransfer,
    verify: verified,
    process: ready,
    ready,
  };

  let upload: LearningProgress["upload"] = null;
  if (
    !cloudProcessing &&
    !idle &&
    stage !== "process" &&
    (status.state !== "waiting_upload" || audio || localAudioPending)
  ) {
    const files = entries.map(batchFile);
    if (audio) {
      for (const file of audio.files) {
        const audioFile: LearningProgressFile = {
          id: file.sourceId,
          displayName: file.displayName,
          ...transfer(file.sentBytes, file.totalBytes),
          ...(file.phase === "checking" ? { percent: null } : {}),
          preparing: file.phase === "checking",
          label: {
            queued: "Waiting to upload",
            checking: "Checking audio before upload",
            uploading: "Uploading",
            verifying: "Checking upload",
            complete: "Upload complete",
          }[file.phase],
        };
        const index = files.findIndex((entry) => entry.id === file.sourceId);
        const existing = files[index];
        if (existing) files[index] = { ...audioFile, displayName: existing.displayName };
        else files.push(audioFile);
      }
    }
    if (files.length) {
      const totals = transfer(
        files.reduce((sum, file) => sum + file.sentBytes, 0),
        files.reduce((sum, file) => sum + file.totalBytes, 0),
      );
      upload = {
        ...totals,
        // Unknown file lengths make a combined percentage misleading.
        percent: !preparing && files.every((file) => file.totalBytes > 0) ? totals.percent : null,
        files,
      };
    }
  }

  return {
    stage,
    heading,
    guidance,
    active,
    preparing,
    needsMaterialReview,
    steps: stages.map((step) => ({
      ...step,
      state:
        blocked && step.id === stage
          ? "blocked"
          : completed[step.id]
            ? "complete"
            : !idle && step.id === stage
              ? "current"
              : "pending",
    })),
    upload,
  };
}
