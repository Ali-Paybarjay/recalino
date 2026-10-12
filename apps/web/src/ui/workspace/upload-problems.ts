import { pendingCopy } from "../pending-copy";
import { WorkspaceRequestError } from "./api";
import { isRetryableUploadFailure } from "./upload";

/**
 * Stable reasons a saved audio upload stopped. Only `unknown` keeps the older behaviour of
 * offering a retry; every other non-retryable reason names a state a retry cannot change.
 */
export type AudioUploadReason =
  /** The server no longer accepts this run's upload: it ended, or its confirmed hold closed. */
  | "upload_closed"
  /** The device original differs from the confirmed audio or from the upload's manifest. */
  | "integrity_mismatch"
  /** The original is not saved on this device. */
  | "original_missing"
  /** The verifier refused the media. */
  | "audio_unsupported"
  | "unknown";

/** A non-retryable audio upload failure with its stable reason; the message is learner copy. */
export class AudioUploadProblem extends Error {
  constructor(
    readonly reason: AudioUploadReason,
    message: string,
  ) {
    super(message);
    this.name = "AudioUploadProblem";
  }
}

/** Whether a learner's Retry can succeed. Entries saved before reasons existed keep their retry. */
export function audioUploadRetryable(reason: AudioUploadReason | null | undefined): boolean {
  return !reason || reason === "unknown";
}

function reasons(failure: WorkspaceRequestError) {
  return Object.values(failure.fields ?? {}).flat();
}

/**
 * Classify a server rejection of the audio upload. Retryable transport failures and aborts are
 * returned unchanged so the existing recovery keeps resuming them.
 */
export function audioUploadProblem(failure: unknown): unknown {
  if (
    failure instanceof AudioUploadProblem ||
    isRetryableUploadFailure(failure) ||
    (failure instanceof DOMException && failure.name === "AbortError") ||
    !(failure instanceof WorkspaceRequestError)
  )
    return failure;
  const problems = reasons(failure);
  if (failure.code === "unsupported_media")
    return new AudioUploadProblem("audio_unsupported", failure.message);
  // A part corrupted in transit is sent again with a fresh link, so its retry stays offered. A
  // changed manifest means the device original differs from the one this upload started with.
  if (failure.code === "idempotency_mismatch")
    return new AudioUploadProblem("integrity_mismatch", failure.message);
  if (
    failure.code === "conflict" ||
    (failure.code === "validation_failed" && problems.includes("confirmed_processing_required"))
  )
    return new AudioUploadProblem(
      "upload_closed",
      pendingCopy.uploadReliability.audio.uploadClosed,
    );
  return failure;
}
