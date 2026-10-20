import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dateLabel, SystemHealthCard } from "./CoreScreens";
import type { SystemHealth } from "./contracts";
import { systemHealthCopy } from "./copy";

const healthy: SystemHealth = {
  checkedAt: "2026-10-19T10:00:00.000Z",
  databaseBytes: 123_456_789,
  databaseBytesLimit: 400_000_000,
  failedJobsLastHour: 0,
  oldestQueuedAt: null,
  lastRunnerAt: "2026-10-19T09:55:00.000Z",
  schema: { state: "current", expected: "20261015120000", applied: "20261015120000" },
  alerts: [],
};
const render = (health: SystemHealth, locale: "en" | "fa" = "en") =>
  renderToStaticMarkup(createElement(SystemHealthCard, { health, locale }));

// OPS-02 (ADM-01, ADM-12): the overview's System health card, from the hourly check's signals.
describe("System health card (OPS-02)", () => {
  it("shows every signal and says that none is over its threshold", () => {
    const html = render(healthy);
    for (const label of [
      "System health",
      "Database size",
      "123.5 MB of 400 MB alert limit",
      "Jobs failed in the last hour",
      "Longest wait in the queue",
      "Last job runner run",
      dateLabel(healthy.lastRunnerAt, "en"),
      "Database schema",
      "Up to date",
      "No signal is over its threshold.",
    ])
      expect(html).toContain(label);
    for (const alert of Object.values(systemHealthCopy.alert)) expect(html).not.toContain(alert.en);
  });

  it("names each open alert and the schema state that pauses the jobs", () => {
    const html = render({
      ...healthy,
      failedJobsLastHour: 2,
      oldestQueuedAt: "2026-10-19T09:48:00.000Z",
      lastRunnerAt: null,
      schema: { state: "behind", expected: "20261019120000", applied: "20261015120000" },
      alerts: ["failed_jobs", "queue_delay", "runner_stale"],
    });
    expect(html).toContain("A job failed and will not retry.");
    expect(html).toContain("Jobs are waiting longer than expected.");
    expect(html).toContain("The job runner has not run recently.");
    expect(html).not.toContain("The database is near its size limit.");
    expect(html).not.toContain("No signal is over its threshold.");
    expect(html).toContain("A migration is missing; jobs are paused");
    expect(html).toContain("12 mins");
  });

  it("says the schema cannot be checked when the comparison is missing", () => {
    expect(render({ ...healthy, schema: null })).toContain("Cannot be checked");
    expect(
      render({ ...healthy, schema: { state: "ahead", expected: "1", applied: "2" } }),
    ).toContain("Newer than the app");
  });

  it("speaks Persian in the Persian console", () => {
    const html = render({ ...healthy, alerts: ["database_size"] }, "fa");
    expect(html).toContain("سلامت سامانه");
    expect(html).toContain("۱۲۳٫۵ MB از آستانهٔ هشدار ۴۰۰ MB");
    expect(html).toContain("دیتابیس به سقف حجم نزدیک است.");
    expect(html).toContain("به‌روز");
    expect(html).not.toContain("System health");
  });
});
