import { sql } from "kysely";
import type { Database } from "../db";
import { classRunTimes, foregroundGaps } from "../proc";
import { audioUploadWindows } from "../src";
import { voiceAnalysisTimes } from "../voc";

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
  /** Time the learner's device reported its page hidden while the run was open (D47, D71). */
  "device_hidden",
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
  /** Hidden intervals the learner's device reported for the class (`recordForegroundGap`). */
  foregroundGaps: readonly { hiddenAt: Date; visibleAt: Date }[];
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

/** Seconds of the reported hidden intervals that fall inside [from, to); to = null is open. */
export function hiddenSeconds(
  gaps: readonly { hiddenAt: Date; visibleAt: Date }[],
  from: Date,
  to: Date | null,
): number {
  let total = 0;
  for (const gap of gaps) {
    const start = Math.max(gap.hiddenAt.getTime(), from.getTime());
    const end = Math.min(gap.visibleAt.getTime(), to?.getTime() ?? Number.POSITIVE_INFINITY);
    if (end > start) total += (end - start) / 1000;
  }
  return total;
}

/**
 * Stage boundaries. Upload: run creation → first upload start → last verified original. Queue:
 * ready input → first provider call. Provider stages span their first start to last finish and
 * may overlap. Publication: last provider or voice result → run finished. Device hidden: the
 * reported hidden time within the run; unmeasured when the device never reported.
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
    // Null when the device reported nothing at all (closed tab, no event); 0 when it reported
    // intervals that all fall outside the run.
    device_hidden: run.foregroundGaps.length
      ? hiddenSeconds(run.foregroundGaps, run.createdAt, run.finishedAt)
      : null,
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

/**
 * Class runs created in [since, until), read through each module inside one read-only
 * transaction. Voice: the analyses saved for the run, from their recorded start and finish
 * (D71); analyses saved before those were recorded leave the stage unmeasured.
 */
export async function readRunTimes(db: Database, since: Date, until: Date): Promise<RunTimes[]> {
  return db.transaction().execute(async (tx) => {
    await sql`set transaction read only`.execute(tx);
    const runs = await classRunTimes(tx, since, until);
    const uploads = await audioUploadWindows(
      tx,
      runs.map((run) => run.reservationId),
    );
    const voice = await voiceAnalysisTimes(
      tx,
      runs.map((run) => run.runId),
    );
    const gaps = await foregroundGaps(tx, [...new Set(runs.map((run) => run.sessionId))]);
    return runs.map((run) => {
      const analyses = voice.filter((analysis) => analysis.runId === run.runId);
      const upload = uploads.get(run.reservationId);
      return {
        runId: run.runId,
        state: run.state,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        uploadStartedAt: upload?.startedAt ?? null,
        uploadVerifiedAt: upload?.verifiedAt ?? null,
        sttStartedAt: run.transcription.startedAt,
        sttFinishedAt: run.transcription.finishedAt,
        visionStartedAt: run.boardPhotos.startedAt,
        visionFinishedAt: run.boardPhotos.finishedAt,
        lessonStartedAt: run.lesson.startedAt,
        lessonFinishedAt: run.lesson.finishedAt,
        voiceStartedAt: earliest(...analyses.map((analysis) => analysis.startedAt)),
        voiceFinishedAt: latest(...analyses.map((analysis) => analysis.finishedAt)),
        foregroundGaps: gaps
          .filter((gap) => gap.sessionId === run.sessionId && gap.userId === run.userId)
          .map((gap) => ({ hiddenAt: gap.hiddenAt, visibleAt: gap.visibleAt })),
      };
    });
  });
}
