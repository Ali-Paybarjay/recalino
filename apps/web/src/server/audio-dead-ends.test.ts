import { randomUUID } from "node:crypto";
import type { ProcessingRun } from "@recalino/core/proc";
import { describe, expect, it } from "vitest";
import type { AutomaticLearningStatus } from "../ui/workspace/automatic-learning";
import { automaticLearningRecovery } from "../ui/workspace/automatic-learning-recovery";
import { sessionNextStep, uploadRetryCanHelp } from "../ui/workspace/session-state";
import { uploadCopy } from "../ui/workspace/upload-copy";
import { type AudioUploadReason, audioUploadRetryable } from "../ui/workspace/upload-problems";
import { automaticLearningMessage } from "./automatic-learning";

/**
 * Second audit (2026-10-13), item 4: every stop on the audio path offers only an action that can
 * succeed, with the approved or pending text, and no state offers a retry that loops.
 */
const reasons: (AudioUploadReason | null)[] = [
  "upload_closed",
  "integrity_mismatch",
  "original_missing",
  "audio_unsupported",
  "unknown",
  null,
];

describe("saved audio uploads that stopped", () => {
  it.each(reasons)(
    "reason %s: the tray and the session page agree on whether Retry can help",
    (reason) => {
      const transfer = {
        runId: randomUUID(),
        phase: "attention",
        message: "Audio upload is saved.",
        problem: reason === "upload_closed" ? uploadCopy.audio.uploadClosed : null,
        reason,
      };
      const retryable = audioUploadRetryable(reason);
      expect(uploadRetryCanHelp(transfer)).toBe(retryable);
      const step = sessionNextStep({
        sessionId: randomUUID(),
        status: null,
        audioTransfers: [transfer],
      });
      expect(step.primary.id).toBe(retryable ? "retry_upload" : "review_material");
      // The stable reasons name a state a second identical request would not change.
      expect(retryable).toBe(reason === null || reason === "unknown");
    },
  );
});

const run = (lastError: string): ProcessingRun =>
  ({
    id: randomUUID(),
    sessionId: randomUUID(),
    reservationId: randomUUID(),
    state: "needs_input",
    lastError,
  }) as ProcessingRun;
const blocked = (lastError: string): AutomaticLearningStatus => ({
  state: "blocked",
  revision: 2,
  batchId: null,
  run: run(lastError),
  snapshot: null,
  lastError,
  message: automaticLearningMessage("blocked", lastError),
  notesReady: false,
  cardsReady: false,
});

describe("automatic learning stops on the audio path", () => {
  const generic =
    "Automatic creation could not finish. Your material and earlier notes and cards are saved. Check the material or retry this attempt.";
  it.each([
    // A retry recreates the same verifier refusal: the next step replaces the audio.
    ["audio_upload_rejected", uploadCopy.automatic.rejected, "material", null, "review_material"],
    [
      "audio_upload_not_started",
      uploadCopy.automatic.notStarted,
      null,
      "Retry failed attempt",
      "retry_processing",
    ],
    [
      "audio_upload_incomplete",
      uploadCopy.automatic.incomplete,
      null,
      "Retry failed attempt",
      "retry_processing",
    ],
    // A new attempt asks for a fresh confirmation of the changed selection: it can succeed.
    ["new_confirmation_required", generic, null, "Retry failed attempt", "retry_processing"],
    [
      "upload_needs_attention",
      "An upload needs attention. Check the named files in Add material; your earlier notes and cards are available.",
      "material",
      null,
      "review_material",
    ],
    [
      "upload_batch_cancelled",
      "This upload group was cancelled. Your earlier notes and flashcards are available; add a new group to continue.",
      "material",
      null,
      "review_material",
    ],
  ])(
    "%s: text, recovery and the session page's primary action",
    (code, text, kind, retryLabel, primary) => {
      const status = blocked(code);
      expect(status.message).toBe(text);
      expect(status.message).not.toMatch(/could not be verified\. Review the selected audio/);
      const recovery = automaticLearningRecovery(status);
      expect(recovery.kind).toBe(kind);
      expect(recovery.retryLabel).toBe(retryLabel);
      const step = sessionNextStep({ sessionId: status.run?.sessionId ?? "", status });
      expect(step.primary.id).toBe(primary);
    },
  );

  it("offers no retry for the one stop a retry would reproduce", () => {
    const loops = ["audio_upload_rejected"];
    for (const code of loops) {
      expect(automaticLearningRecovery(blocked(code)).retryLabel).toBeNull();
      const step = sessionNextStep({ sessionId: randomUUID(), status: blocked(code) });
      expect(
        [step.primary, ...step.secondary].some((action) => action.id === "retry_processing"),
      ).toBe(false);
    }
  });
});
