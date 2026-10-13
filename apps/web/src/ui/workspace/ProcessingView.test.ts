import type { ProcessingRun } from "@recalino/core/proc";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type ProcessingEstimate, ProcessingView } from "./ProcessingView";
import { uploadCopy } from "./upload-copy";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

const sessionId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const estimate: ProcessingEstimate = {
  snapshot: {
    sourcesVersion: 4,
    fingerprint: "a".repeat(64),
    sources: [
      {
        sourceId: "10000000-0000-4000-8000-000000000003",
        kind: "audio",
        sha256: "b".repeat(64),
        mimeType: "audio/wav",
        durationMs: 60000,
        pageCount: null,
        objectId: null,
        contentVersionId: null,
        captureAnchor: null,
        ranges: [],
        units: [],
        blocks: [],
      },
    ],
  },
  requested: { audio: 60, document: 0, regeneration: 0, tts: 0, storage: 0 },
  allowance: { remaining: { audio: 600, document: 20, regeneration: 2, tts: 0, storage: 0 } },
  providerConfigured: true,
  models: null,
};

function run(state: ProcessingRun["state"], fields: Partial<ProcessingRun> = {}): ProcessingRun {
  return {
    id: "10000000-0000-4000-8000-000000000004",
    sessionId,
    state,
    reservationId: "10000000-0000-4000-8000-000000000005",
    sourcesVersion: estimate.snapshot.sourcesVersion,
    lastError: null,
    outputVersionId: null,
    createdAt: "2026-10-06T10:00:00.000Z",
    updatedAt: "2026-10-06T10:00:00.000Z",
    ...fields,
  };
}

function render(
  initialRuns: ProcessingRun[] = [],
  initialEstimate: ProcessingEstimate | null = estimate,
  state: Partial<
    Pick<Parameters<typeof ProcessingView>[0], "initialEstimateProblem" | "sourcesVersion">
  > = {},
) {
  return renderToStaticMarkup(
    createElement(ProcessingView, {
      sessionId,
      userId,
      initialEstimate,
      initialRuns,
      contract: null,
      ...state,
    }),
  );
}

