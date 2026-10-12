import type { Database } from "../db";
import { AppError, emptyPayload, type PeriodicJob } from "../plt";
import { getSource, readInputContract, temporaryAudioUploadStates } from "../src";
import { sourceSnapshotSchema } from "./contracts";
import { type AwaitingUploadFailure, failAwaitingUploadRun } from "./runs";

/**
 * Why an awaiting run ran out of time. Only a verifier rejection says the audio itself failed; an
 * upload that never started or never finished keeps the device original valid for a new attempt.
 */
export function expiredUploadCode(
  audioSourceIds: readonly string[],
  receipts: ReadonlyMap<string, string>,
): AwaitingUploadFailure {
  if (audioSourceIds.some((id) => receipts.get(id) === "rejected")) return "audio_upload_rejected";
  if (audioSourceIds.some((id) => receipts.has(id))) return "audio_upload_incomplete";
  return "audio_upload_not_started";
}
/** The recorded SRC contract sets each audio upload's timeout; commercial limits are never guessed. */
export async function expireAwaitingUploads(db: Database, now = new Date()): Promise<number> {
  const runs = await db
    .selectFrom("proc.processing_run")
    .select(["id", "user_id", "input_snapshot", "reservation_id", "created_at"])
    .where("state", "=", "awaiting_upload")
    .orderBy("created_at")
    .limit(250)
    .execute();
  let expired = 0;
  for (const run of runs) {
    const ctx = { userId: run.user_id, requestId: `expire:${run.id}` };
    let deadline = Number.POSITIVE_INFINITY;
    let missingSource = false;
    const audio = sourceSnapshotSchema
      .parse(run.input_snapshot)
      .sources.filter((item) => item.kind === "audio");
    try {
      for (const source of audio) {
        const asset = await getSource(db, ctx, source.sourceId);
        const contract = await readInputContract(db, asset.contract_version);
        deadline = Math.min(deadline, run.created_at.getTime() + contract.uploadTtlSeconds * 1000);
      }
    } catch (error) {
      if (!(error instanceof AppError && error.code === "not_found")) throw error;
      deadline = 0;
      missingSource = true;
    }
    if (deadline <= now.getTime()) {
      // A deleted source keeps the earlier code: no saved original can be promised for it.
      const code = missingSource
        ? "audio_upload_rejected"
        : expiredUploadCode(
            audio.map((source) => source.sourceId),
            await temporaryAudioUploadStates(db, ctx, run.reservation_id),
          );
      const result = await failAwaitingUploadRun(db, ctx, run.id, code, now);
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
