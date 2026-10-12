import { pendingCopy } from "../pending-copy";
import type { AutomaticLearningStatus, AutomaticUploadProgress } from "./automatic-learning";
import { automaticLearningRecovery } from "./automatic-learning-recovery";
import { learningProgress } from "./learning-progress";
import type { UploadBatch } from "./upload-store";

const copy = pendingCopy.sessionNavigation;

/**
 * Every action a session can name as its next step. Links carry `href`; the others are commands the
 * session card runs itself (retry, review request, saved-audio retry).
 */
export type SessionActionId =
  | "read_notes"
  | "practise_cards"
  | "view_progress"
  | "add_material"
  | "open_recording"
  | "confirm_voice"
  | "review_material"
  | "ask_allowance"
  | "ask_operator"
  | "review_allowance"
  | "account_setup"
  | "processing_review"
  | "retry_processing"
  | "request_review"
  | "retry_upload";

export interface SessionAction {
  id: SessionActionId;
  label: string;
  href?: string;
  /** For `request_review` and `retry_upload`: the run the command applies to. */
  runId?: string;
}

export interface SessionNextStep {
  tone: "idle" | "active" | "attention" | "ready";
  /** One status line: where the session is now. */
  heading: string;
  detail: string;
  primary: SessionAction;
  secondary: SessionAction[];
}

/** A saved audio transfer as the upload tray keeps it. `reason` is read defensively. */
export interface SessionAudioTransfer {
  runId: string;
  phase: string;
  message: string;
  problem: string | null;
  reason?: unknown;
}

export interface SessionStateInput {
  sessionId: string;
  /** The server's automatic learning status; null while it has not been read. */
  status: AutomaticLearningStatus | null;
  /** The last status read failed (connection or server). */
  statusProblem?: string | null;
  online?: boolean;
  /** What the server already published for this session. */
  content?: { notes: boolean; cards: boolean };
  batches?: readonly UploadBatch[];
  uploadProgress?: AutomaticUploadProgress | null;
  audioTransfers?: readonly SessionAudioTransfer[];
  /** Captures on this device: one is in progress, or finished captures still wait to be sent. */
  recordings?: { capturing: boolean; waiting: number };
  /** Whether this session's voice check waits for the learner's optional confirmation. */
  voicePending?: boolean;
}

/**
 * Upload refusals that a retry of the same saved file cannot change. Codes come from the upload
 * worker (`feat/upload-reliability`); an unknown or missing code keeps today's retry.
 */
const finalUploadReasons = new Set([
  "audio_upload_rejected",
  "audio_start_rejected",
  "confirmed_processing_required",
  "checksum_mismatch",
  "file_changed",
  "original_missing",
  "original_unreadable",
  "too_large",
  "unsupported_type",
  "not_verified",
]);

export function uploadRetryCanHelp(transfer: SessionAudioTransfer) {
  const reason = typeof transfer.reason === "string" ? transfer.reason : null;
  return !reason || !finalUploadReasons.has(reason);
}

function actions(sessionId: string) {
  const session = `/sessions/${sessionId}`;
  return {
    read_notes: { id: "read_notes", label: "Read notes", href: `${session}/notes` },
    practise_cards: { id: "practise_cards", label: "Practise cards", href: `${session}/cards` },
    view_progress: {
      id: "view_progress",
      label: "View progress",
      href: `${session}/sources#session-progress`,
    },
    add_material: { id: "add_material", label: "Add or view material", href: `${session}/sources` },
    open_recording: {
      id: "open_recording",
      label: "Open recording",
      href: `${session}/record`,
    },
    confirm_voice: { id: "confirm_voice", label: copy.voice.action, href: `${session}/voice` },
    review_material: {
      id: "review_material",
      label: "Review material",
      href: `${session}/sources`,
    },
    ask_allowance: { id: "ask_allowance", label: "Ask for more allowance", href: "/help/new" },
    ask_operator: { id: "ask_operator", label: "Ask the pilot operator", href: "/help/new" },
    review_allowance: { id: "review_allowance", label: "Review allowance", href: "/me/quota" },
    account_setup: { id: "account_setup", label: "Review account setup", href: "/setup" },
    processing_review: {
      id: "processing_review",
      label: "View processing review",
      href: `${session}/sources#processing-review`,
    },
  } satisfies Record<string, SessionAction>;
}

