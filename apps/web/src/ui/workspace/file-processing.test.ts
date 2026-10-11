import type { ProcessingRun } from "@recalino/core/proc";
import { describe, expect, it } from "vitest";
import type { AutomaticLearningStatus } from "./automatic-learning";
import { type FileProcessingReceipt, fileProcessingFeedback } from "./file-processing";
import type { SourceRow } from "./SourcesView";

function receipt(patch: Partial<FileProcessingReceipt> = {}): FileProcessingReceipt {
  return {
    revision: 4,
    previousRunId: "previous-run",
    sourceIds: ["submitted-source"],
    total: 1,
    failed: 0,
    startedAt: 1_000,
    ...patch,
  };
}

function source(patch: Partial<SourceRow> = {}): SourceRow {
  return {
    assetId: "submitted-source",
    displayName: "Class notes.pdf",
    kind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    durationMs: null,
    pageCount: 1,
    verifiedAt: "2026-10-07T10:00:00Z",
    originalDeletedAt: null,
    selected: true,
    role: "class_material",
    ranges: [],
    timeStatus: "unknown",
    contentVersionId: "content-version",
    uploadId: "upload",
    uploadState: "verified",
    rejectionReason: null,
    anchorSourceId: null,
    captureOffsetMs: null,
    captureState: null,
    ...patch,
  };
}

function run(patch: Partial<ProcessingRun> = {}): ProcessingRun {
  return {
    id: "new-run",
    sessionId: "class",
    reservationId: "reservation",
    state: "ready",
    sourcesVersion: 4,
    lastError: null,
    outputVersionId: "new-output",
    createdAt: "2026-10-07T10:00:01Z",
    updatedAt: "2026-10-07T10:00:02Z",
    ...patch,
  };
}

function status(patch: Partial<AutomaticLearningStatus> = {}): AutomaticLearningStatus {
  return {
    state: "ready",
    revision: 4,
    batchId: null,
    run: run(),
    snapshot: null,
    lastError: null,
    message: "Your notes and flashcards are ready.",
    notesReady: true,
    cardsReady: true,
    ...patch,
  };
}

