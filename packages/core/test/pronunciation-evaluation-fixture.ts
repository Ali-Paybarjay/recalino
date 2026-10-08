import pg from "pg";
import type { Database } from "../src/db";

function assertLoopback(connectionString: string) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("non_local_evaluation_database_rejected");
}
function assertOwnerId(userId: string) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(userId))
    throw new Error("invalid_synthetic_owner");
}

/** Local fixture observations only; financial truth remains the provider generation receipt. */
export async function readSyntheticPronunciationCosts(
  db: Database,
  connectionString: string,
  userId: string,
) {
  assertLoopback(connectionString);
  assertOwnerId(userId);
  return db
    .selectFrom("quota.provider_cost")
    .select(["amount_micros", "estimated_micros", "usage"])
    .where("user_id", "=", userId)
    .execute();
}

/** Deletes only the synthetic fixture account and its unique, owner-checked local queue kind. */
export async function cleanupSyntheticPronunciationFixture(
  connectionString: string,
  userId: string,
  jobKind?: string,
) {
  assertLoopback(connectionString);
  assertOwnerId(userId);
  if (jobKind !== undefined && !/^media\.d46_live_[a-f0-9]{32}$/i.test(jobKind))
    throw new Error("invalid_synthetic_job_kind");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    if (jobKind) {
      const jobs = await client.query("select payload from plt.job where kind=$1", [jobKind]);
      if (jobs.rows.some((job) => job.payload?.userId !== userId))
        throw new Error("synthetic_job_owner_mismatch");
    }
    const account = await client.query("delete from auth.users where id=$1 and email=$2", [
      userId,
      `${userId}@example.test`,
    ]);
    const jobs =
      account.rowCount === 1 && jobKind
        ? await client.query("delete from plt.job where kind=$1", [jobKind])
        : { rowCount: 0 };
    await client.query("commit");
    return {
      syntheticOwnerRemoved: account.rowCount === 1,
      syntheticJobsRemoved: jobs.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}
