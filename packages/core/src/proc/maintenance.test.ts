import { describe, expect, it } from "vitest";
import type { JobState } from "../plt";
import {
  ENDED_JOB_RUN_ERROR,
  endedJobRunOutcome,
  expiredUploadCode,
  runsLeftByEndedJobs,
} from "./maintenance";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";

// FR-SRC-007: only the verifier's refusal says the audio failed; a lapsed upload can be resent.
it.each([
  [new Map<string, string>(), "audio_upload_not_started"],
  [new Map([[first, "pending"]]), "audio_upload_incomplete"],
  [new Map([[first, "verified"]]), "audio_upload_incomplete"],
  [
    new Map([
      [first, "verified"],
      [second, "rejected"],
    ]),
    "audio_upload_rejected",
  ],
])("names an expired upload with receipts %o as %s", (receipts, code) => {
  expect(expiredUploadCode([first, second], receipts)).toBe(code);
});

// PRD-02: a run whose job ended (lease expired on its last attempt, or cancelled) without the
// worker settling it is closed by reconciliation; every other run is left to its job.
describe("runs left by ended jobs", () => {
  const states = new Map<string, JobState>([
    ["failed-job", "failed"],
    ["cancelled-job", "cancelled"],
    ["queued-job", "queued"],
    ["running-job", "running"],
    ["retry-job", "retry_scheduled"],
    ["succeeded-job", "succeeded"],
  ]);
  const run = (id: string, state: string, jobId: string | null) => ({ id, state, jobId });

  it("closes processing and queued runs whose job failed or was cancelled", () => {
    expect(
      runsLeftByEndedJobs(
        [run("a", "processing", "failed-job"), run("b", "queued", "cancelled-job")],
        states,
      ),
    ).toEqual(["a", "b"]);
  });

  it("closes a run whose finished job was already purged", () => {
    expect(runsLeftByEndedJobs([run("a", "processing", "purged-job")], states)).toEqual(["a"]);
  });

  it.each(["queued-job", "running-job", "retry-job", "succeeded-job"])(
    "leaves a run whose job is %s to that job",
    (jobId) => {
      expect(runsLeftByEndedJobs([run("a", "processing", jobId)], states)).toEqual([]);
    },
  );

  it.each(["awaiting_upload", "ready", "partial_ready", "failed", "needs_input", "cancelled"])(
    "never touches a %s run",
    (state) => {
      expect(runsLeftByEndedJobs([run("a", state, "failed-job")], states)).toEqual([]);
    },
  );

  it("leaves a run that has no job yet", () => {
    expect(runsLeftByEndedJobs([run("a", "queued", null)], states)).toEqual([]);
  });

  it("fails a run with one fixed, identifier-only error code", () => {
    expect(ENDED_JOB_RUN_ERROR).toBe("processing_interrupted");
    expect(endedJobRunOutcome(false)).toEqual({ state: "failed", code: ENDED_JOB_RUN_ERROR });
  });

  it("keeps a provider request in flight for the operator, as the reclaimed worker does", () => {
    expect(endedJobRunOutcome(true)).toEqual({
      state: "needs_input",
      code: "provider_outcome_unresolved",
    });
  });
});
