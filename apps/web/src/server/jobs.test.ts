import { longestProviderTimeoutMs, providerSettingsSchema } from "@recalino/core/aip";
import type { Database } from "@recalino/core/db";
import { DEFAULT_PLT_SETTINGS, type SchemaGuard } from "@recalino/core/plt";
import { describe, expect, it } from "vitest";
import defaults from "../../../../config/openrouter-defaults.json";
import {
  periodicJobs,
  processingWakeBudgetSeconds,
  RUNNER_MAX_SECONDS,
  RUNNER_STEP_SLACK_SECONDS,
  runJobsHandler,
  runnerClaimDeadline,
  runnerMarginSeconds,
} from "./jobs";
import { EXPECTED_SCHEMA_VERSION } from "./schema-version.generated";

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

describe("FR-PLT-005 processing wake budget", () => {
  // The waking request may have used one finish margin (30 s) before after() starts, and
  // handlers return another 30 s before the function limit.
  const handlersFinish = RUNNER_MAX_SECONDS - 60;

  it("lets a Gemini request claimed at the end of the wake finish before handlers must return", () => {
    const settings = providerSettingsSchema.parse({ ...defaults, dataContractApproved: true });
    const longest = longestProviderTimeoutMs(settings);
    const budget = processingWakeBudgetSeconds(longest);
    expect(budget).toBe(540);
    expect(budget + longest / 1000 + RUNNER_STEP_SLACK_SECONDS).toBeLessThanOrEqual(handlersFinish);
  });

  it("keeps the 600 s wake when no configured deadline needs more", () => {
    expect(processingWakeBudgetSeconds()).toBe(600);
    expect(processingWakeBudgetSeconds(90000)).toBe(600);
    for (const timeoutMs of [1000, 90000, 180000, 300000])
      expect(
        processingWakeBudgetSeconds(timeoutMs) + timeoutMs / 1000 + RUNNER_STEP_SLACK_SECONDS,
      ).toBeLessThanOrEqual(handlersFinish);
  });
});

describe("OPS-05 runner on a database that is behind the code", () => {
  // Any use of the database fails the test: the runner must stop before mail, periodic jobs or a claim.
  const untouchable = new Proxy({} as Database, {
    get() {
      throw new Error("the runner touched the database");
    },
  });
  const behind: SchemaGuard = {
    check: async () => ({
      state: "behind",
      expected: EXPECTED_SCHEMA_VERSION,
      applied: "20260930175238",
    }),
    allowsWork: async () => false,
  };

  it("claims nothing and reports why", async () => {
    const handler = runJobsHandler({
      schema: behind,
      settings: () => DEFAULT_PLT_SETTINGS,
      log: () => {},
      now: () => new Date("2026-10-19T00:00:00Z"),
    });
    const result = await handler({
      request: new Request("http://localhost/api/jobs/run"),
      input: undefined,
      ctx: { requestId: "r", route: "jobs_run", userId: null },
      db: untouchable,
    });
    expect(result.body).toEqual({
      swept: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      cancelled: 0,
      schemaBehind: true,
    });
  });

  it("knows the newest migration it was built against", () => {
    expect(EXPECTED_SCHEMA_VERSION).toMatch(/^\d{14}$/);
  });
});

describe("OPS-02 hourly health check", () => {
  it("is registered with the periodic jobs", () => {
    const health = periodicJobs(DEFAULT_PLT_SETTINGS).find(
      (job) => job.definition.kind === "ops.health_check",
    );
    expect(health?.everySeconds).toBe(3600);
  });
});
