import { AppError, ERROR_STATUS, type ErrorCode } from "@recalino/core/plt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountCopy } from "../account-copy";
import { isConnectionFailure, userMessage, WorkspaceRequestError, workspaceRequest } from "./api";
import { workspaceErrors } from "./error-copy";

afterEach(() => vi.unstubAllGlobals());

it("retains an upload integrity reason and HTTP status for recovery decisions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Invalid part",
            details: {
              fields: { audio: ["part_integrity_mismatch"] },
            },
          },
        },
        { status: 400 },
      ),
    ),
  );
  await expect(workspaceRequest("/api/sources/audio", "POST")).rejects.toMatchObject({
    name: "WorkspaceRequestError",
    code: "validation_failed",
    status: 400,
    fields: { audio: ["part_integrity_mismatch"] },
    message: expect.stringContaining("did not match"),
  });
});

it("retains a gateway outage status even when its response is not JSON", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
  await expect(workspaceRequest("/api/sources/audio", "POST")).rejects.toMatchObject({
    name: "WorkspaceRequestError",
    status: 503,
  });
});

it("forwards the upload cancellation signal while keeping existing request keys", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ uploaded: true }));
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  await workspaceRequest("/api/sources/audio", "POST", { action: "complete" }, "same-key", {
    signal: controller.signal,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/sources/audio",
    expect.objectContaining({
      signal: controller.signal,
      headers: expect.objectContaining({ "Idempotency-Key": "same-key" }),
    }),
  );
});

it("continues to accept a valid JSON null response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(null)));
  expect(await workspaceRequest("/api/example", "GET")).toBeNull();
});

it("treats an unreadable success response as an interrupted gateway response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Partial response")));
  await expect(workspaceRequest("/api/sources/audio", "POST")).rejects.toBeInstanceOf(
    WorkspaceRequestError,
  );
});

it.each([
  ["transcript_required", "Select a session recording in Session material and process it"],
  ["consent_required", "Enable voice identification in Voice settings"],
  ["explanation_language_missing", "Choose your explanation language in your profile"],
])("explains the class voice prerequisite %s", async (reason, message) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Some information is missing or not valid.",
            details: { fields: { voice: [reason] } },
          },
        },
        { status: 422 },
      ),
    ),
  );
  await expect(workspaceRequest("/api/classes/class-id/voice", "POST")).rejects.toMatchObject({
    status: 422,
    fields: { voice: [reason] },
    message: expect.stringContaining(message),
  });
});

it.each(["select_at_least_one", "not_verified"])(
  "explains the class voice source prerequisite %s",
  async (reason) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "validation_failed",
              message: "Some information is missing or not valid.",
              details: { fields: { sources: [reason] } },
            },
          },
          { status: 400 },
        ),
      ),
    );
    await expect(workspaceRequest("/api/classes/class-id/voice", "POST")).rejects.toMatchObject({
      message:
        "Select a session recording in Session material and process it before checking session voices.",
    });
  },
);

it("keeps a hidden class whose deletion receipt is pending, so the form can say so", async () => {
  const pending = {
    requestId: "8c028da8-1448-4bca-a638-3f4519439b18",
    kind: "session",
    state: "acknowledgement_pending",
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: "internal", message: "Try again.", details: { deletion: pending } } },
          { status: 500 },
        ),
      ),
  );
  await expect(
    workspaceRequest(`/api/classes/${pending.requestId}`, "DELETE"),
  ).rejects.toMatchObject({
    code: "internal",
    status: 500,
    deletion: pending,
    message:
      "It is now hidden from your list, but deleting it is not finished yet. Try deleting it again in a few minutes.",
  });
});

// UX-12: processing is automatic, so no message asks the learner to confirm an estimate.
it.each(["changed_after_estimate", "changed_after_confirmation", "new_confirmation_required"])(
  "explains %s without asking for an estimate to be confirmed",
  async (reason) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "validation_failed",
              message: "Sources changed",
              details: { fields: { sources: [reason] } },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const failure = await workspaceRequest("/api/classes/x/learning", "POST").catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(WorkspaceRequestError);
    const message = (failure as Error).message;
    // The sentence the owner approved word for word on 2026-10-19 (UI_COPY_PENDING.md).
    expect(message).toBe(workspaceErrors.sourcesChanged);
    expect(message).toBe(
      "The selected sources have changed. Check your session material, then try again.",
    );
    expect(message).not.toMatch(/estimate|confirm/i);
  },
);

