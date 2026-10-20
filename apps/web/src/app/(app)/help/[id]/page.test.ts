import { errors } from "@recalino/core/plt";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FeedbackThreadPage from "./page";

const mocks = vi.hoisted(() => ({ requireLearner: vi.fn(), thread: vi.fn(), record: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NotFound");
  },
}));
vi.mock("../../../../server/auth/learner", () => ({ requireLearner: mocks.requireLearner }));
vi.mock("../../../../server/db", () => ({ getDatabase: () => ({}) }));
vi.mock("@recalino/core/support", () => ({ getFeedbackThread: mocks.thread }));
vi.mock("@recalino/core/plt", async (original) => ({
  ...(await original<typeof import("@recalino/core/plt")>()),
  recordSecurityEvent: mocks.record,
}));
vi.mock("../../LearnerShell", () => ({
  LearnerShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("../../../../ui/support/Support", () => ({ SupportConversation: () => null }));

const userId = "10000000-0000-4000-8000-000000000001";
const open = (id: string) =>
  FeedbackThreadPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  mocks.requireLearner.mockReset();
  mocks.requireLearner.mockResolvedValue({ userId, state: {} });
  mocks.thread.mockReset();
  mocks.record.mockReset();
  mocks.record.mockResolvedValue(undefined);
});

describe("feedback conversation page (SEC-09)", () => {
  it("answers 404 for a malformed id before reading anything", async () => {
    await expect(open("abc")).rejects.toThrow("NotFound");
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("answers 404 for another learner's conversation and records the attempt", async () => {
    mocks.thread.mockRejectedValue(errors.ownershipDenied());
    await expect(open("20000000-0000-4000-8000-000000000002")).rejects.toThrow("NotFound");
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.record.mock.calls[0]?.[1]).toMatchObject({
      kind: "ownership_denied",
      userId,
      route: "/help/[id]",
    });
  });

  it("answers 404 for a missing conversation without a security event", async () => {
    mocks.thread.mockRejectedValue(errors.notFound());
    await expect(open("20000000-0000-4000-8000-000000000003")).rejects.toThrow("NotFound");
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
