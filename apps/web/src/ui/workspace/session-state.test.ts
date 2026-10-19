// Workstream 5 (FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12 §7.3): one next step per session state.
import type { ProcessingRun } from "@recalino/core/proc";
import { describe, expect, it } from "vitest";
import type { AutomaticLearningStatus } from "./automatic-learning";
import {
  type SessionStateInput,
  sessionNextStep,
  todayNextSteps,
  uploadRetryCanHelp,
} from "./session-state";

const sessionId = "10000000-0000-4000-8000-000000000001";
const base = `/sessions/${sessionId}`;
const run = (state: ProcessingRun["state"], lastError: string | null = null): ProcessingRun => ({
  id: "20000000-0000-4000-8000-000000000001",
  sessionId,
  state,
  reservationId: "30000000-0000-4000-8000-000000000001",
  sourcesVersion: 1,
  lastError,
  outputVersionId: null,
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
});
function status(patch: Partial<AutomaticLearningStatus> = {}): AutomaticLearningStatus {
  return {
    state: "idle",
    revision: 1,
    batchId: null,
    run: null,
    snapshot: null,
    lastError: null,
    message: "Server message.",
    notesReady: false,
    cardsReady: false,
    ...patch,
  };
}
const next = (input: Partial<SessionStateInput>) =>
  sessionNextStep({ sessionId, status: null, ...input });
const ids = (step: ReturnType<typeof sessionNextStep>) => step.secondary.map((action) => action.id);

