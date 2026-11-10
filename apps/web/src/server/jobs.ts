import "server-only";
import { accPeriodicJobs } from "@recalino/core/acc";
import { longestProviderTimeoutMs } from "@recalino/core/aip";
import { closeEndedSpeechRunMedia } from "@recalino/core/media";
import { databaseBackupMaintenanceJob, systemHealthJob } from "@recalino/core/ops";
import {
  createLogger,
  createSchemaGuard,
  ensurePeriodicJob,
  type JobDefinition,
  type Logger,
  type PeriodicJob,
  type PltSettings,
  pltPeriodicJobs,
  type RunOptions,
  type RunSummary,
  readPltSettings,
  runDueJobs,
  type SchemaGuard,
  storagePeriodicJobs,
} from "@recalino/core/plt";
import { privacyPeriodicJobs } from "@recalino/core/priv";
import {
  processingPeriodicJobs,
  type RunClosedHook,
  recordProcessingNotification,
} from "@recalino/core/proc";
import { runEmailOutbox } from "@recalino/core/support";
import { voicePeriodicJobs } from "@recalino/core/voc";
import { after } from "next/server";
import { adminDirectory } from "./admin-directory";
import { getAiProvider } from "./ai";
import type { Handler } from "./api";
import { automaticLearningJob, automaticLearningPeriodicJobs } from "./automatic-learning";
import { finalizeAutomaticRun } from "./automatic-learning-publication";
import { captureTranscriptionDefinition, stagedAudioJobDefinition } from "./capture-staging-jobs";
import { getDatabase } from "./db";
import { exportJobDefinitions, exportPeriodicJobs } from "./export-jobs";
import { getLessonReviewDefinition } from "./lesson-review";
import { getMediaJobDefinition } from "./media-jobs";
import { getPrivacyJobDefinition } from "./privacy";
import { getProcessingDefinition } from "./processing-jobs";
import {
  processingNotificationDefinitions,
  processingNotificationPeriodicJobs,
} from "./processing-notifications";
import { EXPECTED_SCHEMA_VERSION } from "./schema-version.generated";
import { sourceJobDefinitions, sourcePeriodicJobs } from "./source-jobs";
import { getObjectStore } from "./storage";
import { getVoiceAnalysisDefinition } from "./voice-processing";

/** The runner route's limit (ADR-0001: up to 800 seconds); `maxDuration` in its route file. */
export const RUNNER_MAX_SECONDS = 800;
/** Database work around one provider request: claim, checkpoint, accounting and completion. */
export const RUNNER_STEP_SLACK_SECONDS = 20;
/** The claim margin before provider deadlines were configurable per model. */
const RUNNER_MIN_MARGIN_SECONDS = 100;
/** A handler must return this long before the function limit, leaving time to settle its job. */
const RUNNER_FINISH_MARGIN_SECONDS = 30;

/**
 * FR-PLT-005: stop claiming new jobs this long before the limit, so a started step can finish.
 * A job claimed just before that point may wait on one provider request for its model's whole
 * deadline (each paid result is checkpointed before the next request gets its own execution),
 * so the margin covers the longest configured deadline plus slack, never less than 100 s.
 * A run keeps the deadlines of its settings snapshot: runtime settings with a shorter deadline
 * go back only after the runs created under the longer one have finished (release runbook).
 */
export function runnerMarginSeconds(longestProviderTimeoutMs = 0): number {
  return Math.max(
    RUNNER_MIN_MARGIN_SECONDS,
    Math.ceil(longestProviderTimeoutMs / 1000) + RUNNER_STEP_SLACK_SECONDS,
  );
}

/** The last moment the cron runner claims a job; see runnerMarginSeconds. */
export function runnerClaimDeadline(started: Date, longestProviderTimeoutMs?: number): Date {
  return new Date(
    started.getTime() + (RUNNER_MAX_SECONDS - runnerMarginSeconds(longestProviderTimeoutMs)) * 1000,
  );
}

/**
 * How long a processing wake claims jobs: twice the base margin before the limit, and early
 * enough that a job claimed last can still wait one provider request for its model's whole
 * deadline before handlers must finish (the request used up to one finish margin before after()).
 */
export function processingWakeBudgetSeconds(longestProviderTimeoutMs?: number): number {
  return Math.min(
    RUNNER_MAX_SECONDS - 2 * RUNNER_MIN_MARGIN_SECONDS,
    RUNNER_MAX_SECONDS -
      2 * RUNNER_FINISH_MARGIN_SECONDS -
      runnerMarginSeconds(longestProviderTimeoutMs),
  );
}

/**
 * A processing wake keeps a class's or a session voice check's continuation jobs moving on this
 * request's own function instead of leaving each next step to the next cron minute. The waking
 * routes all allow the runner's full limit (`maxDuration` 800). The processing worker also
 * starts a lesson stage only when its call still fits before the function stops.
 */
export const PROCESSING_WAKE = {
  get budgetSeconds(): number {
    return processingWakeBudgetSeconds(defaultRunnerDeps.providerTimeoutMs());
  },
  functionSeconds: RUNNER_MAX_SECONDS,
};

/**
 * PRD-02: a run closed because its job ended gets the worker's completion hook (processing-jobs):
 * automatic-learning progress first, then the learner's processing notification.
 */
const notifyClosedRun: RunClosedHook = async (db, ctx, runId, now) => {
  await finalizeAutomaticRun(db, ctx, runId, now);
  await recordProcessingNotification(db, ctx, runId, now);
};

