import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { DELETED_ACCOUNT_ACTOR } from "../plt";
import { anonymiseDeletedAccountActors, privacyPeriodicJobs } from "./jobs";

// SEC-07 (audit 2026-10-18, D95): accounts whose deletion completed before account cleanup removed
// their id from the audit trail are covered at run time by a daily job, not by the migration.
describe("audit actors of deleted accounts (SEC-07)", () => {
  it("reads completed account deletions and removes those ids from the audit trail", async () => {
    const first = randomUUID();
    const second = randomUUID();
    const { db, queries } = queryBudgetDatabase([[{ user_id: first }, { user_id: second }]]);
    await anonymiseDeletedAccountActors(db);
    expect(queries[0]?.sql).toBe(
      'select "user_id" from "priv"."deletion_request" where "kind" = $1 and "state" = $2',
    );
    expect(queries[0]?.parameters).toEqual(["account", "completed"]);
    expect(queries[1]?.sql).toMatch(/^update "plt"\."audit_event" set "actor_id" = \$1/);
    expect(queries[1]?.parameters).toEqual([DELETED_ACCOUNT_ACTOR, first, second]);
  });

  it("runs daily as priv.anonymise_deleted_actors", async () => {
    const [job] = privacyPeriodicJobs();
    expect(job?.definition.kind).toBe("priv.anonymise_deleted_actors");
    expect(job?.everySeconds).toBe(24 * 3600);
    const { db, queries } = queryBudgetDatabase([[]]);
    await job?.definition.run(
      {},
      {
        db,
        now: () => new Date(),
        job: { id: randomUUID(), attempt: 1 },
        step: async () => "ran",
      },
    );
    // No completed account deletion: one read, no update.
    expect(queries).toHaveLength(1);
  });
});
