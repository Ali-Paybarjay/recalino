import { sql } from "kysely";
import { z } from "zod";
import type { Database } from "../db";
import { AppError, emptyPayload, type PeriodicJob } from "../plt";
import { getSource, readInputContract, temporaryAudioUploadStates } from "../src";
import { snapshotSourceSchema } from "./contracts";
import { type AwaitingUploadFailure, failAwaitingUploadRun } from "./runs";

const audioSourceIdsSchema = z.array(snapshotSourceSchema.shape.sourceId);

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
/**
 * Runs waiting for an audio upload, each with only the audio source ids of its snapshot. D73: a
 * regeneration's snapshot carries every extracted transcript and page (up to about 700 KB), and this
 * check runs every five minutes, so the snapshot itself never crosses the pooler here.
 */
export async function awaitingUploadRuns(db: Database) {
  return db
    .selectFrom("proc.processing_run")
    .select([
      "id",
      "user_id",
      "reservation_id",
      "created_at",
      // Not an array means a malformed snapshot: null fails validation, as the whole parse did.
      sql<unknown>`case when jsonb_typeof(input_snapshot->'sources') = 'array' then coalesce((
        select jsonb_agg(source->'sourceId' order by ordinal)
        from jsonb_array_elements(input_snapshot->'sources') with ordinality as sources(source, ordinal)
        where source->>'kind' = 'audio'), '[]'::jsonb) end`.as("audio_source_ids"),
    ])
    .where("state", "=", "awaiting_upload")
    .orderBy("created_at")
    .limit(250)
    .execute();
}
/** The recorded SRC contract sets each audio upload's timeout; commercial limits are never guessed. */
export async function expireAwaitingUploads(db: Database, now = new Date()): Promise<number> {
  let expired = 0;
  for (const run of await awaitingUploadRuns(db)) {
    const ctx = { userId: run.user_id, requestId: `expire:${run.id}` };
    let deadline = Number.POSITIVE_INFINITY;
    let missingSource = false;
    const audio = audioSourceIdsSchema.parse(run.audio_source_ids);
    try {
      for (const sourceId of audio) {
        const asset = await getSource(db, ctx, sourceId);
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
        : expiredUploadCode(audio, await temporaryAudioUploadStates(db, ctx, run.reservation_id));
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