/** Every periodic job, from every module (FR-PLT-005); storage checks only with a real store. */
export function periodicJobs(settings: PltSettings): PeriodicJob[] {
  const store = getObjectStore();
  return [
    ...pltPeriodicJobs(settings),
    ...(store ? storagePeriodicJobs(store, settings) : []),
    ...(store ? voicePeriodicJobs(store) : []),
    ...(store ? [databaseBackupMaintenanceJob(store)] : []),
    systemHealthJob(),
    ...accPeriodicJobs(),
    ...privacyPeriodicJobs(),
    ...sourcePeriodicJobs(),
    ...exportPeriodicJobs(),
    ...processingPeriodicJobs({
      afterRunClosed: notifyClosedRun,
      afterAuxiliaryClose: closeEndedSpeechRunMedia,
    }),
    ...automaticLearningPeriodicJobs(),
    ...processingNotificationPeriodicJobs(),
  ];
}

// biome-ignore lint/suspicious/noExplicitAny: each definition checks its own payload type.
export function jobDefinitions(settings: PltSettings): JobDefinition<any>[] {
  const processing = getProcessingDefinition();
  const media = getMediaJobDefinition();
  const voice = getVoiceAnalysisDefinition();
  const lessonReview = getLessonReviewDefinition();
  return [
    ...periodicJobs(settings).map((job) => job.definition),
    ...sourceJobDefinitions(),
    ...[stagedAudioJobDefinition(), captureTranscriptionDefinition()].filter((job) => job !== null),
    ...processingNotificationDefinitions(),
    ...(processing ? [processing] : []),
    ...(voice ? [voice] : []),
    ...(lessonReview ? [lessonReview] : []),
    automaticLearningJob(),
    ...(media ? [media] : []),
    getPrivacyJobDefinition(),
    ...exportJobDefinitions(),
  ];
}

interface RunnerDeps {
  settings: () => PltSettings;
  log: Logger;
  now: () => Date;
  /** Restrict a controlled runner; the production cron runs every registered definition. */
  kinds?: readonly string[];
  /** The longest request deadline of the runtime provider settings, when configured. */
  providerTimeoutMs: () => number | undefined;
  /** OPS-05: compares this build's newest migration with the database before any work. */
  schema: SchemaGuard;
}

const runnerLog = createLogger();

const defaultRunnerDeps: RunnerDeps = {
  settings: () => readPltSettings(),
  log: runnerLog,
  now: () => new Date(),
  providerTimeoutMs: () => {
    const provider = getAiProvider();
    return provider ? longestProviderTimeoutMs(provider.settings) : undefined;
  },
  // One guard per function instance, so its short cache spans the cron run and immediate wakes.
  schema: createSchemaGuard({ expected: EXPECTED_SCHEMA_VERSION, log: runnerLog }),
};

const IDLE_SUMMARY: RunSummary = { swept: 0, succeeded: 0, failed: 0, retried: 0, cancelled: 0 };

/**
 * GET /api/jobs/run, called by Vercel Cron every minute: adds the periodic jobs that are due,
 * returns jobs whose runner died to the queue, then runs due jobs until near the time limit.
 */
export function runJobsHandler(overrides: Partial<RunnerDeps> = {}): Handler {
  const deps = { ...defaultRunnerDeps, ...overrides };
  return async ({ db }) => {
    // OPS-05: code goes live before its migration is applied. On a database that is behind,
    // the runner sends no mail, adds no periodic job and claims no job until the migration runs.
    if (!(await deps.schema.allowsWork(db)))
      return { body: { ...IDLE_SUMMARY, schemaBehind: true } };
    const settings = deps.settings();
    const started = deps.now();
    // Only approved snapshots are eligible. Missing configuration leaves queued mail visible.
    await runEmailOutbox(db, {
      limit: 25,
      now: started,
      resolveRecipientEmail: async (id) => (await adminDirectory().getUser(id)).email,
    });
    for (const job of periodicJobs(settings)) {
      await ensurePeriodicJob(db, job.definition, job.everySeconds, started, settings.jobs);
    }
    const deadline = runnerClaimDeadline(started, deps.providerTimeoutMs());
    const summary = await runDueJobs(db, jobDefinitions(settings), {
      deadline,
      finishBy: new Date(
        started.getTime() + (RUNNER_MAX_SECONDS - RUNNER_FINISH_MARGIN_SECONDS) * 1000,
      ),
      now: deps.now,
      log: deps.log,
      kinds: deps.kinds,
    });
    return { body: summary };
  };
}

/**
 * Runs just-enqueued jobs right after the response is sent (ADR-0001: "فراخوانی فوری پس از ثبت
 * Job"). Anything left over, or longer than this request's own limit, is picked up by the cron.
 * `functionSeconds` is the waking route's own `maxDuration`; handlers finish before it.
 */
export function runJobsSoon(
  kinds: readonly string[],
  budgetSeconds: number,
  functionSeconds = 120,
  target?: RunOptions["target"],
): void {
  after(async () => {
    const db = getDatabase();
    if (!(await defaultRunnerDeps.schema.allowsWork(db))) return;
    const settings = readPltSettings();
    const started = Date.now();
    await runDueJobs(db, jobDefinitions(settings), {
      kinds,
      ...(target !== undefined ? { target } : {}),
      deadline: new Date(started + budgetSeconds * 1000),
      // The request already used some of its limit before after() began.
      finishBy: new Date(started + (functionSeconds - 2 * RUNNER_FINISH_MARGIN_SECONDS) * 1000),
      log: defaultRunnerDeps.log,
    });
  });
}
