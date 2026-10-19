import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { pltPeriodicJobs } from "./maintenance";
import {
  anonymiseAuditActors,
  DELETED_ACCOUNT_ACTOR,
  purgeSecurityEvents,
  recordAudit,
} from "./security";
import { DEFAULT_PLT_SETTINGS } from "./settings";

// SEC-07 (audit 2026-10-18, D95), as the application role: migration 20261019120000 grants delete
// on security events and an update of the audit actor only.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());

async function securityEvent(occurredAt: Date) {
  const requestId = randomUUID();
  await db
    .insertInto("plt.security_event")
    .values({
      kind: "ownership_denied",
      user_id: randomUUID(),
      request_id: requestId,
      occurred_at: occurredAt,
    })
    .execute();
  return requestId;
}
const remaining = (requestId: string) =>
  db.selectFrom("plt.security_event").select("id").where("request_id", "=", requestId).execute();

describe("security and audit record retention (SEC-07)", () => {
  it("removes security events older than the retention and keeps newer ones", async () => {
    // Far in the past, so no event of another test is older than these cutoffs.
    const old = await securityEvent(new Date("2001-01-01T00:00:00Z"));
    const recent = await securityEvent(new Date("2001-04-01T00:00:00Z"));
    const job = pltPeriodicJobs(DEFAULT_PLT_SETTINGS).find(
      (item) => item.definition.kind === "plt.purge_security_events",
    );
    if (!job) throw new Error("missing purge job");
    // 90 days before 2001-05-01 is 2001-01-31: the January event goes, the April one stays.
    await job.definition.run(
      {},
      {
        db,
        now: () => new Date("2001-05-01T00:00:00Z"),
        job: { id: randomUUID(), attempt: 1 },
        step: async () => "ran",
      },
    );
    expect(await remaining(old)).toHaveLength(0);
    expect(await remaining(recent)).toHaveLength(1);
    expect(await purgeSecurityEvents(db, new Date("2001-01-01T00:00:00Z"))).toBe(0);
  });

  it("replaces a deleted account's id as audit actor and keeps the rest of the record", async () => {
    const deleted = randomUUID();
    const kept = randomUUID();
    const subjectId = randomUUID();
    for (const actorId of [deleted, deleted, kept])
      await recordAudit(db, {
        actorKind: "learner",
        actorId,
        action: "test.sec07",
        subjectType: "processing_run",
        subjectId,
      });
    expect(await anonymiseAuditActors(db, [deleted])).toBe(2);
    expect(await anonymiseAuditActors(db, [deleted])).toBe(0);
    const rows = await db
      .selectFrom("plt.audit_event")
      .select(["actor_kind", "actor_id", "action", "subject_id"])
      .where("subject_id", "=", subjectId)
      .orderBy("id")
      .execute();
    expect(rows).toEqual([
      {
        actor_kind: "learner",
        actor_id: DELETED_ACCOUNT_ACTOR,
        action: "test.sec07",
        subject_id: subjectId,
      },
      {
        actor_kind: "learner",
        actor_id: DELETED_ACCOUNT_ACTOR,
        action: "test.sec07",
        subject_id: subjectId,
      },
      { actor_kind: "learner", actor_id: kept, action: "test.sec07", subject_id: subjectId },
    ]);
  });

  it("grants no other change to the audit trail", async () => {
    const subjectId = randomUUID();
    await recordAudit(db, {
      actorKind: "learner",
      actorId: randomUUID(),
      action: "test.sec07",
      subjectType: "processing_run",
      subjectId,
    });
    // Another column: no privilege. Another actor value: refused by the trigger. No delete.
    await expect(
      sql`update plt.audit_event set reason = 'x' where subject_id = ${subjectId}`.execute(db),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      sql`update plt.audit_event set actor_id = 'operator-x' where subject_id = ${subjectId}`.execute(
        db,
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      sql`delete from plt.audit_event where subject_id = ${subjectId}`.execute(db),
    ).rejects.toMatchObject({
      code: "42501",
    });
  });
});
