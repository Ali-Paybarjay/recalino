import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceRequestError, workspaceRequest } from "./api";

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
  ["transcript_required", "Select a session recording in Sources and process it"],
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
        "Select a session recording in Sources and process it before checking session voices.",
    });
  },
);
