// OPS-02 (audit 2026-10-18): thresholds of the hourly health check.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db";
import {
  DEFAULT_HEALTH_SETTINGS,
  evaluateHealth,
  healthWindowStart,
  readHealth,
  readHealthSettings,
} from "./health";

// P2-03: an in-memory stand-in for the three read-only sources readHealth uses, so the window is
// tested with fixed times only. Each list holds when a check succeeded or a job or run failed.
const store = vi.hoisted(() => ({
  checks: [] as Date[],
  failedJobs: [] as Date[],
  failedRuns: [] as Date[],
  kinds: [] as string[],
}));
const within = (times: Date[], since: Date, until: Date) =>
  times.filter((at) => at >= since && at <= until).length;

vi.mock("../plt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plt")>()),
  lastSucceededJobAt: vi.fn(async (_db: unknown, kind: string, before: Date) => {
    store.kinds.push(kind);
    const done = store.checks.filter((at) => at <= before).map((at) => at.getTime());
    return done.length ? new Date(Math.max(...done)) : null;
  }),
  readPlatformHealth: vi.fn(async (_db: unknown, now: Date, since?: Date) => ({
    databaseBytes: 1,
    failedJobsLastHour: within(store.failedJobs, since ?? new Date(now.getTime() - 3_600_000), now),
    oldestQueuedAt: null,
    lastRunnerAt: now,
  })),
}));
vi.mock("../proc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../proc")>()),
  countFailedRuns: vi.fn(async (_db: unknown, window: { since: Date; until: Date }) =>
    within(store.failedRuns, window.since, window.until),
  ),
}));

const now = new Date("2026-10-19T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const healthy = {
  databaseBytes: 50_000_000,
  failedJobsLastHour: 0,
  failedRunsLastHour: 0,
  oldestQueuedAt: minutesAgo(1),
  lastRunnerAt: minutesAgo(1),
};
const open = (signals: ReturnType<typeof evaluateHealth>) =>
  signals.filter((signal) => signal.open).map((signal) => signal.condition);

describe("OPS-02 health thresholds", () => {
  it("raises nothing for a healthy system", () => {
    expect(open(evaluateHealth(healthy, now, DEFAULT_HEALTH_SETTINGS))).toEqual([]);
    expect(
      open(evaluateHealth({ ...healthy, oldestQueuedAt: null }, now, DEFAULT_HEALTH_SETTINGS)),
    ).toEqual([]);
  });

  it("raises each signal over its threshold, with the measured value", () => {
    const signals = evaluateHealth(
      {
        databaseBytes: 400_000_000,
        failedJobsLastHour: 2,
        failedRunsLastHour: 1,
        oldestQueuedAt: minutesAgo(16),
        lastRunnerAt: minutesAgo(20),
      },
      now,
      DEFAULT_HEALTH_SETTINGS,
    );
    expect(open(signals)).toEqual([
      "database_size",
      "failed_jobs",
      "failed_runs",
      "queue_delay",
      "runner_stale",
    ]);
    expect(signals.find((signal) => signal.condition === "queue_delay")?.measured).toBe(
      16 * 60_000,
    );
  });

  // P1-09 (RR-10): a failed processing run ends its job successfully, so failed_jobs stays closed;
  // failed_runs opens on any failed run in the last hour and stays closed at zero.
  it("opens failed_runs when a processing run failed, even with no failed job", () => {
    const failedRuns = (count: number) =>
      evaluateHealth({ ...healthy, failedRunsLastHour: count }, now, DEFAULT_HEALTH_SETTINGS).find(
        (signal) => signal.condition === "failed_runs",
      );
    expect(failedRuns(0)).toEqual({ condition: "failed_runs", open: false, measured: 0 });
    expect(failedRuns(1)).toEqual({ condition: "failed_runs", open: true, measured: 1 });
    expect(failedRuns(3)).toEqual({ condition: "failed_runs", open: true, measured: 3 });
    expect(
      open(evaluateHealth({ ...healthy, failedRunsLastHour: 2 }, now, DEFAULT_HEALTH_SETTINGS)),
    ).toEqual(["failed_runs"]);
  });

  it("counts a database without any runner record as a stale runner", () => {
    expect(
      open(evaluateHealth({ ...healthy, lastRunnerAt: null }, now, DEFAULT_HEALTH_SETTINGS)),
    ).toEqual(["runner_stale"]);
  });

  it("reads overrides from RECALINO_HEALTH_JSON and names invalid ones without values", () => {
    expect(readHealthSettings({})).toBe(DEFAULT_HEALTH_SETTINGS);
    expect(readHealthSettings({ RECALINO_HEALTH_JSON: '{"failedJobsPerHour":5}' })).toEqual({
      ...DEFAULT_HEALTH_SETTINGS,
      failedJobsPerHour: 5,
    });
    expect(() => readHealthSettings({ RECALINO_HEALTH_JSON: "{" })).toThrow(/not valid JSON/);
    expect(() => readHealthSettings({ RECALINO_HEALTH_JSON: '{"queuedAgeSeconds":1}' })).toThrow(
      /^Invalid RECALINO_HEALTH_JSON: queuedAgeSeconds$/,
    );
  });
});

