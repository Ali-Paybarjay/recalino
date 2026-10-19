// SEC-07 (audit 2026-10-18, D95): an audit row keeps what happened, never who a deleted account
// was. Account cleanup removes the id when it completes (deletion.ts); this daily job covers
// accounts whose deletion completed before that step existed, at run time rather than in a
// migration, and is safe to repeat.
import type { Database } from "../db";
import { anonymiseAuditActors, emptyPayload, type PeriodicJob } from "../plt";

/** Removes the ids of fully deleted accounts from the audit trail; returns the rows changed. */
export async function anonymiseDeletedAccountActors(db: Database): Promise<number> {
  const deleted = await db
    .selectFrom("priv.deletion_request")
    .select("user_id")
    .where("kind", "=", "account")
    .where("state", "=", "completed")
    .execute();
  return anonymiseAuditActors(
    db,
    deleted.map((row) => row.user_id),
  );
}

export function privacyPeriodicJobs(): PeriodicJob[] {
  return [
    {
      everySeconds: 24 * 3600,
      definition: {
        kind: "priv.anonymise_deleted_actors",
        version: 1,
        payload: emptyPayload,
        run: async (_payload, ctx) => {
          await anonymiseDeletedAccountActors(ctx.db);
        },
      },
    },
  ];
}
