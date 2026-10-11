import { createDatabase } from "@recalino/core/db";
import { errors } from "@recalino/core/plt";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { classMediaHandler, mediaHandler } from "./media-routes";

const mocks = vi.hoisted(() => ({
  asset: vi.fn(),
  read: vi.fn(),
  tts: vi.fn(),
  card: vi.fn(),
  jobs: vi.fn(),
  store: {},
}));
vi.mock("./storage", () => ({ getObjectStore: () => mocks.store }));
vi.mock("./media-jobs", () => ({ getMediaDependencies: () => ({ store: mocks.store }) }));
vi.mock("./jobs", () => ({ runJobsSoon: mocks.jobs }));
vi.mock("@recalino/core/org", async (original) => ({
  ...(await original<object>()),
  getSession: async () => ({}),
}));
vi.mock("@recalino/core/card", async (original) => ({
  ...(await original<object>()),
  getCard: mocks.card,
}));
vi.mock("@recalino/core/media", async (original) => ({
  ...(await original<object>()),
  getMediaAsset: mocks.asset,
  mediaReadLink: mocks.read,
  requestTts: mocks.tts,
}));

// Domain calls are mocked; these tests do not connect to a database or speech provider.
const db = createDatabase("postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres");
afterAll(() => db.destroy());
const sessionId = "12345678-1234-4234-8234-123456789abc";
const assetId = "22345678-1234-4234-8234-123456789abc";
const ctx = { userId: sessionId, requestId: "synthetic-playback", route: "media" };
const asset = { id: assetId, kind: "tts", state: "ready", mimeType: "audio/mpeg" };
const playback = {
  url: "https://storage.example/synthetic-audio",
  validUntil: new Date("2026-10-11T12:10:00Z"),
};
const get = (query = "?playback=1") =>
  mediaHandler(assetId)({
    db,
    ctx,
    input: undefined,
    request: new Request(`https://recalino.example/api/media/${assetId}${query}`),
  });
const post = (
  input: unknown = { kind: "pronunciation", cardId: assetId, expectedContentVersion: 1 },
) =>
  classMediaHandler(sessionId)({
    db,
    ctx,
    input,
    request: new Request(`https://recalino.example/api/classes/${sessionId}/media`, {
      method: "POST",
      headers: { "Idempotency-Key": "synthetic-playback-key" },
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.asset.mockResolvedValue(asset);
  mocks.tts.mockResolvedValue(asset);
  mocks.read.mockResolvedValue(playback);
  mocks.card.mockResolvedValue({
    sessionIds: [sessionId],
    contentVersion: 1,
    pronunciationTarget: "wear and tear",
  });
});

it("returns a ready pronunciation and its private expiring link together", async () => {
  expect((await post()).body).toEqual({ ...asset, playback });
  expect(mocks.read).toHaveBeenCalledWith(
    db,
    mocks.store,
    { userId: ctx.userId, requestId: ctx.requestId },
    assetId,
    expect.any(Object),
  );
  expect(mocks.jobs).not.toHaveBeenCalled();
});

it("delivers the playback link in the poll that reports ready", async () => {
  expect((await get()).body).toEqual({ ...asset, playback });
  expect(mocks.asset).toHaveBeenCalledBefore(mocks.read);
});

it.each(["", "?playback=0"])("keeps ordinary asset reads unchanged (%s)", async (query) => {
  expect((await get(query)).body).toEqual(asset);
  expect(mocks.read).not.toHaveBeenCalled();
});

it.each(["queued", "processing", "failed", "needs_input"])(
  "does not sign unavailable %s audio",
  async (state) => {
    mocks.asset.mockResolvedValue({ ...asset, state });
    expect((await get()).body).toEqual({ ...asset, state });
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it("never adds pronunciation playback to an image", async () => {
  mocks.asset.mockResolvedValue({ ...asset, kind: "image", mimeType: "image/png" });
  await get();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("preserves the known asset when signing fails so retry cannot lose generation state", async () => {
  mocks.read.mockRejectedValue(new Error("Synthetic signing failure"));
  expect((await get()).body).toEqual(asset);
  expect((await post()).body).toEqual(asset);
});

it("checks ownership and current content before issuing any playback link", async () => {
  mocks.asset.mockRejectedValue(errors.notFound());
  await expect(get()).rejects.toMatchObject({ code: "not_found" });
  mocks.card.mockResolvedValue({ sessionIds: [sessionId], contentVersion: 2 });
  await expect(post()).rejects.toMatchObject({ code: "validation_failed" });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.tts).not.toHaveBeenCalled();
});

it("keeps generic TTS responses unchanged", async () => {
  expect(
    (await post({ kind: "tts", text: "A synthetic example", exportAllowed: false })).body,
  ).toEqual(asset);
  expect(mocks.read).not.toHaveBeenCalled();
});