describe("truthful file processing feedback", () => {
  it("confirms success only after a fresh run and verified submitted files produce notes and cards", () => {
    expect(fileProcessingFeedback(receipt(), status(), [source()])).toMatchObject({
      state: "success",
      message: "Processing successful.",
      detail: expect.stringContaining("1 file has been uploaded and processed"),
    });
    expect(
      fileProcessingFeedback(
        receipt({ sourceIds: ["submitted-source", "second-source"], total: 2 }),
        status(),
        [source(), source({ assetId: "second-source" })],
      ).detail,
    ).toContain("2 files have been uploaded and processed");
  });

  it.each([
    ["an older revision", { revision: 3 }],
    ["the previous processing run", { run: run({ id: "previous-run" }) }],
    ["an open upload batch", { batchId: "active-batch" }],
    ["missing notes", { notesReady: false }],
    ["missing flashcards", { cardsReady: false }],
    ["a missing processing run", { run: null }],
  ] satisfies [string, Partial<AutomaticLearningStatus>][])(
    "does not claim success for %s",
    (_reason, patch) => {
      expect(fileProcessingFeedback(receipt(), status(patch), [source()]).state).toBe("processing");
    },
  );

  it("keeps waiting when no authoritative completed batch revision is available", () => {
    expect(fileProcessingFeedback(receipt({ revision: null }), status(), [source()]).state).toBe(
      "processing",
    );
    expect(fileProcessingFeedback(receipt(), null, [source()]).state).toBe("processing");
  });

  it("does not treat existing ready class material as proof that submitted files are processed", () => {
    expect(
      fileProcessingFeedback(receipt(), status(), [source({ assetId: "unrelated-source" })]).state,
    ).toBe("processing");
    expect(fileProcessingFeedback(receipt(), status(), [source({ verifiedAt: null })]).state).toBe(
      "processing",
    );
    expect(
      fileProcessingFeedback(
        receipt({ sourceIds: ["submitted-source", "not-yet-listed"], total: 2 }),
        status(),
        [source()],
      ).state,
    ).toBe("processing");
    expect(fileProcessingFeedback(receipt({ sourceIds: [], total: 0 }), status(), []).state).toBe(
      "processing",
    );
  });

  it("shows continued progress while processing and sets expectations for large files", () => {
    const feedback = fileProcessingFeedback(receipt(), status({ state: "processing" }), [source()]);
    expect(feedback).toMatchObject({ state: "processing", message: "Processing your files…" });
    expect(feedback.detail).toMatch(/several minutes.*updates automatically/);
  });

  it("preserves an authoritative upload error even when old class outputs are ready", () => {
    const problem = "Private file storage is unavailable. Please retry later.";
    expect(
      fileProcessingFeedback(receipt({ problem, failed: 1 }), status(), [source()]),
    ).toMatchObject({ state: "error", detail: problem });
  });

  it("reports failed uploads with recovery guidance while retaining successfully uploaded files", () => {
    const feedback = fileProcessingFeedback(receipt({ total: 2, failed: 1 }), status(), [source()]);
    expect(feedback).toMatchObject({ state: "error", message: "1 file could not be uploaded." });
    expect(feedback.detail).toMatch(/retry the remaining files.*already uploaded are saved/);
  });

  it.each(["needs_password", "wrong_password"])(
    "guides the user to unlock a PDF after %s",
    (rejectionReason) => {
      const feedback = fileProcessingFeedback(receipt(), status(), [source({ rejectionReason })]);
      expect(feedback.state).toBe("error");
      expect(feedback.detail).toContain("Enter the correct password for Class notes.pdf");
      expect(feedback.detail).toContain("Processing resumes after verification");
    },
  );

  it("explains how to recover from a rejected file even without a rejection reason", () => {
    const feedback = fileProcessingFeedback(receipt(), status(), [
      source({ uploadState: "rejected" }),
    ]);
    expect(feedback.state).toBe("error");
    expect(feedback.detail).toMatch(/Class notes.pdf.*Skip this file.*cancel the upload group/);
  });

  it("does not surface rejection of unrelated class files as this batch's error", () => {
    const feedback = fileProcessingFeedback(receipt(), status(), [
      source(),
      source({ assetId: "old-source", rejectionReason: "needs_password" }),
    ]);
    expect(feedback.state).toBe("success");
  });

  it("reports partial output as issues rather than full success", () => {
    const feedback = fileProcessingFeedback(
      receipt(),
      status({ run: run({ state: "partial_ready" }) }),
      [source()],
    );
    expect(feedback).toMatchObject({
      state: "error",
      message: "Processing completed with some issues.",
    });
    expect(feedback.detail).toContain("available notes are saved");
  });

  it("offers retry after a recoverable processing failure without requiring another upload", () => {
    const feedback = fileProcessingFeedback(
      receipt(),
      status({
        state: "blocked",
        lastError: "transcription_failed",
        message: "Audio processing failed.",
      }),
      [source()],
    );
    expect(feedback).toMatchObject({ state: "error", retry: true });
    expect(feedback.detail).toMatch(/Audio processing failed.*do not need to upload them again/);
  });

  it.each([
    ["quota_exceeded", "Review your allowance"],
    ["provider_configuration_missing", "when the service is available"],
    ["selection_too_large", "Select fewer files or smaller ranges"],
    ["no_selected_sources", "Select verified material"],
  ])("provides actionable recovery for %s without an ineffective retry", (lastError, recovery) => {
    const feedback = fileProcessingFeedback(
      receipt(),
      status({
        state: "blocked",
        lastError,
        message: "Processing is blocked.",
      }),
      [source()],
    );
    expect(feedback).toMatchObject({ state: "error", retry: false });
    expect(feedback.detail).toContain(recovery);
  });

  it("FR-QUOTA-007: shows the server's allowance amounts once and offers retry only when covered", () => {
    const amounts = (document: number) => ({
      audio: 0,
      document,
      regeneration: 0,
      tts: 0,
      storage: 0,
    });
    const short = fileProcessingFeedback(
      receipt(),
      status({
        state: "blocked",
        lastError: "quota_insufficient",
        message: "Pages and images: 2 needed, 1 left.",
        allowance: { active: true, required: amounts(2), available: amounts(1) },
      }),
      [source()],
    );
    expect(short).toMatchObject({
      state: "error",
      detail: "Pages and images: 2 needed, 1 left.",
      retry: false,
      allowance: "shortage",
    });
    const none = fileProcessingFeedback(
      receipt(),
      status({
        state: "blocked",
        lastError: "quota_insufficient",
        message: "You have no active processing allowance.",
        allowance: { active: false, required: amounts(1), available: amounts(0) },
      }),
      [source()],
    );
    expect(none).toMatchObject({ state: "error", retry: false, allowance: "none" });
    const covered = fileProcessingFeedback(
      receipt(),
      status({
        state: "blocked",
        lastError: "quota_insufficient",
        message: "Your allowance now covers this class.",
        allowance: { active: true, required: amounts(1), available: amounts(1) },
      }),
      [source()],
    );
    expect(covered).toMatchObject({ state: "error", retry: true, allowance: "covered" });
  });

  it.each([
    "processing_budget_session",
    "processing_budget_user_month",
    "processing_budget_system_day",
    "processing_budget_system_month",
    "service_processing_blocked",
    "service_processing_paused",
    "service_cost_policy_missing",
    "service_cost_unknown",
    "service_reservation_missing",
  ])(
    "keeps %s separate from learner allowance and directs recovery to Class progress",
    (lastError) => {
      const feedback = fileProcessingFeedback(
        receipt(),
        status({ state: "blocked", lastError, message: "Processing is blocked by the service." }),
        [source()],
      );
      expect(feedback).toMatchObject({ state: "error", retry: false });
      expect(feedback.detail).toContain("Session progress to get processing help");
      expect(feedback.detail).toContain("After the service is updated");
      expect(feedback.detail).toContain("do not need to upload the files again");
      expect(feedback.detail).not.toContain("Review your allowance");
      expect(feedback.detail).not.toContain("select less material");
    },
  );

  it("does not report an unrelated old processing failure for the newly submitted batch", () => {
    expect(
      fileProcessingFeedback(
        receipt(),
        status({
          state: "blocked",
          revision: 3,
          lastError: "quota_exceeded",
        }),
        [source()],
      ).state,
    ).toBe("processing");
  });

  it.each([
    "provider_outcome_unresolved",
    "provider_outcome_unknown",
    "provider_timestamps_invalid",
    "provider_http_400",
    "provider_request_schema_too_complex",
    "provider_schema_unsupported",
    "acceptance_required",
    "upload_needs_attention",
  ])("requires the blocking condition to be resolved before retrying %s", (lastError) => {
    const feedback = fileProcessingFeedback(
      receipt(),
      status({
        state: "blocked",
        lastError,
        message: "Processing is paused. Follow the recovery instructions before retrying.",
      }),
      [source()],
    );
    expect(feedback).toMatchObject({ state: "error", retry: false });
    expect(feedback.detail).toContain("Processing is paused.");
  });

  describe("acknowledged reuse of successful processing", () => {
    const acknowledged = () => receipt({ confirmedRunId: "previous-run" });
    const reused = (patch: Partial<AutomaticLearningStatus> = {}) =>
      status({
        run: run({ id: "previous-run" }),
        ...patch,
      });

    it("accepts an existing ready run explicitly acknowledged by completion of this batch", () => {
      expect(fileProcessingFeedback(acknowledged(), reused(), [source()])).toMatchObject({
        state: "success",
        message: "Processing successful.",
      });
    });

    it.each([undefined, null, "another-run"])(
      "keeps waiting without a completion acknowledgement for the reused run (%s)",
      (confirmedRunId) => {
        expect(
          fileProcessingFeedback(receipt({ confirmedRunId }), reused(), [source()]).state,
        ).toBe("processing");
      },
    );

    it.each([
      ["an older revision", { revision: 3 }],
      ["an open upload batch", { batchId: "active-batch" }],
      ["ongoing processing", { state: "processing" }],
      ["missing notes", { notesReady: false }],
      ["missing cards", { cardsReady: false }],
    ] satisfies [string, Partial<AutomaticLearningStatus>][])(
      "a completion acknowledgement cannot bypass %s",
      (_reason, patch) => {
        expect(fileProcessingFeedback(acknowledged(), reused(patch), [source()]).state).toBe(
          "processing",
        );
      },
    );

    it("waits for every submitted asset to be listed and verified even with an acknowledged run", () => {
      expect(
        fileProcessingFeedback(acknowledged(), reused(), [source({ verifiedAt: null })]).state,
      ).toBe("processing");
      expect(fileProcessingFeedback(acknowledged(), reused(), []).state).toBe("processing");
    });

    it.each([
      { uploadState: "rejected" },
      { rejectionReason: "needs_password" },
    ] satisfies Partial<SourceRow>[])(
      "preserves source errors despite an acknowledged ready run (%j)",
      (patch) => {
        expect(fileProcessingFeedback(acknowledged(), reused(), [source(patch)]).state).toBe(
          "error",
        );
      },
    );

    it("reports partial reused output as issues instead of full success", () => {
      expect(
        fileProcessingFeedback(
          acknowledged(),
          reused({
            run: run({ id: "previous-run", state: "partial_ready" }),
          }),
          [source()],
        ),
      ).toMatchObject({
        state: "error",
        message: "Processing completed with some issues.",
      });
    });

    it("does not hide failed uploads or an authoritative upload error behind a reused result", () => {
      expect(
        fileProcessingFeedback({ ...acknowledged(), failed: 1 }, reused(), [source()]),
      ).toMatchObject({ state: "error", message: "1 file could not be uploaded." });
      const problem = "Upload confirmation was unavailable. Retry the upload.";
      expect(
        fileProcessingFeedback({ ...acknowledged(), problem }, reused(), [source()]),
      ).toMatchObject({ state: "error", detail: problem });
    });
  });
});
