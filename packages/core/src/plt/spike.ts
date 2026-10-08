// SPIKE-05 only (M4): reads and clean-up for the cloud measurements, kept inside PLT so module
// tables stay in their module (ADR-0002 rule 4). Removed with the spike (T6).
import type { Database } from "../db";
import { deleteObject, type ObjectStore } from "./storage";

export async function spikeJobReport(db: Database, ids: string[]) {
  const jobs = await db
    .selectFrom("plt.job")
    .select(["id", "state", "attempt", "last_error", "created_at", "updated_at", "finished_at"])
    .where("id", "in", ids)
    .execute();
  const steps = await db
    .selectFrom("plt.job_step")
    .select(["job_id", "step", "done_at"])
    .where("job_id", "in", ids)
    .execute();
  const effects = await db
    .selectFrom("plt.audit_event")
    .select(["subject_id", "action"])
    .where("actor_id", "=", "spike-05")
    .where("subject_id", "in", ids)
    .execute();
  return { jobs, steps, effects };
}

export async function spikeObjects(db: Database, ids: string[]) {
  const rows = await db
    .selectFrom("plt.storage_object")
    .select(["id", "key", "size_bytes", "content_type"])
    .where("id", "in", ids)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    size: Number(row.size_bytes),
    type: row.content_type,
  }));
}

export async function spikeCleanup(db: Database, store: ObjectStore, now: Date) {
  const left = await db
    .selectFrom("plt.storage_object")
    .select("id")
    .where("owner_module", "=", "spike")
    .where("state", "!=", "deleted")
    .execute();
  for (const row of left) await deleteObject(db, store, "system", row.id, now);
  const jobs = await db.deleteFrom("plt.job").where("kind", "like", "spike.%").executeTakeFirst();
  return { objectsDeleted: left.length, jobsDeleted: Number(jobs.numDeletedRows) };
}
