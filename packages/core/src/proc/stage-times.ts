import { sql } from "kysely";
import type { Database, Tx } from "../db";

export interface ProviderWindow {
  startedAt: Date | null;
  finishedAt: Date | null;
}
export interface ClassRunTimes {
  runId: string;
  userId: string;
  sessionId: string;
  reservationId: string;
  state: string;
  createdAt: Date;
  finishedAt: Date | null;
  transcription: ProviderWindow;
  boardPhotos: ProviderWindow;
  lesson: ProviderWindow;
}

/**
 * Operator report (NFR-07): class runs created in [since, until) with the first start and last
 * finish of their transcription (`stt:`), board-photo (`vision:`) and lesson (`knowledge`)
 * provider calls. Times and identifiers only.
 */
export async function classRunTimes(
  db: Database | Tx,
  since: Date,
  until: Date,
): Promise<ClassRunTimes[]> {
  const result = await sql<{
    runId: string;
    userId: string;
    sessionId: string;
    reservationId: string;
    state: string;
    createdAt: Date;
    finishedAt: Date | null;
    sttStartedAt: Date | null;
    sttFinishedAt: Date | null;
    visionStartedAt: Date | null;
    visionFinishedAt: Date | null;
    lessonStartedAt: Date | null;
    lessonFinishedAt: Date | null;
  }>`
    select
      run.id as "runId", run.user_id as "userId", run.session_id as "sessionId",
      run.reservation_id as "reservationId", run.state, run.created_at as "createdAt",
      run.finished_at as "finishedAt",
      min(attempt.started_at) filter (where attempt.step like 'stt:%') as "sttStartedAt",
      max(attempt.finished_at) filter (where attempt.step like 'stt:%') as "sttFinishedAt",
      min(attempt.started_at) filter (where attempt.step like 'vision:%') as "visionStartedAt",
      max(attempt.finished_at) filter (where attempt.step like 'vision:%') as "visionFinishedAt",
      min(attempt.started_at) filter (where attempt.step like 'knowledge%') as "lessonStartedAt",
      max(attempt.finished_at) filter (where attempt.step like 'knowledge%') as "lessonFinishedAt"
    from proc.processing_run run
    left join proc.provider_attempt attempt on attempt.run_id = run.id
    where run.kind = 'class' and run.created_at >= ${since} and run.created_at < ${until}
    group by run.id
    order by run.created_at`.execute(db);
  return result.rows.map((row) => ({
    runId: row.runId,
    userId: row.userId,
    sessionId: row.sessionId,
    reservationId: row.reservationId,
    state: row.state,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    transcription: { startedAt: row.sttStartedAt, finishedAt: row.sttFinishedAt },
    boardPhotos: { startedAt: row.visionStartedAt, finishedAt: row.visionFinishedAt },
    lesson: { startedAt: row.lessonStartedAt, finishedAt: row.lessonFinishedAt },
  }));
}
