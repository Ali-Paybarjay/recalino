import { beforeEach, expect, it, vi } from "vitest";
import { runJobsSoon } from "./jobs";

const mocks = vi.hoisted(() => ({ after: vi.fn(), run: vi.fn(), db: {} }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./db", () => ({ getDatabase: () => mocks.db }));
vi.mock("@recalino/core/plt", async (original) => {
  const actual = await original<typeof import("@recalino/core/plt")>();
  return { ...actual, readPltSettings: () => actual.DEFAULT_PLT_SETTINGS, runDueJobs: mocks.run };
});

beforeEach(() => vi.clearAllMocks());

it("wakes only the authorized requested subject after the response, retaining the durable runner", async () => {
  const target = {
    userId: "a6b562b4-6160-4c17-9231-714b8a671632",
    subjectId: "cc80b350-2b0d-47ea-af9e-cf104a8a76da",
  };
  runJobsSoon(["media.tts"], 90, 120, target);
  expect(mocks.after).toHaveBeenCalledTimes(1);
  expect(mocks.run).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0]?.[0]();
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
    mocks.db,
    expect.any(Array),
    expect.objectContaining({ kinds: ["media.tts"], target }),
  );
});

it("leaves ordinary background wakes unrestricted", async () => {
  runJobsSoon(["src.verify"], 90);
  await mocks.after.mock.calls[0]?.[0]();
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.run.mock.calls[0]?.[2]).not.toHaveProperty("target");
});
