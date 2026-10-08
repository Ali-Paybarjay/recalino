import { createDatabase } from "@recalino/core/db";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { readProcessingEstimate } from "./processing-routes";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), sources: vi.fn(), allowance: vi.fn() }));
vi.mock("./ai", () => ({ getAiProvider: mocks.provider }));
vi.mock("./jobs", () => ({ runJobsSoon: vi.fn() }));
vi.mock("@recalino/core/src", async (original) => ({
  ...(await original<object>()),
  selectSourceSnapshot: mocks.sources,
}));
vi.mock("@recalino/core/lkm", async (original) => ({
  ...(await original<object>()),
  getLatestVersion: async () => null,
}));
vi.mock("@recalino/core/quota", async (original) => ({
  ...(await original<object>()),
  allowance: mocks.allowance,
}));

// No connection is opened: estimates exercise mocked public domain reads and actual calculation.
const db = createDatabase("postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres");
afterAll(() => db.destroy());
const id = "12345678-1234-4234-8234-123456789abc";
const ctx = { userId: id, requestId: "synthetic-provider-readiness" };
beforeEach(() => {
  mocks.sources.mockResolvedValue({
    sourcesVersion: 1,
    fingerprint: "0".repeat(64),
    sources: [
      {
        sourceId: id,
        kind: "image",
        sha256: "0".repeat(64),
        mimeType: "image/jpeg",
        durationMs: null,
        pageCount: null,
        objectId: id,
        contentVersionId: null,
        ranges: [],
        units: [],
        blocks: [],
      },
    ],
  });
  mocks.allowance.mockResolvedValue({
    remaining: { audio: 0, document: 5, regeneration: 0, tts: 0, storage: 0 },
  });
});
it.each([true, false])(
  "reports provider readiness only when the data contract approval is %s",
  async (approved) => {
    mocks.provider.mockReturnValue({
      settings: {
        dataContractApproved: approved,
        charactersPerPage: 1000,
        maxInputCharacters: 8000,
        llmModel: "synthetic/llm",
        visionModel: "synthetic/vision",
        sttModel: "synthetic/stt",
      },
    });
    const estimate = await readProcessingEstimate(db, ctx, id);
    expect(estimate.providerConfigured).toBe(approved);
    expect(estimate.requested?.document).toBe(1);
    expect(estimate.allowance.remaining.document).toBe(5);
  },
);
it("keeps processing unavailable when the provider configuration is missing", async () => {
  mocks.provider.mockReturnValue(undefined);
  const estimate = await readProcessingEstimate(db, ctx, id);
  expect(estimate.providerConfigured).toBe(false);
  expect(estimate.requested).toBeNull();
  expect(estimate.models).toBeNull();
});
