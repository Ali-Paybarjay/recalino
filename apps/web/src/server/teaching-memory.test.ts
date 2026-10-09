import type { Database } from "@recalino/core/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(),
  log: vi.fn(),
  getVersion: vi.fn(),
}));
vi.mock("@recalino/core/pers", () => ({ practiceCandidatesForRun: mocks.candidates }));
vi.mock("@recalino/core/lkm", async (original) => ({
  ...(await original<object>()),
  getVersion: mocks.getVersion,
}));
vi.mock("@recalino/core/plt", async (original) => ({
  ...(await original<object>()),
  createLogger: () => mocks.log,
}));
const { lessonAdaptationFor, practiceCandidatesBeforeRun } = await import("./teaching-memory");
const { AppError } = await import("@recalino/core/plt");

const db = { transaction: () => ({ execute: (run: (tx: unknown) => unknown) => run({}) }) };
const ctx = { userId: "10000000-0000-4000-8000-000000000001", requestId: "request" };
beforeEach(() => vi.clearAllMocks());

describe("D49 teaching memory never blocks processing or exposes content", () => {
  it("returns the bounded points read before the run transaction", async () => {
    const points = [
      {
        target: "get on with sb",
        reason: "recall_difficulty",
        scope: "this_class",
        againCount: 2,
        lastEvidenceDate: "2026-10-06",
        sourceSessionId: "20000000-0000-4000-8000-000000000002",
      },
    ];
    mocks.candidates.mockResolvedValue(points);
    const now = new Date("2026-10-08T00:00:00Z");
    expect(
      await practiceCandidatesBeforeRun(db as unknown as Database, ctx, "session", now),
    ).toEqual(points);
    expect(mocks.candidates).toHaveBeenCalledWith({}, ctx, { sessionId: "session", now });
  });

  it("degrades to no memory and logs only codes when memory cannot be read", async () => {
    mocks.candidates.mockRejectedValue(new Error("Private synthetic class text"));
    expect(
      await practiceCandidatesBeforeRun(db as unknown as Database, ctx, "session", new Date()),
    ).toEqual([]);
    expect(mocks.log).toHaveBeenCalledWith("error", "practice_memory_unavailable", {
      request_id: "request",
      user_id: ctx.userId,
      code: "practice_memory_unavailable",
    });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("Private synthetic");
  });

  it("shows no adaptation for an unavailable version and rethrows other failures", async () => {
    mocks.getVersion.mockRejectedValueOnce(new AppError("not_found"));
    expect(await lessonAdaptationFor(db as unknown as Database, ctx, "version", [])).toBeNull();
    mocks.getVersion.mockRejectedValueOnce(new Error("database down"));
    await expect(
      lessonAdaptationFor(db as unknown as Database, ctx, "version", []),
    ).rejects.toThrow("database down");
    expect(await lessonAdaptationFor(db as unknown as Database, ctx, null, [])).toBeNull();
  });
});
