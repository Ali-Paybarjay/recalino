import { longestProviderTimeoutMs, providerSettingsSchema } from "@recalino/core/aip";
import { describe, expect, it } from "vitest";
import defaults from "../../../../config/openrouter-defaults.json";
import {
  RUNNER_MAX_SECONDS,
  RUNNER_STEP_SLACK_SECONDS,
  runnerClaimDeadline,
  runnerMarginSeconds,
} from "./jobs";

describe("FR-PLT-005 cron runner claim margin", () => {
  const started = new Date("2026-10-10T00:00:00Z");
  const finishes = (claimedAt: Date, timeoutMs: number) =>
    (claimedAt.getTime() - started.getTime()) / 1000 + timeoutMs / 1000 + RUNNER_STEP_SLACK_SECONDS;

  it("lets the slowest release request claimed at the deadline finish inside the function limit", () => {
    const settings = providerSettingsSchema.parse({ ...defaults, dataContractApproved: true });
    const longest = longestProviderTimeoutMs(settings);
    // D56: Gemini waits up to 180 s; the old fixed 100 s margin could not hold it.
    expect(longest).toBe(180000);
    expect(runnerMarginSeconds(longest)).toBe(200);
    const deadline = runnerClaimDeadline(started, longest);
    expect(finishes(deadline, longest)).toBeLessThanOrEqual(RUNNER_MAX_SECONDS);
  });

  it("keeps at least the original 100 s margin and covers the shared 90 s deadline with slack", () => {
    expect(runnerMarginSeconds()).toBe(100);
    expect(runnerMarginSeconds(30000)).toBe(100);
    expect(runnerMarginSeconds(90000)).toBe(110);
    expect(runnerMarginSeconds(180001)).toBe(201);
    for (const timeoutMs of [1000, 90000, 180000, 600000])
      expect(finishes(runnerClaimDeadline(started, timeoutMs), timeoutMs)).toBeLessThanOrEqual(
        RUNNER_MAX_SECONDS,
      );
    // Without configured provider settings the runner keeps its earlier window.
    expect(runnerClaimDeadline(started).getTime() - started.getTime()).toBe(700000);
  });
});
