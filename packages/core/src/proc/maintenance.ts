import type { Database } from "../db";
import { AppError, emptyPayload, type PeriodicJob } from "../plt";
import { getSource, readInputContract } from "../src";
import { sourceSnapshotSchema } from "./contracts";
import { failAwaitingUploadRun } from "./runs";

/** The recorded SRC contract sets each audio upload's timeout; commercial limits are never guessed. */
export async function expireAwaitingUploads(db: Database, now = new Date()): Promise<number> {
  const runs = await db
    .selectFrom("proc.processing_run")
    .select(["id", "user_id", "input_snapshot", "created_at"])
    .where("state", "=", "awaiting_upload")
    .orderBy("created_at")
    .limit(250)
    .execute();
  let expired = 0;
  for (const run of runs) {
    const ctx = { userId: run.user_id, requestId: `expire:${run.id}` };
    let deadline = Number.POSITIVE_INFINITY;
    try {
      for (const source of sourceSnapshotSchema
        .parse(run.input_snapshot)
        .sources.filter((item) => item.kind === "audio")) {
        const asset = await getSource(db, ctx, source.sourceId);
        const contract = await readInputContract(db, asset.contract_version);
        deadline = Math.min(deadline, run.created_at.getTime() + contract.uploadTtlSeconds * 1000);
      }
    } catch (error) {
      if (!(error instanceof AppError && error.code === "not_found")) throw error;
      deadline = 0;
    }
    if (deadline <= now.getTime()) {
      const result = await failAwaitingUploadRun(db, ctx, run.id, "audio_upload_rejected", now);
      if (result.state === "needs_input") expired++;
    }
  }
  return expired;
}
export function processingPeriodicJobs(): PeriodicJob[] {
  return [
    {
      everySeconds: 300,
      definition: {
        kind: "proc.expire_uploads",
        version: 1,
        payload: emptyPayload,
        async run(_payload, job) {
          await expireAwaitingUploads(job.db, job.now());
        },
      },
    },
  ];
}
