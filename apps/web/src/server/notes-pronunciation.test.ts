import { createDatabase } from "@recalino/core/db";
import { applyNotebookEdits } from "@recalino/core/note";
import { errors } from "@recalino/core/plt";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { referenceStudyModel } from "../../../../packages/core/test/reference-study-fixture";
import { classMediaHandler } from "./media-routes";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  notebook: vi.fn(),
  card: vi.fn(),
  dependencies: vi.fn(),
  tts: vi.fn(),
  jobs: vi.fn(),
}));
vi.mock("./media-jobs", () => ({ getMediaDependencies: mocks.dependencies }));
vi.mock("./jobs", () => ({ runJobsSoon: mocks.jobs }));
vi.mock("@recalino/core/org", async (original) => ({
  ...(await original<object>()),
  getSession: mocks.session,
}));
vi.mock("@recalino/core/note", async (original) => ({
  ...(await original<object>()),
  getNotebook: mocks.notebook,
}));
vi.mock("@recalino/core/card", async (original) => ({
  ...(await original<object>()),
  getCard: mocks.card,
}));
vi.mock("@recalino/core/media", async (original) => ({
  ...(await original<object>()),
  requestTts: mocks.tts,
}));

// Domain reads and TTS are mocked: the pool never opens a connection or writes fixtures.
const db = createDatabase("postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres");
afterAll(() => db.destroy());
const sessionId = "12345678-1234-4234-8234-123456789abc";
const revisionId = "22345678-1234-4234-8234-123456789abc";
const otherId = "32345678-1234-4234-8234-123456789abc";
const ctx = { userId: otherId, requestId: "synthetic-note-pronunciation", route: "class-media" };
const fields = {
  kind: "note_pronunciation",
  learningItemId: "wear-tear",
  expectedNotebookRevisionId: revisionId,
};
function notebook(model = referenceStudyModel()) {
  return { sessionId, current: { id: revisionId, model } };
}
function request(input: unknown = fields, userId: string | null = ctx.userId) {
  return classMediaHandler(sessionId)({
    db,
    ctx: { ...ctx, userId },
    input,
    request: new Request(`https://recalino.example/api/classes/${sessionId}/media`, {
      method: "POST",
      headers: { "Idempotency-Key": "synthetic-note-request-key" },
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: sessionId });
  mocks.notebook.mockResolvedValue(notebook());
  mocks.dependencies.mockReturnValue({ settings: { pronunciationVoice: "bf_emma" } });
  mocks.tts.mockResolvedValue({ id: otherId, state: "queued" });
});

it("AC-D46-01/02 pronounces an owned published note without requiring a card", async () => {
  const result = await request();
  expect(result).toEqual({ status: 202, body: { id: otherId, state: "queued" } });
  expect(mocks.notebook).toHaveBeenCalledWith(
    db,
    { userId: ctx.userId, requestId: ctx.requestId },
    sessionId,
  );
  expect(mocks.card).not.toHaveBeenCalled();
  expect(mocks.tts).toHaveBeenCalledWith(
    db,
    { userId: ctx.userId, requestId: ctx.requestId },
    {
      sessionId,
      text: "wear and tear",
      exportAllowed: false,
      purpose: "pronunciation",
      operationKey: "synthetic-note-request-key",
    },
    mocks.dependencies(),
  );
  expect(mocks.jobs).toHaveBeenCalledWith(["media.tts"], 90, 300, {
    userId: ctx.userId,
    subjectId: otherId,
  });
});

it.each([
  ["kit-out", "kit it out"],
  ["manager", "manager"],
])("AC-D46-01 derives the saved %s target using the same helper as Recall", async (id, text) => {
  await request({ ...fields, learningItemId: id });
  expect(mocks.tts.mock.calls[0]?.[2]).toMatchObject({ text, purpose: "pronunciation" });
});

it.each([
  { text: "<b>arbitrary hidden answer</b>" },
  { target: "a different word" },
  { exportAllowed: true },
  { cardId: otherId },
])("AC-D46-01 refuses client-controlled speech fields %j", async (extra) => {
  await expect(request({ ...fields, ...extra })).rejects.toThrow();
  expect(mocks.notebook).not.toHaveBeenCalled();
  expect(mocks.tts).not.toHaveBeenCalled();
});

it("AC-D46-01 refuses a stale displayed revision before deriving its newer target", async () => {
  mocks.notebook.mockResolvedValue({
    ...notebook(),
    current: { ...notebook().current, id: otherId },
  });
  await expect(request()).rejects.toMatchObject({
    details: { fields: { pronunciation: ["notebook_changed"] } },
  });
  expect(mocks.tts).not.toHaveBeenCalled();
  expect(mocks.jobs).not.toHaveBeenCalled();
});

it("AC-D46-01 respects session and notebook ownership failures before dispatch", async () => {
  mocks.session.mockRejectedValueOnce(errors.notFound());
  await expect(request()).rejects.toMatchObject({ code: "not_found" });
  expect(mocks.notebook).not.toHaveBeenCalled();
  mocks.notebook.mockRejectedValueOnce(errors.notFound());
  await expect(request()).rejects.toMatchObject({ code: "not_found" });
  expect(mocks.tts).not.toHaveBeenCalled();
});

it.each([null, { ...notebook(), sessionId: otherId }])(
  "AC-D46-01 refuses unavailable or mismatched published notes",
  async (value) => {
    mocks.notebook.mockResolvedValue(value);
    await expect(request()).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.tts).not.toHaveBeenCalled();
  },
);

