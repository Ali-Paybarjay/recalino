import type { Database } from "@recalino/core/db";
import { AppError, errors } from "@recalino/core/plt";
import { beforeEach, expect, it, vi } from "vitest";
import { readProcessingEstimateState } from "./processing-estimate-state";

const mocks = vi.hoisted(() => ({ estimate: vi.fn() }));
vi.mock("./processing-routes", () => ({ readProcessingEstimate: mocks.estimate }));

const db = {} as Database;
const sessionId = "12345678-1234-4234-8234-123456789abc";
const learner = { userId: sessionId, requestId: "synthetic-estimate-state" };
beforeEach(() => {
  mocks.estimate.mockReset();
});

it("passes a ready estimate through and supplies no problem", async () => {
  const estimate = { selectionFingerprint: "synthetic-selection", snapshot: { sourcesVersion: 2 } };
  mocks.estimate.mockResolvedValue(estimate);
  await expect(readProcessingEstimateState(db, learner, sessionId)).resolves.toEqual({
    estimate,
    problem: null,
  });
  expect(mocks.estimate).toHaveBeenCalledWith(db, learner, sessionId);
});

it.each([
  ["select_at_least_one", "no_selected_sources"],
  ["not_verified", "sources_not_ready"],
  ["selected_text_too_large", "selection_too_large"],
])("distinguishes the expected source validation %s", async (reason, problem) => {
  mocks.estimate.mockRejectedValue(errors.validationFailed({ sources: [reason] }));
  await expect(readProcessingEstimateState(db, learner, sessionId)).resolves.toEqual({
    estimate: null,
    problem,
  });
});

it.each([
  new Error("connection failed: synthetic secret"),
  new AppError("internal", { details: { private: "synthetic secret" } }),
  errors.validationFailed({ processing: ["storage_unavailable"] }),
  errors.validationFailed({ sources: ["unknown_selection_problem"] }),
  errors.validationFailed({ other: ["select_at_least_one"] }),
  new AppError("validation_failed", { details: { fields: { sources: "select_at_least_one" } } }),
  { code: "validation_failed", details: { fields: { sources: ["select_at_least_one"] } } },
])(
  "uses a safe unavailable state for operational or unrecognized failures: %s",
  async (failure) => {
    mocks.estimate.mockRejectedValue(failure);
    await expect(readProcessingEstimateState(db, learner, sessionId)).resolves.toEqual({
      estimate: null,
      problem: "unavailable",
    });
  },
);

it.each([errors.unauthenticated(), errors.notFound(), errors.ownershipDenied()])(
  "preserves protected failures: %s",
  async (failure) => {
    mocks.estimate.mockRejectedValue(failure);
    await expect(readProcessingEstimateState(db, learner, sessionId)).rejects.toBe(failure);
  },
);
