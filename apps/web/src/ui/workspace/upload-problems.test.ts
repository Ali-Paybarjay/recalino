import { expect, it } from "vitest";
import { pendingCopy } from "../pending-copy";
import { WorkspaceRequestError } from "./api";
import { UploadInterruptedError } from "./upload";
import { AudioUploadProblem, audioUploadProblem, audioUploadRetryable } from "./upload-problems";

const rejection = (code: string, status: number, fields?: Record<string, string[]>) =>
  new WorkspaceRequestError(
    "Some information is missing or not valid.",
    code,
    undefined,
    status,
    fields,
  );

it.each([
  [
    rejection("validation_failed", 400, { reservation: ["confirmed_processing_required"] }),
    "upload_closed",
  ],
  [
    rejection("validation_failed", 400, { audio: ["confirmed_processing_required"] }),
    "upload_closed",
  ],
  [rejection("conflict", 409), "upload_closed"],
  [rejection("idempotency_mismatch", 422), "integrity_mismatch"],
  [rejection("unsupported_media", 415), "audio_unsupported"],
])("names a server refusal %# with a stable reason that hides Retry", (failure, reason) => {
  const problem = audioUploadProblem(failure);
  expect(problem).toBeInstanceOf(AudioUploadProblem);
  expect(problem).toMatchObject({ reason });
  expect(audioUploadRetryable((problem as AudioUploadProblem).reason)).toBe(false);
});

it("replaces the generic validation text of a closed upload with an action that can succeed", () => {
  expect(
    (
      audioUploadProblem(
        rejection("validation_failed", 400, { reservation: ["confirmed_processing_required"] }),
      ) as Error
    ).message,
  ).toBe(pendingCopy.uploadReliability.audio.uploadClosed);
});

it.each([
  new UploadInterruptedError("Audio upload was interrupted."),
  new TypeError("Failed to fetch"),
  rejection("internal", 500),
  new DOMException("Paused", "AbortError"),
  rejection("validation_failed", 400, { audio: ["something_new"] }),
  rejection("validation_failed", 400, { audio: ["part_integrity_mismatch"] }),
  new Error("Unclassified"),
])("keeps retryable, aborted and unclassified failure %# unchanged", (failure) => {
  expect(audioUploadProblem(failure)).toBe(failure);
});

it("keeps Retry for entries saved before reasons existed and for unknown reasons", () => {
  expect(audioUploadRetryable(undefined)).toBe(true);
  expect(audioUploadRetryable(null)).toBe(true);
  expect(audioUploadRetryable("unknown")).toBe(true);
  expect(audioUploadRetryable("original_missing")).toBe(false);
});