it("AC-D46-01 does not expose an item from another notebook or read note HTML", async () => {
  await expect(request({ ...fields, learningItemId: "unknown-item" })).rejects.toMatchObject({
    code: "not_found",
  });
  expect(mocks.tts).not.toHaveBeenCalled();
});

it("AC-D46-01 refuses plain or manually edited note items instead of speaking stale study fields", async () => {
  const edited = applyNotebookEdits(referenceStudyModel(), {
    claims: {},
    items: { "wear-tear": { front: "My revised prompt", back: "A different answer" } },
  });
  mocks.notebook.mockResolvedValue(notebook(edited));
  await expect(request()).rejects.toMatchObject({
    details: { fields: { pronunciation: ["target_unavailable"] } },
  });
  expect(mocks.tts).not.toHaveBeenCalled();
});

it("AC-D46-01 declines unsupported grammar notation and mismatched separable examples", async () => {
  await expect(request({ ...fields, learningItemId: "about-to" })).rejects.toMatchObject({
    details: { fields: { pronunciation: ["target_unavailable"] } },
  });
  const model = referenceStudyModel();
  const item = model.learningItems.find((entry) => entry.id === "kit-out");
  if (item?.study?.set !== "production") throw new Error("Missing synthetic frame");
  item.study.fullSentence = "This does not match the saved cloze.";
  mocks.notebook.mockResolvedValue(notebook(model));
  await expect(request({ ...fields, learningItemId: "kit-out" })).rejects.toMatchObject({
    details: { fields: { pronunciation: ["target_unavailable"] } },
  });
  expect(mocks.tts).not.toHaveBeenCalled();
});

it("AC-D46-02 lets existing ready media reuse the common cache without scheduling a job", async () => {
  mocks.tts.mockResolvedValue({ id: otherId, state: "ready" });
  expect((await request()).body).toEqual({ id: otherId, state: "ready" });
  expect(mocks.jobs).not.toHaveBeenCalled();
});

it("AC-D46-01 rejects unauthenticated notes requests before domain reads", async () => {
  await expect(request(fields, null)).rejects.toMatchObject({ code: "unauthenticated" });
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.notebook).not.toHaveBeenCalled();
  expect(mocks.tts).not.toHaveBeenCalled();
});