// UX-04: a learner never reads an exception, a browser's network words or a request key.
describe("userMessage", () => {
  const fallback = "Card could not be changed.";
  const serverRefusal = async (code: ErrorCode, details?: Record<string, unknown>) => {
    const error = new AppError(code, details ? { details } : {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code, message: error.message, details } },
            { status: ERROR_STATUS[code] },
          ),
        ),
    );
    return workspaceRequest("/api/cards/x/actions", "POST").catch((failure: unknown) => failure);
  };

  it.each([
    ["Chrome", new TypeError("Failed to fetch")],
    ["Firefox", new TypeError("NetworkError when attempting to fetch resource.")],
    ["Safari", new TypeError("Load failed")],
    ["Safari while offline", new TypeError("The Internet connection appears to be offline.")],
  ])("tells a lost connection in the connection message (%s)", (_, failure) => {
    expect(isConnectionFailure(failure)).toBe(true);
    expect(userMessage(failure, fallback)).toBe(accountCopy.error.connection);
  });

  it("maps a request that never reached the server, through workspaceRequest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const failure = await workspaceRequest("/api/cards/x/actions", "POST").catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TypeError);
    expect(userMessage(failure, fallback)).toBe(
      "We couldn't connect. Check your internet connection and try again.",
    );
  });

  it("does not take a bug or a server answer for a lost connection", async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'id')");
    expect(isConnectionFailure(bug)).toBe(false);
    expect(userMessage(bug, fallback)).toBe(fallback);
    expect(isConnectionFailure(await serverRefusal("internal"))).toBe(false);
  });

  it("never shows the words of a request key (idempotency_mismatch)", async () => {
    const failure = await serverRefusal("idempotency_mismatch");
    expect(failure).toBeInstanceOf(WorkspaceRequestError);
    expect((failure as Error).message).toMatch(/same key/);
    const shown = userMessage(failure, fallback);
    expect(shown).toBe(fallback);
    expect(shown).not.toMatch(/key|idempotency/i);
  });

  it("shows every other server refusal in its own plain sentence", async () => {
    for (const code of Object.keys(ERROR_STATUS) as ErrorCode[]) {
      if (code === "idempotency_mismatch" || code === "cross_site") continue;
      const failure = await serverRefusal(code);
      const shown = userMessage(failure, fallback);
      expect(shown, code).toBe(new AppError(code).message);
      expect(shown, code).not.toMatch(/key|idempotency|provider|queued/i);
    }
  });

  it("shows the mapped sentence for a known field reason, and no provider word", async () => {
    const failure = await serverRefusal("validation_failed", {
      fields: { sources: ["changed_after_estimate"] },
    });
    expect(userMessage(failure, fallback)).toBe(workspaceErrors.sourcesChanged);
    const unresolved = await serverRefusal("validation_failed", {
      fields: { automatic: ["provider_outcome_unresolved"] },
    });
    expect(userMessage(unresolved, fallback)).not.toMatch(/provider|queued/i);
    // D89 (owner decision 2026-10-19): the approved sentence, not the generic "Try again".
    expect(userMessage(unresolved, fallback)).toBe(
      "A result is still being checked. Contact the pilot operator before trying again.",
    );
  });

  it("D105: tells the learner to stop the recording before processing the session", async () => {
    const failure = await serverRefusal("conflict", {
      fields: { session: ["capture_in_progress"] },
    });
    // The sentence the owner approved word for word on 2026-10-20 (UI_COPY_PENDING.md).
    expect(userMessage(failure, fallback)).toBe(workspaceErrors.captureInProgress);
    expect(workspaceErrors.captureInProgress).toBe(
      "Stop the recording before you process this session.",
    );
    // Without the reason, a conflict keeps its own plain sentence.
    expect(userMessage(await serverRefusal("conflict"), fallback)).toBe(
      new AppError("conflict").message,
    );
  });

  it("keeps a sentence the app wrote for learners, and replaces runtime errors", () => {
    expect(userMessage(new Error("This audio file exceeds the duration limit."), fallback)).toBe(
      "This audio file exceeds the duration limit.",
    );
    expect(userMessage(new SyntaxError("Unexpected token < in JSON"), fallback)).toBe(fallback);
    expect(userMessage(new DOMException("Aborted", "AbortError"), fallback)).toBe(fallback);
    expect(userMessage(new Error("Failed to fetch"), fallback)).toBe(fallback);
    expect(userMessage("boom", fallback)).toBe(fallback);
    expect(userMessage(undefined, fallback)).toBe(fallback);
  });
});
