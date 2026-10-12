import type { Database } from "@recalino/core/db";
import { sql } from "kysely";

/**
 * NFR-07: per-run stage durations of class processing, from timestamps the service already keeps.
 * Read-only and content-free: identifiers, states and times only, never class text or audio.
 */
export const STAGES = [
  "upload_wait",
  "upload_transfer",
  "queue",
  "transcription",
  "board_photos",
  "lesson",
  "voice",
  "publication",
  "total",
] as const;
export type Stage = (typeof STAGES)[number];

export interface RunTimes {
  runId: string;
  state: string;
  createdAt: Date;
  finishedAt: Date | null;
  uploadStartedAt: Date | null;
  uploadVerifiedAt: Date | null;
  sttStartedAt: Date | null;
  sttFinishedAt: Date | null;
  visionStartedAt: Date | null;
  visionFinishedAt: Date | null;
  lessonStartedAt: Date | null;
  lessonFinishedAt: Date | null;
  voiceStartedAt: Date | null;
  voiceFinishedAt: Date | null;
}

const seconds = (from: Date | null, to: Date | null) =>
  from && to && to >= from ? (to.getTime() - from.getTime()) / 1000 : null;
const latest = (...times: (Date | null)[]) =>
  times.reduce<Date | null>((last, time) => (time && (!last || time > last) ? time : last), null);
const earliest = (...times: (Date | null)[]) =>
  times.reduce<Date | null>(
    (first, time) => (time && (!first || time < first) ? time : first),
    null,
  );

/**
 * Stage boundaries. Upload: run creation → first upload start → last verified original. Queue:
 * ready input → first provider call. Provider stages span their first start to last finish and
 * may overlap. Publication: last provider or voice result → run finished.
 */
export function stageDurations(run: RunTimes): Record<Stage, number | null> {
  const inputReady = run.uploadVerifiedAt ?? run.createdAt;
  const firstCall = earliest(run.sttStartedAt, run.visionStartedAt, run.lessonStartedAt);
  const lastResult = latest(
    run.sttFinishedAt,
    run.visionFinishedAt,
    run.lessonFinishedAt,
    run.voiceFinishedAt,
  );
  return {
    upload_wait: seconds(run.createdAt, run.uploadStartedAt),
    upload_transfer: seconds(run.uploadStartedAt, run.uploadVerifiedAt),
    queue: seconds(inputReady, firstCall),
    transcription: seconds(run.sttStartedAt, run.sttFinishedAt),
    board_photos: seconds(run.visionStartedAt, run.visionFinishedAt),
    lesson: seconds(run.lessonStartedAt, run.lessonFinishedAt),
    voice: seconds(run.voiceStartedAt, run.voiceFinishedAt),
    publication: seconds(lastResult, run.finishedAt),
    total: seconds(run.createdAt, run.finishedAt),
  };
}

/** Nearest-rank percentile of the measured values; null when nothing was measured. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ??
    null
  );
}

export function summarize(runs: readonly RunTimes[]) {
  const perRun = runs.map((run) => ({
    runId: run.runId,
    state: run.state,
    seconds: stageDurations(run),
  }));
  const stages = Object.fromEntries(
    STAGES.map((stage) => {
      const values = perRun.flatMap((run) =>
        run.seconds[stage] === null ? [] : [run.seconds[stage] as number],
      );
      return [
        stage,
        { runs: values.length, p50: percentile(values, 50), p95: percentile(values, 95) },
      ];
    }),
  ) as Record<Stage, { runs: number; p50: number | null; p95: number | null }>;
  return { runs: runs.length, stages, perRun };
}

/** Class runs created in [since, until), inside one read-only transaction. */
export async function readRunTimes(db: Database, since: Date, until: Date): Promise<RunTimes[]> {
  return db.transaction().execute(async (tx) => {
    await sql`set transaction read only`.execute(tx);
    const result = await sql<RunTimes>`
      select
        run.id as "runId",
        run.state,
        run.created_at as "createdAt",
        run.finished_at as "finishedAt",
        upload.started_at as "uploadStartedAt",
        upload.verified_at as "uploadVerifiedAt",
        stt.started_at as "sttStartedAt",
        stt.finished_at as "sttFinishedAt",
        vision.started_at as "visionStartedAt",
        vision.finished_at as "visionFinishedAt",
        lesson.started_at as "lessonStartedAt",
        lesson.finished_at as "lessonFinishedAt",
        voice.started_at as "voiceStartedAt",
        voice.finished_at as "voiceFinishedAt"
      from proc.processing_run run
      left join lateral (
        select min(created_at) as started_at,
          case when bool_and(verified_at is not null) then max(verified_at) end as verified_at
        from src.audio_upload where reservation_id = run.reservation_id and user_id = run.user_id
      ) upload on true
      left join lateral (
        select min(started_at) as started_at, max(finished_at) as finished_at
        from proc.provider_attempt where run_id = run.id and step like 'stt:%'
      ) stt on true
      left join lateral (
        select min(started_at) as started_at, max(finished_at) as finished_at
        from proc.provider_attempt where run_id = run.id and step like 'vision:%'
      ) vision on true
      left join lateral (
        select min(started_at) as started_at, max(finished_at) as finished_at
        from proc.provider_attempt where run_id = run.id and step like 'knowledge%'
      ) lesson on true
      left join lateral (
        select min(created_at) as started_at, max(updated_at) as finished_at
        from voc.analysis
        where session_id = run.session_id and user_id = run.user_id
          and created_at >= run.created_at
          and (run.finished_at is null or created_at <= run.finished_at)
      ) voice on true
      where run.kind = 'class' and run.created_at >= ${since} and run.created_at < ${until}
      order by run.created_at`.execute(tx);
    return result.rows;
  });
}