function buttons(html: string) {
  return [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((match) => match[1]);
}

function notesAction(html: string) {
  return html.match(
    new RegExp(`<a\\b[^>]*href="/sessions/${sessionId}/notes"[^>]*>(.*?)<\\/a>`),
  )?.[1];
}

describe("processing next actions", () => {
  it("asks for confirmation before the first processing attempt", () => {
    const html = render();
    expect(buttons(html)).toContain("Confirm and process");
    expect(html).toContain("Check before processing");
    expect(notesAction(html)).toBeUndefined();
  });

  it.each(["queued", "processing", "awaiting_upload"] as const)(
    "keeps %s processing visible without offering another confirmation",
    (state) => {
      const html = render([run(state)]);
      expect(html).toContain("Preparing your session");
      expect(buttons(html)).not.toContain("Confirm and process");
      expect(buttons(html)).toContain("Cancel processing");
      expect(notesAction(html)).toBeUndefined();
      if (state === "awaiting_upload") expect(buttons(html)).toContain("Resume audio upload");
    },
  );

  it.each(["ready", "partial_ready"] as const)(
    "offers notes for %s results and prevents processing the same sources again",
    (state) => {
      const html = render([run(state)]);
      expect(buttons(html)).not.toContain("Confirm and process");
      expect(html).not.toContain("Check before processing");
      expect(notesAction(html)).toBe("Read session notes");
      expect(html).toContain("Step 3 of 3");
      expect(html).toContain("Next, read and save your session notes.");
      expect(html).toContain(`/sessions/${sessionId}/cards`);
      expect(html).toContain(
        state === "ready"
          ? "Your session is ready."
          : "A partial result is ready. Some selected material could not be extracted.",
      );
    },
  );

  it("asks for a new confirmation when material changes after a successful result", () => {
    const html = render([run("ready")], {
      ...estimate,
      snapshot: { ...estimate.snapshot, sourcesVersion: estimate.snapshot.sourcesVersion + 1 },
    });
    expect(buttons(html)).toContain("Confirm and process");
    expect(notesAction(html)).toBe("Read session notes");
  });

  it("keeps notes after verification changes the version but keeps the selected material", () => {
    const signature = "selected-material";
    const html = render([run("ready", { selectionFingerprint: signature })], {
      ...estimate,
      selectionFingerprint: signature,
      snapshot: { ...estimate.snapshot, sourcesVersion: estimate.snapshot.sourcesVersion + 1 },
    });
    expect(buttons(html)).not.toContain("Confirm and process");
    expect(html).not.toContain("Check before processing");
    expect(notesAction(html)).toBe("Read session notes");
  });

  it("asks for confirmation when the selected material changes even at the same version", () => {
    const html = render([run("ready", { selectionFingerprint: "original-selection" })], {
      ...estimate,
      selectionFingerprint: "new-selection",
    });
    expect(buttons(html)).toContain("Confirm and process");
    expect(notesAction(html)).toBe("Read session notes");
  });

  it("keeps a successful result available when the current source estimate is unavailable", () => {
    const html = render([run("ready")], null);
    expect(buttons(html)).not.toContain("Confirm and process");
    expect(notesAction(html)).toBe("Read session notes");
    expect(html).toContain("Your session is ready.");
  });

  it.each(["failed", "cancelled"] as const)(
    "offers an explicit retry after %s without restoring the initial confirmation",
    (state) => {
      const html = render([run(state)]);
      expect(buttons(html)).not.toContain("Confirm and process");
      expect(buttons(html)).toContain("Retry processing");
      expect(html).toContain(
        state === "cancelled"
          ? "Processing cancelled. Unused allowance was released."
          : "Processing needs attention. Your saved session and earlier notes are available.",
      );
    },
  );

  it("requires review when verified material changes after upload", () => {
    const html = render([run("needs_input", { lastError: "new_confirmation_required" })]);
    expect(buttons(html)).not.toContain("Confirm and process");
    expect(buttons(html)).toContain("Review and confirm");
    expect(html).toContain("The verified source has changed.");
  });

  it("offers review and retry for rejected audio alongside changing sources", () => {
    const html = render([run("needs_input", { lastError: "audio_upload_rejected" })]);
    expect(buttons(html)).not.toContain("Confirm and process");
    expect(buttons(html)).not.toContain("Retry processing");
    expect(buttons(html)).toContain("Review and retry");
    expect(html).toContain(`/sessions/${sessionId}/sources`);
    expect(html).toContain("The audio could not be verified.");
  });

  it.each([
    ["audio_upload_not_started", uploadCopy.audio.notStarted],
    ["audio_upload_incomplete", uploadCopy.audio.incomplete],
  ])(
    "names %s as a lapsed upload, not rejected audio, and offers a retry that can succeed",
    (lastError, text) => {
      const html = render([run("needs_input", { lastError })]);
      expect(buttons(html)).toContain("Review and retry");
      expect(buttons(html)).not.toContain("Confirm and process");
      expect(html).toContain(text);
      expect(html).not.toContain("The audio could not be verified.");
    },
  );

  it("explains that verified audio needs confirmation without another upload", () => {
    const html = render([run("needs_input", { lastError: "new_confirmation_required" })], {
      ...estimate,
      snapshot: {
        ...estimate.snapshot,
        sources: estimate.snapshot.sources.map((source) => ({
          ...source,
          objectId: "10000000-0000-4000-8000-000000000006",
        })),
      },
    });
    expect(html).toContain("Audio verified — confirm to create notes");
    expect(html).toContain("Note creation has not started.");
    expect(html).toContain("you do not need to upload the audio again.");
    expect(buttons(html)).toContain("Review and confirm");
    expect(buttons(html)).not.toContain("Resume audio upload");
  });

  it("treats an old audio rejection as history after all sources are removed", () => {
    const html = render([run("needs_input", { lastError: "audio_upload_rejected" })], null, {
      initialEstimateProblem: "no_selected_sources",
      sourcesVersion: estimate.snapshot.sourcesVersion + 1,
    });
    expect(html).toContain("Previous attempt");
    expect(html).toContain("Your sources have changed since this attempt.");
    expect(html).not.toContain("The audio could not be verified.");
    expect(html).toContain("No material is selected for this session.");
    expect(html).toContain("Add or select material");
    expect(buttons(html)).not.toContain("Review and retry");
    expect(buttons(html)).not.toContain("Check again");
  });

  it("keeps a new selection available for confirmation after an old audio rejection", () => {
    const html = render([run("needs_input", { lastError: "audio_upload_rejected" })], {
      ...estimate,
      snapshot: { ...estimate.snapshot, sourcesVersion: estimate.snapshot.sourcesVersion + 1 },
    });
    expect(html).toContain("Previous attempt");
    expect(html).not.toContain("The audio could not be verified.");
    expect(buttons(html)).toContain("Review and retry");
  });

  it("offers another estimate check after a service failure without claiming sources are missing", () => {
    const html = render([], null, { initialEstimateProblem: "unavailable" });
    expect(html).toContain("The processing estimate could not be loaded.");
    expect(html).not.toContain("No material is selected");
    expect(html).not.toContain("No selected source is ready");
    expect(buttons(html)).toContain("Check again");
    expect(buttons(html)).not.toContain("Confirm and process");
  });

  it.each([
    ["sources_not_ready", "Some selected files are still being verified."],
    ["selection_too_large", "The selected material is too large to process together."],
  ] as const)("explains %s before processing", (initialEstimateProblem, message) => {
    const html = render([], null, { initialEstimateProblem });
    expect(html).toContain(message);
    expect(html).not.toContain("No material is selected");
    expect(html).toContain("Review sources");
    expect(buttons(html)).not.toContain("Confirm and process");
  });

  it("explains invalid transcription timestamps without claiming an ongoing check", () => {
    const html = render([run("needs_input", { lastError: "provider_timestamps_invalid" })]);
    expect(html).toContain("The transcription service returned invalid timing information.");
    expect(html).toContain("Processing has stopped.");
    expect(html).toContain("Contact the operator to review this attempt before retrying.");
    expect(html).not.toContain("still being checked");
    expect(html).not.toContain("Check before processing");
    expect(buttons(html)).not.toContain("Confirm and process");
    expect(buttons(html)).not.toContain("Review and retry");
    expect(buttons(html)).not.toContain("Retry processing");
  });

  it.each(["provider_outcome_unknown", "provider_outcome_unresolved"])(
    "blocks another attempt until operator review after %s",
    (lastError) => {
      const html = render([run("needs_input", { lastError })]);
      expect(buttons(html)).not.toContain("Confirm and process");
      expect(buttons(html)).not.toContain("Retry processing");
      expect(buttons(html)).not.toContain("Review and confirm");
      expect(html).toContain("The result of a processing request could not be confirmed.");
      expect(html).toContain("Processing is paused.");
      expect(html).toContain("Contact the operator before retrying.");
      expect(html).not.toContain("still being checked");
    },
  );

  it("describes other provider problems as paused for operator review", () => {
    const html = render([run("needs_input", { lastError: "provider_http_502" })]);
    expect(html).toContain("Processing is paused and needs an operator review before retrying.");
    expect(html).not.toContain("still being checked");
    expect(buttons(html)).not.toContain("Confirm and process");
    expect(buttons(html)).not.toContain("Retry processing");
    expect(buttons(html)).not.toContain("Review and confirm");
  });

  it.each([
    "output_language_mismatch",
    "output_time_reference_invalid",
    "knowledge_repair_exhausted",
  ])(
    "explains a stopped generated-note failure without blaming uploaded files after %s",
    (lastError) => {
      const html = render([run("failed", { lastError })]);
      expect(html).toContain("The generated notes could not be verified");
      expect(html).toContain("No new notes were saved.");
      expect(buttons(html)).toContain("Retry processing");
      expect(html).not.toContain("Check your sources");
      expect(html).not.toContain("still being checked");
      expect(html).not.toContain("Contact the operator");
    },
  );

  it("explains an incomplete provider response without claiming that notes were created", () => {
    const html = render([run("failed", { lastError: "provider_output_truncated" })]);
    expect(html).toContain("The generated response was incomplete.");
    expect(html).toContain("No new session notes were saved.");
    expect(buttons(html)).toContain("Retry processing");
    expect(html).not.toContain("Session notes created");
    expect(html).not.toContain("still being checked");
  });

  it.each([
    "provider_timestamps_invalid",
    "provider_outcome_unknown",
    "provider_outcome_unresolved",
  ])("keeps %s visible and blocked even after the selection changes", (lastError) => {
    const html = render([run("needs_input", { lastError })], {
      ...estimate,
      snapshot: { ...estimate.snapshot, sourcesVersion: estimate.snapshot.sourcesVersion + 1 },
    });
    expect(html).toContain("before retrying.");
    expect(html).not.toContain("Previous attempt");
    expect(html).not.toContain("still being checked");
    expect(buttons(html)).not.toContain("Confirm and process");
    expect(buttons(html)).not.toContain("Retry processing");
    expect(buttons(html)).not.toContain("Review and retry");
  });
});