describe("sessionNextStep", () => {
  it("leads an empty session with Record a session, then material, and never offers notes that do not exist", () => {
    // Owner decision 2026-10-13 (D71).
    const step = next({ status: status() });
    expect(step.tone).toBe("idle");
    expect(step.heading).toBe("Add your session material");
    expect(step.primary).toEqual({
      id: "record",
      label: "Record a session",
      href: `${base}/record`,
    });
    expect(step.secondary).toEqual([
      { id: "add_material", label: "Add or view material", href: `${base}/sources` },
    ]);
    expect(ids(step)).not.toContain("read_notes");
    expect(ids(step)).not.toContain("practise_cards");
  });

  it("offers recording first only while a session is empty", () => {
    const states: Partial<SessionStateInput>[] = [
      {},
      { status: status({ state: "processing", run: run("processing") }) },
      { status: status({ state: "ready", run: run("ready"), notesReady: true }) },
      { status: status({ state: "blocked", lastError: "provider_output_truncated" }) },
      { status: status(), recordings: { capturing: false, waiting: 1 } },
    ];
    for (const input of states) expect(next(input).primary.id).not.toBe("record");
  });

  it("checks progress before the first status read, keeping existing notes reachable", () => {
    expect(next({}).primary.id).toBe("add_material");
    const withNotes = next({ content: { notes: true, cards: true } });
    expect(withNotes.heading).toBe("Checking session progress…");
    expect(withNotes.primary.id).toBe("read_notes");
    expect(ids(withNotes)).toContain("practise_cards");
  });

  it("names a failed status read and leads to progress, not to a retry", () => {
    const step = next({ statusProblem: "Progress could not be checked.", online: false });
    expect(step.heading).toBe("Reconnect to see progress");
    expect(step.primary.id).toBe("view_progress");
    expect(step.primary.href).toBe(`${base}/sources#session-progress`);
  });

  it("stays on the recording while capture is in progress (PRD-REC-02)", () => {
    const step = next({
      status: status({ state: "blocked", lastError: "quota_insufficient" }),
      recordings: { capturing: true, waiting: 0 },
    });
    expect(step.heading).toBe("Recording in progress");
    expect(step.primary).toMatchObject({ id: "open_recording", href: `${base}/record` });
  });

  it("shows a finished capture saved on this device that has not been sent", () => {
    const online = next({ status: status(), recordings: { capturing: false, waiting: 1 } });
    expect(online.heading).toBe("Saved on this device");
    expect(online.detail).toMatch(/while this app is open/);
    const offline = next({
      status: status(),
      online: false,
      recordings: { capturing: false, waiting: 2 },
    });
    expect(offline.detail).toMatch(/back online/);
    expect(offline.primary.id).toBe("view_progress");
  });

  it("reports upload progress with the number of files sent", () => {
    const step = next({
      status: status({ state: "waiting_upload", run: run("awaiting_upload") }),
      uploadProgress: {
        runId: run("awaiting_upload").id,
        sentBytes: 10,
        totalBytes: 30,
        files: [
          { sourceId: "a", displayName: "a", sentBytes: 10, totalBytes: 10, phase: "complete" },
          { sourceId: "b", displayName: "b", sentBytes: 0, totalBytes: 10, phase: "uploading" },
          { sourceId: "c", displayName: "c", sentBytes: 0, totalBytes: 10, phase: "queued" },
        ],
      },
    });
    expect(step.tone).toBe("active");
    expect(step.heading).toBe("Uploading your material");
    expect(step.detail).toMatch(/1 of 3 files sent\.$/);
    expect(step.primary.id).toBe("view_progress");
  });

  it("pauses an upload honestly while offline", () => {
    const step = next({
      status: status({ state: "waiting_upload", run: run("awaiting_upload") }),
      online: false,
      uploadProgress: {
        runId: run("awaiting_upload").id,
        sentBytes: 0,
        totalBytes: 10,
        files: [
          { sourceId: "a", displayName: "a", sentBytes: 0, totalBytes: 10, phase: "uploading" },
        ],
      },
    });
    expect(step.heading).toBe("Upload paused");
    expect(step.tone).toBe("attention");
  });

  it("keeps earlier notes as the main step while new material is processed", () => {
    const step = next({
      status: status({ state: "processing", run: run("processing"), notesReady: true }),
    });
    expect(step.heading).toBe("Creating notes and flashcards");
    expect(step.primary.id).toBe("read_notes");
    expect(ids(step)).toContain("view_progress");
  });

  it("leads with Read notes once notes are ready, and Practise cards only when cards exist", () => {
    const notesOnly = next({
      status: status({ state: "ready", run: run("ready"), notesReady: true }),
    });
    expect(notesOnly.tone).toBe("ready");
    expect(notesOnly.primary.id).toBe("read_notes");
    expect(ids(notesOnly)).not.toContain("practise_cards");
    const both = next({
      status: status({ state: "ready", run: run("ready"), notesReady: true, cardsReady: true }),
    });
    expect(both.heading).toBe("Notes and flashcards are ready");
    expect(ids(both)).toEqual(["practise_cards"]);
  });

  it("treats a partly ready session as ready to read", () => {
    const step = next({
      status: status({ state: "ready", run: run("partial_ready"), notesReady: true }),
    });
    expect(step.heading).toBe("Your session is ready to review");
    expect(step.primary.id).toBe("read_notes");
  });

  it("offers the voice step as optional, never above the notes", () => {
    const step = next({
      status: status({ state: "ready", run: run("ready"), notesReady: true, cardsReady: true }),
      voicePending: true,
    });
    expect(step.primary.id).toBe("read_notes");
    expect(step.detail).toMatch(/optional/);
    expect(step.secondary.at(-1)).toMatchObject({ id: "confirm_voice", href: `${base}/voice` });
  });

  it("does not repeat a saved-upload retry the server refused for good", () => {
    const refused = next({
      status: status({ state: "waiting_upload", run: run("awaiting_upload") }),
      audioTransfers: [
        {
          runId: "r",
          phase: "attention",
          message: "",
          problem: "Some information is missing or not valid.",
          reason: "audio_start_rejected",
        },
      ],
    });
    expect(refused.heading).toBe("Your upload needs attention");
    expect(refused.primary.id).toBe("review_material");
    expect(ids(refused)).not.toContain("retry_upload");
  });

  it("keeps the saved-upload retry when the stop can pass on a new attempt", () => {
    const step = next({
      status: status({ state: "waiting_upload" }),
      audioTransfers: [
        { runId: "r", phase: "attention", message: "Upload paused.", problem: null, reason: 7 },
      ],
    });
    expect(step.primary).toMatchObject({ id: "retry_upload", runId: "r" });
    expect(step.detail).toBe("Upload paused.");
    expect(uploadRetryCanHelp({ runId: "r", phase: "attention", message: "", problem: null })).toBe(
      true,
    );
    const transfer = { runId: "r", phase: "attention", message: "", problem: null };
    expect(uploadRetryCanHelp({ ...transfer, reason: "unknown" })).toBe(true);
    for (const reason of [
      "audio_upload_not_started",
      "audio_upload_incomplete",
      "audio_upload_rejected",
    ])
      expect(uploadRetryCanHelp({ ...transfer, reason })).toBe(false);
  });

  it.each(["audio_upload_not_started", "audio_upload_incomplete"])(
    "explains an audio upload that never arrived (%s) and keeps material review beside the retry",
    (lastError) => {
      const step = next({
        status: status({ state: "blocked", lastError, run: run("needs_input", lastError) }),
      });
      expect(step.detail).toMatch(/did not reach Recalino/);
      expect(step.primary).toMatchObject({ id: "retry_processing", label: "Retry failed attempt" });
      expect(ids(step)).toContain("review_material");
    },
  );

  it("sends a verifier rejection to material review instead of a retry that stops at the same point", () => {
    const step = next({
      status: status({
        state: "blocked",
        lastError: "audio_upload_rejected",
        run: run("needs_input", "audio_upload_rejected"),
      }),
    });
    expect(step.primary).toMatchObject({ id: "review_material" });
    expect(ids(step)).not.toContain("retry_processing");
  });

  describe("allowance stops (FR-QUOTA-007)", () => {
    const allowance = (required: number, available: number, active = true) =>
      status({
        state: "blocked",
        lastError: "quota_insufficient",
        allowance: {
          active,
          required: { audio: required, document: 0, regeneration: 0 },
          available: { audio: available, document: 0, regeneration: 0 },
        } as unknown as AutomaticLearningStatus["allowance"],
      });

    it("asks for more allowance and never retries while still short", () => {
      const step = next({ status: allowance(100, 10) });
      expect(step.primary.id).toBe("ask_allowance");
      expect(ids(step)).toEqual(
        expect.arrayContaining(["review_material", "review_allowance", "view_progress"]),
      );
      expect(ids(step)).not.toContain("retry_processing");
    });

    it("asks the pilot operator when there is no allowance", () => {
      const step = next({ status: allowance(100, 0, false) });
      expect(step.primary.id).toBe("ask_operator");
      expect(ids(step)).not.toContain("retry_processing");
    });

    it("retries once the allowance covers the session", () => {
      expect(next({ status: allowance(10, 100) }).primary).toMatchObject({
        id: "retry_processing",
        label: "Retry processing",
      });
    });

    it("keeps a conditional retry when the amounts are unknown", () => {
      const step = next({ status: status({ state: "blocked", lastError: "quota_insufficient" }) });
      expect(step.primary.id).toBe("ask_allowance");
      expect(step.secondary).toContainEqual({
        id: "retry_processing",
        label: "Retry after allowance changes",
      });
    });
  });

  it("requests a processing review for a service stop instead of a retry", () => {
    const review = {
      state: "not_requested" as const,
      runId: "40000000-0000-4000-8000-000000000001",
      requestedRunId: null,
      requestedAt: null,
      resolvedAt: null,
      partialResult: false,
      canRequest: true,
    };
    const step = next({
      status: status({
        state: "blocked",
        lastError: "provider_http_400",
        processingReview: review as unknown as AutomaticLearningStatus["processingReview"],
      }),
    });
    expect(step.primary).toMatchObject({ id: "request_review", runId: review.runId });
    expect(ids(step)).toContain("processing_review");
    const requested = next({
      status: status({
        state: "blocked",
        lastError: "provider_http_400",
        processingReview: {
          ...review,
          canRequest: false,
        } as unknown as AutomaticLearningStatus["processingReview"],
      }),
    });
    expect(requested.primary).toMatchObject({
      id: "processing_review",
      href: `${base}/sources#processing-review`,
    });
  });

  it.each([
    ["upload_needs_attention", "review_material"],
    ["acceptance_required", "accept_terms"],
    ["provider_output_truncated", "retry_processing"],
  ])("leads a %s stop to %s", (code, action) => {
    expect(next({ status: status({ state: "blocked", lastError: code }) }).primary.id).toBe(action);
  });

  // UX-09: Terms that changed stop processing; the way on is the Terms sheet, not /setup (which
  // sends a learner with finished setup straight back to Today).
  describe("acceptance_required", () => {
    const blocked = status({ state: "blocked", lastError: "acceptance_required" });

    it("opens the Terms notice when new Terms wait for the learner", () => {
      const step = next({
        status: blocked,
        account: { setupComplete: true, termsPending: true },
      });
      expect(step.primary).toEqual({ id: "accept_terms", label: "Read and accept" });
      expect(step.primary.href).toBeUndefined();
      expect(JSON.stringify(step)).not.toContain("/setup");
    });

    it("assumes the Terms when nothing is known about the account", () => {
      expect(next({ status: blocked }).primary.id).toBe("accept_terms");
    });

    it("goes to /setup only while setup is unfinished", () => {
      const step = next({
        status: blocked,
        account: { setupComplete: false, termsPending: false },
      });
      expect(step.primary).toEqual({
        id: "account_setup",
        label: "Review account setup",
        href: "/setup",
      });
    });

    it("offers a retry once the Terms were accepted after the stop", () => {
      const step = next({
        status: blocked,
        account: { setupComplete: true, termsPending: false },
      });
      expect(step.primary.id).toBe("retry_processing");
      expect(ids(step)).not.toContain("accept_terms");
      expect(ids(step)).not.toContain("account_setup");
    });
  });

  it("never lists the primary action again among the secondary ones", () => {
    const states: Partial<SessionStateInput>[] = [
      { status: status({ state: "ready", notesReady: true, cardsReady: true }) },
      { status: status({ state: "blocked", lastError: "upload_needs_attention" }) },
      { status: status({ state: "processing", notesReady: true }) },
      { content: { notes: true, cards: false } },
    ];
    for (const input of states) {
      const step = next(input);
      expect(ids(step)).not.toContain(step.primary.id);
      expect(new Set(ids(step)).size).toBe(step.secondary.length);
    }
  });
});