function unique(primary: SessionAction, secondary: (SessionAction | null | false | undefined)[]) {
  const seen = new Set([primary.id]);
  return secondary.filter((action): action is SessionAction => {
    if (!action || seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}

/**
 * Session state → one status line, exactly one primary action and optional secondary actions.
 * Pure: the session page, Today and the material page show the same next step. A step never
 * offers an action that is known to fail again (a retry before the allowance covers the class,
 * or a saved-upload retry the server refused for good).
 */
export function sessionNextStep(input: SessionStateInput): SessionNextStep {
  const { sessionId, status } = input;
  const go = actions(sessionId);
  const notes = !!(input.content?.notes || status?.notesReady);
  const cards = !!(input.content?.cards || status?.cardsReady);
  const study = notes ? go.read_notes : cards ? go.practise_cards : null;
  const studyActions = [notes && go.read_notes, cards && go.practise_cards];
  const step = (
    tone: SessionNextStep["tone"],
    heading: string,
    detail: string,
    primary: SessionAction,
    secondary: (SessionAction | null | false | undefined)[] = [],
  ): SessionNextStep => ({ tone, heading, detail, primary, secondary: unique(primary, secondary) });

  // Capture comes first and stays quiet (PRD-REC-02): only where to return to it.
  if (input.recordings?.capturing)
    return step("active", "Recording in progress", "", go.open_recording, studyActions);

  // A saved audio transfer stopped: its own next step, never a retry the server refuses again.
  const stopped = input.audioTransfers?.find((transfer) => transfer.phase === "attention");
  if (stopped) {
    const detail = stopped.problem ?? stopped.message;
    return uploadRetryCanHelp(stopped)
      ? step(
          "attention",
          "Your upload needs attention",
          detail,
          { id: "retry_upload", label: "Retry saved audio upload", runId: stopped.runId },
          [go.view_progress, ...studyActions],
        )
      : step("attention", "Your upload needs attention", detail, go.review_material, [
          go.view_progress,
          ...studyActions,
        ]);
  }

  if (!status) {
    if (input.statusProblem)
      return step(
        "attention",
        input.online === false ? "Reconnect to see progress" : "Progress needs your attention",
        input.statusProblem,
        study ?? go.view_progress,
        [go.view_progress, ...studyActions],
      );
    return step("idle", "Checking session progress…", "", study ?? go.add_material, studyActions);
  }

  const progress = learningProgress(status, input.batches ?? [], input.uploadProgress);
  const recovery = automaticLearningRecovery(status);

  if (status.state === "blocked") {
    const detail = status.message;
    const heading = progress.heading;
    const after = [go.view_progress, ...studyActions];
    const retry = (label: string): SessionAction => ({ id: "retry_processing", label });
    if (recovery.kind === "allowance") {
      if (recovery.allowance === "covered")
        return step("attention", heading, detail, retry("Retry processing"), after);
      if (recovery.allowance === "none")
        return step("attention", heading, detail, go.ask_operator, [go.review_allowance, ...after]);
      return step("attention", heading, detail, go.ask_allowance, [
        recovery.lessMaterial && go.review_material,
        go.review_allowance,
        // Unknown amounts: the retry may now pass, so it stays, after the request.
        !!recovery.retryLabel && retry(recovery.retryLabel),
        ...after,
      ]);
    }
    if (recovery.kind === "service") {
      const review = status.processingReview;
      return review?.canRequest
        ? step(
            "attention",
            heading,
            detail,
            { id: "request_review", label: "Request processing review", runId: review.runId },
            [go.processing_review, ...studyActions],
          )
        : step("attention", heading, detail, go.processing_review, studyActions);
    }
    if (recovery.kind === "material")
      return step("attention", heading, detail, go.review_material, after);
    if (recovery.kind === "setup")
      return step("attention", heading, detail, go.account_setup, after);
    // The saved audio never reached the server. A retry starts its upload again from this device;
    // the material page shows whether the original is still here.
    if (status.lastError === "audio_upload_rejected")
      return step(
        "attention",
        heading,
        copy.audioNotReceived,
        retry(recovery.retryLabel ?? "Retry failed attempt"),
        [go.review_material, ...after],
      );
    return step(
      "attention",
      heading,
      detail,
      retry(recovery.retryLabel ?? "Retry failed attempt"),
      after,
    );
  }

  if (progress.needsMaterialReview)
    return step("attention", progress.heading, progress.guidance, go.review_material, [
      go.view_progress,
      ...studyActions,
    ]);

  if (progress.active) {
    if (input.online === false)
      return step(
        "attention",
        progress.stage === "upload" ? "Upload paused" : "Reconnect to see progress",
        progress.stage === "upload"
          ? "Reconnect this device to the internet. Your upload will resume automatically; keep this app open."
          : "Processing can continue, but this device needs an internet connection to show the latest progress.",
        study ?? go.view_progress,
        [go.view_progress, ...studyActions],
      );
    const files = progress.upload?.files ?? [];
    const sent = files.filter((file) => /^(Checking upload|Upload complete)$/.test(file.label));
    const count =
      progress.stage === "upload" && files.length > 1
        ? ` ${copy.uploadCount.replace("{sent}", String(sent.length)).replace("{total}", String(files.length))}`
        : "";
    return step(
      "active",
      progress.heading,
      `${progress.guidance}${count}`,
      study ?? go.view_progress,
      [go.view_progress, ...studyActions],
    );
  }

  // Finished captures on this device that have not reached the server yet.
  if (input.recordings?.waiting && status.state === "idle")
    return step(
      "active",
      copy.savedOnDevice.heading,
      input.online === false ? copy.savedOnDevice.offline : copy.savedOnDevice.online,
      study ?? go.view_progress,
      [go.view_progress, ...studyActions],
    );

  if (status.state === "ready" || notes || cards) {
    const heading =
      status.state === "ready"
        ? progress.heading
        : notes && cards
          ? "Notes and flashcards are ready"
          : notes
            ? "Your session notes are ready"
            : "Your flashcards are ready";
    const detail =
      input.voicePending && notes
        ? copy.voice.ready
        : status.state === "ready"
          ? progress.guidance
          : notes
            ? "Open your session notes to start reviewing."
            : "Open your flashcards to start reviewing.";
    if (!study)
      return step("ready", heading, detail, go.view_progress, [
        input.voicePending && go.confirm_voice,
      ]);
    return step("ready", heading, detail, study, [
      ...studyActions,
      input.voicePending && go.confirm_voice,
    ]);
  }

  return step(
    "idle",
    "Add your session material",
    "Add documents, audio or photos to start creating notes and flashcards.",
    go.add_material,
  );
}
