import type { ProcessingRun } from "@recalino/core/proc";
import type { InputContract } from "@recalino/core/src";
import { describe, expect, it } from "vitest";
import type { AutomaticLearningStatus, AutomaticUploadProgress } from "./automatic-learning";
import { learningProgress } from "./learning-progress";
import { learningProgressCopy } from "./learning-progress-copy";
import type { SourceRow } from "./source-types";
import type { UploadBatch, UploadEntry } from "./upload-store";

function status(patch: Partial<AutomaticLearningStatus> = {}): AutomaticLearningStatus {
  return {
    state: "waiting_sources",
    revision: 2,
    batchId: "current-batch",
    run: null,
    snapshot: null,
    lastError: "batch_open",
    message: "Waiting for files",
    notesReady: false,
    cardsReady: false,
    ...patch,
  };
}

function run(state: ProcessingRun["state"] = "awaiting_upload"): ProcessingRun {
  return {
    id: "current-run",
    sessionId: "session",
    state,
    reservationId: "reservation",
    sourcesVersion: 2,
    lastError: null,
    outputVersionId: null,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
  };
}

function entry(patch: Partial<UploadEntry> = {}): UploadEntry {
  return {
    id: "file",
    displayName: "lecture.pdf",
    sizeBytes: 100,
    lastModified: 1,
    mimeType: "application/pdf",
    creationKey: "key",
    phase: "uploading",
    sentBytes: 25,
    startedAt: 1,
    serverSeen: true,
    ...patch,
  };
}

function batch(patch: Partial<UploadBatch> = {}): UploadBatch {
  return {
    id: "current-batch",
    userId: "user",
    sessionId: "session",
    contract: {} as InputContract,
    storageConfigured: true,
    createdAt: 1,
    phase: "uploading",
    entries: [entry()],
    receipt: {
      revision: 2,
      previousRunId: null,
      sourceIds: [],
      total: 1,
      failed: 0,
      startedAt: 1,
    },
    ...patch,
  };
}

function audio(patch: Partial<AutomaticUploadProgress> = {}): AutomaticUploadProgress {
  return {
    runId: "current-run",
    sentBytes: 40,
    totalBytes: 100,
    files: [
      {
        sourceId: "audio-source",
        displayName: "Lecture audio",
        sentBytes: 40,
        totalBytes: 100,
        phase: "uploading",
      },
    ],
    ...patch,
  };
}

