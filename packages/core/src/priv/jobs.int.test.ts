import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { DELETED_ACCOUNT_ACTOR, recordAudit } from "../plt";
import { privacyPeriodicJobs } from "./jobs";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());

async function deletion(kind: "account" | "session", state: "completed" | "needs_operator") {
  const userId = randomUUID();
  await db
    .insertInto("priv.deletion_request")
    .values({
      user_id: userId,
      kind,
      subject_id: kind === "account" ? userId : randomUUID(),
      operation_key: randomUUID(),
      state,
    })
    .execute();
  return userId;
}

// SEC-07 (audit 2026-10-18, D95): an account deleted before account cleanup removed its id from
// the audit trail is covered by the daily job, at run time and not by the migration.
it("removes only fully deleted accounts' ids from the audit trail", async () => {
  const deleted = await deletion("account", "completed");
  const stopped = await deletion("account", "needs_operator");
  const sessionOnly = await deletion("session", "completed");
  const subjectId = randomUUID();
  for (const actorId of [deleted, stopped, sessionOnly])
    await recordAudit(db, {
      actorKind: "learner",
      actorId,
      action: "test.sec07",
      subjectType: "processing_run",
      subjectId,
    });
  const [job] = privacyPeriodicJobs();
  if (!job) throw new Error("missing job");
  const context = {
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async () => "ran" as const,
  };
  await job.definition.run({}, context);
  // Safe to repeat.
  await job.definition.run({}, context);
  const actors = await db
    .selectFrom("plt.audit_event")
    .select("actor_id")
    .where("subject_id", "=", subjectId)
    .orderBy("id")
    .execute();
  expect(actors.map((row) => row.actor_id)).toEqual([DELETED_ACCOUNT_ACTOR, stopped, sessionOnly]);
});
