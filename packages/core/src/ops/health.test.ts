// OPS-02 (audit 2026-10-18): thresholds of the hourly health check.
import { describe, expect, it } from "vitest";
import { DEFAULT_HEALTH_SETTINGS, evaluateHealth, readHealthSettings } from "./health";

const now = new Date("2026-10-19T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const healthy = {
  databaseBytes: 50_000_000,
  failedJobsLastHour: 0,
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
        oldestQueuedAt: minutesAgo(16),
        lastRunnerAt: minutesAgo(20),
      },
      now,
      DEFAULT_HEALTH_SETTINGS,
    );
    expect(open(signals)).toEqual(["database_size", "failed_jobs", "queue_delay", "runner_stale"]);
    expect(signals.find((signal) => signal.condition === "queue_delay")?.measured).toBe(
      16 * 60_000,
    );
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
