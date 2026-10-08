import { createDatabase } from "@recalino/core/db";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { classMediaHandler } from "./media-routes";

const mocks = vi.hoisted(() => ({
  dependencies: vi.fn(),
  card: vi.fn(),
  tts: vi.fn(),
  jobs: vi.fn(),
}));
vi.mock("./media-jobs", () => ({ getMediaDependencies: mocks.dependencies }));
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
  requestTts: mocks.tts,
}));
const db = createDatabase("postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres");
afterAll(() => db.destroy());
const sessionId = "12345678-1234-4234-8234-123456789abc";
const cardId = "22345678-1234-4234-8234-123456789abc";
const ctx = { userId: sessionId, requestId: "synthetic-pronunciation", route: "class-media" };
function request(input: unknown = { kind: "pronunciation", cardId, expectedContentVersion: 1 }) {
  return classMediaHandler(sessionId)({
    db,
    ctx,
    input,
    request: new Request(`https://recalino.example/api/classes/${sessionId}/media`, {
      method: "POST",
      headers: { "Idempotency-Key": "synthetic-request-key" },
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dependencies.mockReturnValue({ settings: { pronunciationVoice: "bf_emma" } });
  mocks.card.mockResolvedValue({
    contentVersion: 1,
    sessionIds: [sessionId],
    pronunciationTarget: "wear and tear",
    front: "<p>hidden HTML</p>",
  });
  mocks.tts.mockResolvedValue({ id: cardId, state: "queued" });
});
it("AC-D46-01/02 derives the owned structured target and routes through cached private speech", async () => {
  await request();
  expect(mocks.tts).toHaveBeenCalledWith(
    db,
    { userId: sessionId, requestId: ctx.requestId },
    {
      sessionId,
      text: "wear and tear",
      exportAllowed: false,
      purpose: "pronunciation",
      operationKey: "synthetic-request-key",
    },
    mocks.dependencies(),
  );
  expect(mocks.jobs).toHaveBeenCalledWith(["media.tts"], 90);
});
it("rejects arbitrary text overrides, stale cards and cards outside this owned session before dispatch", async () => {
  await expect(
    request({
      kind: "pronunciation",
      cardId,
      expectedContentVersion: 1,
      text: "<b>hidden answer</b>",
    }),
  ).rejects.toThrow();
  mocks.card.mockResolvedValue({ sessionIds: [cardId], pronunciationTarget: "wear and tear" });
  await expect(request()).rejects.toMatchObject({ code: "not_found" });
  mocks.card.mockResolvedValue({
    sessionIds: [sessionId],
    contentVersion: 2,
    pronunciationTarget: "new hidden answer",
  });
  await expect(request()).rejects.toMatchObject({
    details: { fields: { pronunciation: ["card_changed"] } },
  });
  mocks.card.mockResolvedValue({ sessionIds: [sessionId], contentVersion: 1 });
  await expect(request()).rejects.toMatchObject({ code: "validation_failed" });
  expect(mocks.tts).not.toHaveBeenCalled();
});
