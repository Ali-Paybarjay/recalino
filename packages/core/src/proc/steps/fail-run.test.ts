import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, stageRun, syntheticJob } from "../../../test/processing-run";
import { ProviderError } from "../../aip";
import { errors, JobCancelled } from "../../plt";
import { failRun } from "./fail-run";

const m = vi.hoisted(() => ({ lockAccount: vi.fn(), ownedRun: vi.fn(), settleAllowance: vi.fn() }));
vi.mock("../../acc", async (original) => ({
  ...(await original<object>()),
  lockAccount: m.lockAccount,
}));
vi.mock("../runs", async (original) => ({ ...(await original<object>()), ownedRun: m.ownedRun }));
vi.mock("../../quota", async (original) => ({
  ...(await original<object>()),
  settleAllowance: m.settleAllowance,
}));

// QUA-01: how a failed processing job ends, with no database.
const RESERVATION = "99999999-9999-4999-8999-999999999999";
function base(attempt = 1) {
  const calls: unknown[][] = [];
  const job = syntheticJob(calls);
  job.job.attempt = attempt;
  const { ctx, payload } = stageRun();
  return { calls, base: { job, ctx, payload } };
}
const update = (calls: unknown[][]) => calls.find((call) => call[0] === "set")?.[1];

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.ownedRun.mockResolvedValue({ id: RUN_ID, state: "processing", reservation_id: RESERVATION });
});

describe("failRun", () => {
  it("ends a cancelled job without touching the run", async () => {
    const { base: input } = base();
    await failRun(input, new JobCancelled());
    expect(m.ownedRun).not.toHaveBeenCalled();
  });
  it("rethrows a retryable provider failure while attempts remain", async () => {
    const retryable = new ProviderError("provider_http_503", true, false);
    await expect(failRun(base().base, retryable)).rejects.toBe(retryable);
    expect(m.ownedRun).not.toHaveBeenCalled();
    const { base: last, calls } = base(5);
    await failRun(last, retryable);
    expect(update(calls)).toMatchObject({ state: "failed", last_error: "provider_http_503" });
  });
  it("releases the whole hold and records a code-owned failure code", async () => {
    const { base: input, calls } = base();
    await failRun(input, errors.validationFailed({ sources: ["no_extractable_content"] }));
    expect(m.settleAllowance).toHaveBeenCalledWith(
      expect.anything(),
      input.ctx,
      RESERVATION,
      { audio: 0, document: 0, regeneration: 0, tts: 0, storage: 0 },
      input.job.now(),
    );
    expect(update(calls)).toEqual({
      state: "failed",
      last_error: "no_extractable_content",
      finished_at: input.job.now(),
      updated_at: input.job.now(),
    });
  });
  it("asks for input after an unknown provider outcome and hides unexpected errors", async () => {
    const uncertain = base();
    await failRun(uncertain.base, new ProviderError("provider_outcome_unknown", false, true));
    expect(update(uncertain.calls)).toMatchObject({
      state: "needs_input",
      last_error: "provider_outcome_unknown",
    });
    const unexpected = base();
    await failRun(unexpected.base, new Error("synthetic crash with class text"));
    expect(update(unexpected.calls)).toMatchObject({ last_error: "processing_failed" });
  });
  it("leaves a run that already ended", async () => {
    m.ownedRun.mockResolvedValue({ id: RUN_ID, state: "ready", reservation_id: RESERVATION });
    const { base: input, calls } = base();
    await failRun(input, errors.conflict());
    expect(m.settleAllowance).not.toHaveBeenCalled();
    expect(update(calls)).toBeUndefined();
  });
});
