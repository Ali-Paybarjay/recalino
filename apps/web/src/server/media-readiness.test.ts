import { createDatabase } from "@recalino/core/db";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { classMediaHandler } from "./media-routes";

const mocks = vi.hoisted(() => ({ dependencies: vi.fn(), media: vi.fn() }));
vi.mock("./media-jobs", () => ({ getMediaDependencies: mocks.dependencies }));
vi.mock("./jobs", () => ({ runJobsSoon: vi.fn() }));
vi.mock("@recalino/core/org", async (original) => ({
  ...(await original<object>()),
  getSession: async () => ({}),
}));
vi.mock("@recalino/core/media", async (original) => ({
  ...(await original<object>()),
  listMediaAssets: mocks.media,
}));

// No connection is opened: the handler exercises public domain reads through test adapters.
const db = createDatabase("postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres");
afterAll(() => db.destroy());
const id = "12345678-1234-4234-8234-123456789abc";
beforeEach(() => mocks.media.mockResolvedValue([]));
it.each([true, false, undefined])(
  "reports TTS readiness only for an approved provider data contract (%s)",
  async (approved) => {
    mocks.dependencies.mockReturnValue(
      approved === undefined
        ? null
        : { provider: { settings: { dataContractApproved: approved } } },
    );
    const result = await classMediaHandler(id)({
      db,
      ctx: { userId: id, requestId: "synthetic-media-readiness", route: "class-media" },
      input: undefined,
      request: new Request(`https://recalino.example/api/classes/${id}/media`),
    });
    expect(result.body).toEqual({ media: [], ttsConfigured: approved === true });
  },
);