describe("states during and after capture (D60, D61) and before publication", () => {
  it("names background part uploads during capture without any warning", () => {
    const step = next({
      status: status({ state: "blocked", lastError: "audio_upload_rejected" }),
      recordings: { capturing: true, waiting: 0, background: true },
    });
    expect(step.heading).toBe("Recording in progress");
    expect(step.detail).toMatch(/upload in the background/);
    expect(step.tone).toBe("active");
  });

  it("says only the last part remains, from the measured transfer", () => {
    const parts = (phases: ("queued" | "uploading" | "verifying" | "complete")[]) =>
      next({
        status: status({ state: "waiting_upload", run: run("awaiting_upload") }),
        uploadProgress: {
          runId: run("awaiting_upload").id,
          sentBytes: 0,
          totalBytes: 30,
          files: phases.map((phase, index) => ({
            sourceId: `part-${index}`,
            displayName: `Part ${index + 1}`,
            sentBytes: phase === "complete" ? 10 : 0,
            totalBytes: 10,
            phase,
          })),
        },
      });
    const last = parts(["complete", "verifying", "uploading"]);
    expect(last.heading).toBe("Sending the last part");
    expect(last.detail).toMatch(/other parts are already sent/);
    expect(parts(["complete", "uploading", "queued"]).heading).toBe("Uploading your material");
    expect(parts(["uploading"]).heading).toBe("Uploading your material");
  });

  it("does not call a registered part sent while its audio still waits on the device", () => {
    const step = next({
      status: status({ state: "waiting_sources" }),
      recordings: { capturing: false, waiting: 1 },
    });
    expect(step.heading).toBe("Saved on this device");
  });

  it("explains a written lesson that waits for the voice check", () => {
    const step = next({
      status: status({ state: "processing", run: run("processing"), stage: "checking_voices" }),
      content: { notes: true, cards: true },
    });
    expect(step.heading).toBe("Finishing your notes");
    expect(step.detail).toMatch(/checking the voices/);
    expect(step.primary.id).toBe("read_notes");
    expect(
      next({ status: status({ state: "processing", run: run("processing"), stage: "publishing" }) })
        .heading,
    ).toBe("Creating notes and flashcards");
  });
});

describe("todayNextSteps (owner decision 2026-10-13, D71)", () => {
  const sessions = ["latest", "a", "b", "c", "d"];

  it("keeps the latest session and adds up to two more with work in progress", () => {
    expect(todayNextSteps(sessions, ["processing", "idle", "blocked", "waiting_upload"])).toEqual([
      "latest",
      "a",
      "c",
    ]);
  });

  it("leaves out sessions that are idle, ready or of unknown state", () => {
    expect(todayNextSteps(sessions, ["idle", "ready", null, undefined])).toEqual(["latest"]);
    expect(todayNextSteps(sessions, ["waiting_sources", "ready"])).toEqual(["latest", "a"]);
  });

  it("shows nothing without sessions and respects a smaller limit", () => {
    expect(todayNextSteps([], [])).toEqual([]);
    expect(todayNextSteps(sessions, ["processing", "processing"], 1)).toEqual(["latest"]);
  });
});