describe("learning progress", () => {
  it("shows local audio checking as preparation instead of a stalled zero-percent upload", () => {
    const pending = audio();
    pending.files = pending.files.map((file) => ({ ...file, phase: "checking", sentBytes: 0 }));
    pending.sentBytes = 0;
    const result = learningProgress(
      status({ state: "waiting_upload", batchId: null, run: run(), lastError: null }),
      [],
      pending,
    );
    expect(result).toMatchObject({
      preparing: true,
      stage: "upload",
      heading: "Preparing audio for upload",
      active: true,
      upload: { percent: null, sentBytes: 0, totalBytes: 100 },
    });
    expect(result.guidance).toContain("on this device before sending");
    expect(result.upload?.files[0]).toMatchObject({
      preparing: true,
      label: "Checking audio before upload",
      percent: null,
    });
    expect(result.steps.map((step) => step.state)).toEqual([
      "current",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("shows preparation from a local batch while the server still reports idle", () => {
    const pending = batch({
      entries: [entry({ phase: "checking", sentBytes: 0 })],
    });
    pending.receipt.revision = null;
    const result = learningProgress(status({ state: "idle", batchId: null, lastError: null }), [
      pending,
    ]);
    expect(result).toMatchObject({
      preparing: true,
      active: true,
      heading: "Preparing your files for upload",
      upload: { percent: null },
    });
  });

  it("retains measured aggregate upload bytes when another file is still being prepared", () => {
    const result = learningProgress(status(), [
      batch({ entries: [entry(), entry({ id: "next", phase: "checking", sentBytes: 0 })] }),
    ]);
    expect(result).toMatchObject({
      preparing: false,
      heading: "Uploading your material",
      upload: { sentBytes: 25, totalBytes: 200, percent: 12 },
    });
    expect(result.upload?.files[1]?.percent).toBeNull();
  });

  it("shows measured bytes for the current batch and leaves processing pending", () => {
    const result = learningProgress(status(), [batch()]);
    expect(result).toMatchObject({
      stage: "upload",
      heading: "Uploading your material",
      active: true,
      upload: { sentBytes: 25, totalBytes: 100, percent: 25 },
    });
    expect(result.guidance).toContain("this app open");
    expect(result.steps.map((step) => step.state)).toEqual([
      "current",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("does not count locally saved audio as transferred, even with a stale byte counter", () => {
    const result = learningProgress(status(), [
      batch({
        phase: "received",
        entries: [entry({ phase: "local_saved", sentBytes: 100, mimeType: "audio/m4a" })],
      }),
    ]);
    expect(result.stage).toBe("upload");
    expect(result.steps[0]?.state).toBe("current");
    expect(result.upload?.percent).toBe(0);
    expect(result.upload?.files[0]?.label).toContain("upload pending");
  });

  it("uses actual audio transfer progress and does not double count its local upload entry", () => {
    const result = learningProgress(
      status({ state: "waiting_upload", batchId: null, lastError: null, run: run() }),
      [
        batch({
          phase: "received",
          entries: [
            entry({
              phase: "local_saved",
              source: { assetId: "audio-source" } as SourceRow,
            }),
          ],
        }),
      ],
      audio(),
    );
    expect(result.upload).toMatchObject({ sentBytes: 40, totalBytes: 100, percent: 40 });
    expect(result.upload?.files).toHaveLength(1);
    expect(result.upload?.files[0]?.displayName).toBe("lecture.pdf");
    expect(result.steps[0]?.state).toBe("current");
  });

  it("does not reuse an old batch's full bar while a new batch is uploading", () => {
    const old = batch({
      id: "previous-batch",
      phase: "received",
      createdAt: 10,
      entries: [entry({ phase: "complete", sentBytes: 100 })],
    });
    expect(learningProgress(status(), [old, batch()]).upload?.percent).toBe(25);
    expect(learningProgress(status(), [old]).upload).toBeNull();
  });

  it("ignores retained completed batches from an earlier revision after its batch ID closes", () => {
    const old = batch();
    old.receipt.revision = 1;
    old.phase = "received";
    old.entries = [entry({ phase: "complete", sentBytes: 100 })];
    const result = learningProgress(
      status({ state: "waiting_upload", batchId: null, lastError: null, run: run() }),
      [old],
    );
    expect(result.upload).toBeNull();
    expect(result.steps[0]?.state).toBe("current");
  });

  it("ignores audio telemetry belonging to an earlier attempt", () => {
    const result = learningProgress(
      status({ state: "waiting_upload", run: run(), batchId: null, lastError: null }),
      [],
      audio({ runId: "previous-run" }),
    );
    expect(result.upload).toBeNull();
    expect(result.stage).toBe("upload");
  });

  it("ignores a cancelled batch even if its ID matches a delayed server status", () => {
    const result = learningProgress(status(), [batch({ phase: "cancelled" })]);
    expect(result.upload).toBeNull();
  });

  it.each(["batch", "file"] as const)(
    "stops the upload prominently when the local %s needs attention before the server catches up",
    (failure) => {
      const saved = batch(
        failure === "batch" ? { phase: "attention" } : { entries: [entry({ phase: "failed" })] },
      );
      const result = learningProgress(status(), [saved]);
      expect(result).toMatchObject({
        stage: "upload",
        active: false,
        needsMaterialReview: true,
        heading: "Your upload needs attention",
        guidance: "Open Review material and retry the affected file to continue.",
      });
      expect(result.steps[0]?.state).toBe("blocked");
    },
  );

  it.each(["processing", "ready"] as const)(
    "does not let retained local upload failures override server %s",
    (state) => {
      const result = learningProgress(status({ state, lastError: null, batchId: null }), [
        batch({ phase: "attention", entries: [entry({ phase: "failed" })] }),
      ]);
      expect(result.needsMaterialReview).toBe(false);
      expect(result.steps.some((step) => step.state === "blocked")).toBe(false);
      expect(result.upload).toBeNull();
    },
  );

  it("does not call upload complete just because a document batch is complete while audio waits", () => {
    const result = learningProgress(
      status({ state: "waiting_upload", run: run(), batchId: null, lastError: null }),
      [batch({ entries: [entry({ phase: "complete", sentBytes: 100 })] })],
    );
    expect(result.steps[0]?.state).toBe("current");
    expect(result.upload).toBeNull();
  });

  it("moves to verification when every measured audio transfer has reached the server", () => {
    const progress = audio();
    const file = progress.files[0];
    if (!file) throw new Error("The fixture must include an audio file.");
    progress.files[0] = { ...file, sentBytes: 100, phase: "verifying" };
    progress.sentBytes = 100;
    const result = learningProgress(
      status({ state: "waiting_upload", run: run(), lastError: null, batchId: null }),
      [],
      progress,
    );
    expect(result.stage).toBe("verify");
    expect(result.heading).toBe("Checking your files");
    expect(result.steps.map((step) => step.state)).toEqual([
      "complete",
      "current",
      "pending",
      "pending",
    ]);
  });

  it("keeps verification open after all bytes are sent instead of declaring processing ready", () => {
    const result = learningProgress(status(), [
      batch({ entries: [entry({ phase: "verifying", sentBytes: 100 })] }),
    ]);
    expect(result.stage).toBe("verify");
    expect(result.steps[1]?.state).toBe("current");
    expect(result.steps[2]?.state).toBe("pending");
    expect(result.upload?.percent).toBe(100);
  });

  it("shows ordinary waiting_sources as verification without an invented processing percent", () => {
    const result = learningProgress(status({ batchId: null, lastError: null }));
    expect(result.stage).toBe("verify");
    expect(result.upload).toBeNull();
    expect(result.steps[2]?.state).toBe("pending");
  });

  it("keeps local audio pending while other files are checked", () => {
    const result = learningProgress(status({ batchId: null, lastError: null }), [
      batch({ entries: [entry({ phase: "local_saved", sentBytes: 0 })] }),
    ]);
    expect(result.stage).toBe("verify");
    expect(result.steps[0]?.state).toBe("pending");
    expect(result.guidance).toContain("this app open");
  });

  it.each(["queued", "processing"] as const)(
    "shows %s processing without a fabricated percentage or prior upload details",
    (state) => {
      const result = learningProgress(
        status({ state: "processing", batchId: null, lastError: null, run: run(state) }),
        [batch()],
        audio(),
      );
      expect(result.stage).toBe("process");
      expect(result.heading).toBe(
        state === "queued" ? "Waiting to process" : "Creating notes and flashcards",
      );
      expect(result.upload).toBeNull();
      expect(result.steps.map((step) => step.state)).toEqual([
        "complete",
        "complete",
        "current",
        "pending",
      ]);
      expect(result.guidance).toContain("You can leave this page");
      expect(result.guidance).toContain(learningProgressCopy.waitEstimate);
    },
  );

  it("does not claim completed prerequisites for an allowance block before a run exists", () => {
    const result = learningProgress(
      status({ state: "blocked", batchId: null, lastError: "quota_insufficient" }),
    );
    expect(result).toMatchObject({
      active: false,
      heading: "Your session needs attention",
      stage: "process",
    });
    expect(result.steps.map((step) => step.state)).toEqual([
      "pending",
      "pending",
      "blocked",
      "pending",
    ]);
    expect(result.guidance).toContain("Ask for more allowance");
  });

  const allowanceAmounts = (document: number, regeneration = 0) => ({
    audio: 0,
    document,
    regeneration,
    tts: 0,
    storage: 0,
  });

  it.each([
    {
      name: "covered allowance",
      allowance: {
        active: true,
        required: allowanceAmounts(1),
        available: allowanceAmounts(1),
      },
      guidance:
        "Your allowance now covers this session. Choose Retry processing to continue with your saved material.",
    },
    {
      name: "no active allowance",
      allowance: {
        active: false,
        required: allowanceAmounts(1),
        available: allowanceAmounts(0),
      },
      guidance: "Ask the pilot operator for an allowance, then retry using your saved material.",
    },
    {
      name: "document shortage",
      allowance: {
        active: true,
        required: allowanceAmounts(2),
        available: allowanceAmounts(1),
      },
      guidance:
        "Ask for more allowance or open Review material to select less material, then retry.",
    },
    {
      name: "new-version shortage",
      allowance: {
        active: true,
        required: allowanceAmounts(1, 1),
        available: allowanceAmounts(5, 0),
      },
      guidance: "Ask for more allowance, then retry using your saved material.",
    },
    {
      name: "unknown allowance amounts",
      allowance: undefined,
      guidance:
        "Ask for more allowance or open Review material to select less material, then retry.",
    },
  ])("FR-QUOTA-007: gives the correct prominent next step for $name", ({ allowance, guidance }) => {
    const result = learningProgress(
      status({ state: "blocked", batchId: null, lastError: "quota_insufficient", allowance }),
    );
    expect(result.guidance).toBe(guidance);
    expect(result.active).toBe(false);
  });

  it("puts an audio rejection on the upload step and a material check failure on verification", () => {
    expect(
      learningProgress(status({ state: "blocked", lastError: "audio_upload_rejected" })).steps[0]
        ?.state,
    ).toBe("blocked");
    expect(
      learningProgress(status({ state: "blocked", lastError: "not_verified" })).steps[1]?.state,
    ).toBe("blocked");
  });

  it("does not mistake retained local audio entries for a new upload after processing fails", () => {
    const result = learningProgress(
      status({
        state: "blocked",
        batchId: null,
        lastError: "processing_failed",
        run: run("failed"),
      }),
      [batch({ entries: [entry({ phase: "local_saved" })] })],
    );
    expect(result.stage).toBe("process");
    expect(result.steps[2]?.state).toBe("blocked");
  });

  it("does not make prior notes or flashcards count as completion of current work", () => {
    const result = learningProgress(status({ notesReady: true, cardsReady: true }), [batch()]);
    expect(result.steps[3]?.state).toBe("pending");
    expect(result.heading).toBe("Uploading your material");
  });

  it("keeps partial results explicit while making the finished timeline available", () => {
    const result = learningProgress(
      status({
        state: "ready",
        run: run("partial_ready"),
        lastError: null,
        batchId: null,
        notesReady: true,
        cardsReady: true,
      }),
    );
    expect(result.heading).toBe("Your session is ready to review");
    expect(result.guidance).toContain("could not be processed");
    expect(result.active).toBe(false);
    expect(result.steps.every((step) => step.state === "complete")).toBe(true);
  });

  it.each([
    [true, false, "Open your session notes to start reviewing."],
    [false, true, "Open your flashcards to start reviewing."],
    [false, false, "Return to your session to review the result."],
  ] as const)(
    "only recommends available results when notesReady=%s and cardsReady=%s",
    (notesReady, cardsReady, guidance) => {
      expect(
        learningProgress(status({ state: "ready", lastError: null, notesReady, cardsReady }))
          .guidance,
      ).toBe(guidance);
    },
  );

  it("has no percentage when a file length is unknown and bounds malformed byte counters", () => {
    const unknown = learningProgress(status(), [
      batch({ entries: [entry({ sizeBytes: 0 }), entry({ id: "known" })] }),
    ]);
    expect(unknown.upload?.percent).toBeNull();
    const overflow = learningProgress(status(), [batch({ entries: [entry({ sentBytes: 200 })] })]);
    expect(overflow.upload?.sentBytes).toBe(100);
    expect(overflow.upload?.percent).toBe(100);
  });

  it("starts idle with clear add-material guidance and no running steps", () => {
    const result = learningProgress(status({ state: "idle", batchId: null, lastError: null }));
    expect(result.heading).toBe("Add your session material");
    expect(result.active).toBe(false);
    expect(result.steps.every((step) => step.state === "pending")).toBe(true);
  });

  // UX-09: new Terms speak with the sentence the owner approved on 2026-10-19.
  describe("a stop for new Terms", () => {
    const stopped = status({ state: "blocked", lastError: "acceptance_required" });

    it("uses the approved sentence and never points to setup", () => {
      const result = learningProgress(stopped);
      expect(result.guidance).toBe("Read and accept the updated Terms to continue.");
      expect(result.guidance).toBe(learningProgressCopy.termsGuidance);
      expect(result.guidance).not.toContain("setup");
    });

    it("reads like any failed attempt once the Terms were accepted", () => {
      const result = learningProgress(stopped, [], null, true);
      expect(result.guidance).not.toContain("Terms");
      expect(result.guidance).toContain("Retry");
    });
  });

  // UX-13: the wait gets the owner's estimate (2026-10-19) and nothing else is promised.
  describe("the wait for notes and flashcards", () => {
    it.each(["queued", "processing"] as const)("shows the approved estimate while %s", (state) => {
      const result = learningProgress(
        status({ state: "processing", batchId: null, lastError: null, run: run(state) }),
      );
      expect(result.showsWait).toBe(true);
      expect(result.guidance).toContain(learningProgressCopy.waitEstimate);
      expect(result.guidance).toContain("Processing continues automatically");
    });

    it("shows it only while processing", () => {
      for (const idle of [status({ state: "idle" }), status({ state: "ready" })]) {
        const result = learningProgress(idle);
        expect(result.showsWait).toBe(false);
        expect(result.guidance).not.toContain(learningProgressCopy.waitEstimate);
      }
    });
  });
});

// D107 (owner decision 2026-10-20): the material page's card while the session waits for the
// learner's Process this session; nothing moves on it, as nothing runs.
describe("a session waiting for Process this session", () => {
  const waiting = (patch: Partial<AutomaticLearningStatus> = {}) =>
    status({ batchId: null, lastError: null, processRequest: "not_requested", ...patch });

  it("names the wait and the press instead of a processing stage", () => {
    const progress = learningProgress(waiting());
    expect(progress).toMatchObject({
      awaitingProcess: "first",
      heading: "Ready to process",
      guidance: "Your notes and flashcards are made when you process this session.",
      active: false,
      showsWait: false,
    });
    expect(learningProgress(waiting({ processRequest: "new_material" }))).toMatchObject({
      awaitingProcess: "reopened",
      heading: "New sources since your notes were made",
      guidance: "A new version of existing notes also uses 1 New versions unit.",
    });
  });

  it("keeps the upload progress while files of the session are still on their way", () => {
    expect(learningProgress(waiting({ batchId: "current-batch" })).awaitingProcess).toBeNull();
    expect(
      learningProgress(waiting(), [batch({ entries: [entry({ phase: "uploading" })] })])
        .awaitingProcess,
    ).toBeNull();
    expect(learningProgress(waiting({ processRequest: "requested" })).awaitingProcess).toBeNull();
  });
});