// P2-03 (CWE-778): the check is queued on a wall-clock key, so two checks may be more than an hour
// apart. Both failure counts start one hour before the last successful check finished (at most 24
// hours back), or one hour back without one. Fixed times only: the real clock is faked far away.
describe("P2-03 gapless health window", () => {
  const db = {} as Database;
  const hoursAgo = (hours: number) => minutesAgo(hours * 60);
  const failedSignals = async (at: Date) =>
    open(evaluateHealth(await readHealth(db, at), at, DEFAULT_HEALTH_SETTINGS)).filter(
      (condition) => condition === "failed_jobs" || condition === "failed_runs",
    );
  const failAt = (at: Date) => {
    store.failedJobs.push(at);
    store.failedRuns.push(at);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    store.checks.length = 0;
    store.failedJobs.length = 0;
    store.failedRuns.length = 0;
    store.kinds.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the alert for a failure between two checks 2.5 hours apart", async () => {
    const first = hoursAgo(2.5);
    expect(await failedSignals(first)).toEqual([]);
    store.checks.push(first);
    failAt(minutesAgo(90));
    const reading = await readHealth(db, now);
    expect(reading.failedJobsLastHour).toBe(1);
    expect(reading.failedRunsLastHour).toBe(1);
    expect(await failedSignals(now)).toEqual(["failed_jobs", "failed_runs"]);
    expect(store.kinds.every((kind) => kind === "ops.health_check")).toBe(true);
    expect(healthWindowStart(now, first)).toEqual(hoursAgo(3.5));
  });

  it("counts one hour back when no check succeeded before", async () => {
    expect(healthWindowStart(now, null)).toEqual(hoursAgo(1));
    failAt(minutesAgo(61));
    expect(await failedSignals(now)).toEqual([]);
    failAt(minutesAgo(59));
    const reading = await readHealth(db, now);
    expect(reading.failedJobsLastHour).toBe(1);
    expect(reading.failedRunsLastHour).toBe(1);
    expect(await failedSignals(now)).toEqual(["failed_jobs", "failed_runs"]);
  });

  it("counts at most 24 hours back after a long gap", async () => {
    store.checks.push(hoursAgo(30));
    expect(healthWindowStart(now, hoursAgo(30))).toEqual(hoursAgo(24));
    failAt(hoursAgo(25));
    expect(await failedSignals(now)).toEqual([]);
    failAt(hoursAgo(23));
    const reading = await readHealth(db, now);
    expect(reading.failedJobsLastHour).toBe(1);
    expect(reading.failedRunsLastHour).toBe(1);
  });

  it("overlaps: counts a failure 30 minutes before the previous check finished", async () => {
    const previous = hoursAgo(1);
    store.checks.push(previous);
    failAt(new Date(previous.getTime() - 61 * 60_000));
    expect(await failedSignals(now)).toEqual([]);
    failAt(new Date(previous.getTime() - 30 * 60_000));
    const reading = await readHealth(db, now);
    expect(reading.failedJobsLastHour).toBe(1);
    expect(reading.failedRunsLastHour).toBe(1);
    expect(await failedSignals(now)).toEqual(["failed_jobs", "failed_runs"]);
  });

  it("never narrows the window below one hour", () => {
    expect(healthWindowStart(now, minutesAgo(10))).toEqual(minutesAgo(70));
    expect(healthWindowStart(now, new Date(now.getTime() + 600_000))).toEqual(hoursAgo(1));
  });
});
