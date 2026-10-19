import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { pltPeriodicJobs } from "./maintenance";
import { anonymiseAuditActors, DELETED_ACCOUNT_ACTOR, purgeSecurityEvents } from "./security";
import { DEFAULT_PLT_SETTINGS, readPltSettings } from "./settings";

// SEC-07 (audit 2026-10-18, D95): security events are kept for 90 days; an audit row keeps what
// happened but loses the id of a deleted account.
describe("security and audit record retention (SEC-07)", () => {
  it("keeps security events for 90 days by default, adjustable without a code change", () => {
    expect(DEFAULT_PLT_SETTINGS.securityEventRetentionDays).toBe(90);
    expect(
      readPltSettings({ PLT_SETTINGS_JSON: JSON.stringify({ securityEventRetentionDays: 30 }) })
        .securityEventRetentionDays,
    ).toBe(30);
    expect(() =>
      readPltSettings({ PLT_SETTINGS_JSON: JSON.stringify({ securityEventRetentionDays: 0 }) }),
    ).toThrow(/^Invalid PLT_SETTINGS_JSON: securityEventRetentionDays$/);
  });

  it("runs a daily job that removes only security events older than the retention", async () => {
    const job = pltPeriodicJobs({ ...DEFAULT_PLT_SETTINGS, securityEventRetentionDays: 90 }).find(
      (item) => item.definition.kind === "plt.purge_security_events",
    );
    expect(job?.everySeconds).toBe(24 * 3600);
    const { db, queries } = queryBudgetDatabase([[]]);
    const now = new Date("2026-10-19T12:00:00.000Z");
    await job?.definition.run(
      {},
      {
        db,
        now: () => now,
        job: { id: randomUUID(), attempt: 1 },
        step: async () => "ran",
      },
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toBe('delete from "plt"."security_event" where "occurred_at" < $1');
    expect(queries[0]?.parameters).toEqual([new Date("2026-07-21T12:00:00.000Z")]);
  });

  it("deletes security events before a cutoff and reports how many", async () => {
    const { db, queries } = queryBudgetDatabase([]);
    const before = new Date("2026-01-01T00:00:00.000Z");
    expect(await purgeSecurityEvents(db, before)).toBe(0);
    expect(queries[0]?.parameters).toEqual([before]);
  });

  it("changes only the actor id of a deleted account's audit rows, in bounded batches", async () => {
    const { db, queries } = queryBudgetDatabase([]);
    const ids = Array.from({ length: 501 }, () => randomUUID());
    await anonymiseAuditActors(db, ids);
    expect(queries).toHaveLength(2);
    expect(queries[0]?.sql).toMatch(
      /^update "plt"\."audit_event" set "actor_id" = \$1 where "actor_id" in \(/,
    );
    expect(queries[0]?.parameters[0]).toBe(DELETED_ACCOUNT_ACTOR);
    expect(queries[0]?.parameters).toHaveLength(501);
    expect(queries[1]?.parameters).toEqual([DELETED_ACCOUNT_ACTOR, ids[500]]);
  });

  it("does nothing without ids and never rewrites a system actor name", async () => {
    const { db, queries } = queryBudgetDatabase([]);
    expect(await anonymiseAuditActors(db, [])).toBe(0);
    expect(queries).toHaveLength(0);
    await expect(anonymiseAuditActors(db, ["ops.health_check"])).rejects.toThrow();
    expect(queries).toHaveLength(0);
  });
});
