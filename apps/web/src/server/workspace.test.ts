import { errors } from "@recalino/core/plt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Learner } from "./auth/learner";
import { pageRead, workspaceSession } from "./workspace";

const mocks = vi.hoisted(() => ({ session: vi.fn(), record: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NotFound");
  },
}));
vi.mock("./db", () => ({ getDatabase: () => ({}) }));
vi.mock("@recalino/core/note", () => ({ getLearningSession: mocks.session }));
vi.mock("@recalino/core/plt", async (original) => ({
  ...(await original<typeof import("@recalino/core/plt")>()),
  recordSecurityEvent: mocks.record,
}));

const learner = { userId: "10000000-0000-4000-8000-000000000001", state: {} } as Learner;
const sessionId = "20000000-0000-4000-8000-000000000002";

beforeEach(() => {
  mocks.session.mockReset();
  mocks.record.mockReset();
  mocks.record.mockResolvedValue(undefined);
});

describe("page reads answer 404 and record cross-account attempts (SEC-09)", () => {
  it("records another learner's resource as a security event with the page route", async () => {
    mocks.session.mockRejectedValue(errors.ownershipDenied());
    await expect(workspaceSession(learner, sessionId)).rejects.toThrow("NotFound");
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.record.mock.calls[0]?.[1]).toEqual({
      kind: "ownership_denied",
      userId: learner.userId,
      route: "/sessions/[id]",
      requestId: "page-render",
    });
  });

  it("answers 404 without an event for a missing resource or a malformed id", async () => {
    mocks.session.mockRejectedValue(errors.notFound());
    await expect(workspaceSession(learner, sessionId)).rejects.toThrow("NotFound");
    await expect(workspaceSession(learner, "abc")).rejects.toThrow("NotFound");
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("still answers 404 when the event cannot be stored, and logs only the failure's name", async () => {
    const lines: string[] = [];
    mocks.record.mockRejectedValue(new Error("Synthetic database failure"));
    await expect(
      pageRead(
        learner,
        "/help/[id]",
        async () => {
          throw errors.ownershipDenied();
        },
        (level, event, fields) => lines.push(JSON.stringify({ level, event, ...fields })),
      ),
    ).rejects.toThrow("NotFound");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      level: "error",
      event: "security_event_failed",
      route: "/help/[id]",
      error_name: "Error",
    });
  });

  it("passes other failures through unchanged", async () => {
    const failure = new Error("Synthetic failure");
    await expect(
      pageRead(learner, "/help/[id]", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
