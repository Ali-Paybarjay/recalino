import "server-only";
import { accPeriodicJobs } from "@recalino/core/acc";
import { longestProviderTimeoutMs } from "@recalino/core/aip";
import { databaseBackupMaintenanceJob } from "@recalino/core/ops";
import {
  createLogger,
  ensurePeriodicJob,
  type JobDefinition,
  type Logger,
  type PeriodicJob,
  type PltSettings,
  pltPeriodicJobs,
  readPltSettings,
  runDueJobs,
  storagePeriodicJobs,
} from "@recalino/core/plt";
import { processingPeriodicJobs } from "@recalino/core/proc";
import { runEmailOutbox } from "@recalino/core/support";
import { voicePeriodicJobs } from "@recalino/core/voc";
import { after } from "next/server";
import { adminDirectory } from "./admin-directory";
import { getAiProvider } from "./ai";
import type { Handler } from "./api";
import { automaticLearningJob, automaticLearningPeriodicJobs } from "./automatic-learning";
import { getDatabase } from "./db";
import { exportJobDefinitions, exportPeriodicJobs } from "./export-jobs";
import { getMediaJobDefinition } from "./media-jobs";
import { getPrivacyJobDefinition } from "./privacy";
import { getProcessingDefinition } from "./processing-jobs";
import {
  processingNotificationDefinitions,
  processingNotificationPeriodicJobs,
} from "./processing-notifications";
import { sourceJobDefinitions, sourcePeriodicJobs } from "./source-jobs";
import { spikeJobDefinitions } from "./spike-jobs";
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

/** Every periodic job, from every module (FR-PLT-005); storage checks only with a real store. */
export function periodicJobs(settings: PltSettings): PeriodicJob[] {
  const store = getObjectStore();
  return [
    ...pltPeriodicJobs(settings),
    ...(store ? storagePeriodicJobs(store, settings) : []),
    ...(store ? voicePeriodicJobs(store) : []),
    ...(store ? [databaseBackupMaintenanceJob(store)] : []),
    ...accPeriodicJobs(),
    ...sourcePeriodicJobs(),
    ...exportPeriodicJobs(),
    ...processingPeriodicJobs(),
    ...automaticLearningPeriodicJobs(),
    ...processingNotificationPeriodicJobs(),
  ];
}

// biome-ignore lint/suspicious/noExplicitAny: each definition checks its own payload type.
export function jobDefinitions(settings: PltSettings): JobDefinition<any>[] {
  const processing = getProcessingDefinition();
  const media = getMediaJobDefinition();
  const voice = getVoiceAnalysisDefinition();
  return [
    ...periodicJobs(settings).map((job) => job.definition),
    ...sourceJobDefinitions(),
    ...processingNotificationDefinitions(),
    ...(processing ? [processing] : []),
    ...(voice ? [voice] : []),
    automaticLearningJob(),
    ...(media ? [media] : []),
    getPrivacyJobDefinition(),
    ...exportJobDefinitions(),
    ...spikeJobDefinitions(),
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
}

const defaultRunnerDeps: RunnerDeps = {
  settings: () => readPltSettings(),
  log: createLogger(),
  now: () => new Date(),
  providerTimeoutMs: () => {
    const provider = getAiProvider();
    return provider ? longestProviderTimeoutMs(provider.settings) : undefined;
  },
};

/**
 * GET /api/jobs/run, called by Vercel Cron every minute: adds the periodic jobs that are due,
 * returns jobs whose runner died to the queue, then runs due jobs until near the time limit.
 */
export function runJobsHandler(overrides: Partial<RunnerDeps> = {}): Handler {
  const deps = { ...defaultRunnerDeps, ...overrides };
  return async ({ db }) => {
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
): void {
  after(async () => {
    const settings = readPltSettings();
    const started = Date.now();
    await runDueJobs(getDatabase(), jobDefinitions(settings), {
      kinds,
      deadline: new Date(started + budgetSeconds * 1000),
      // The request already used some of its limit before after() began.
      finishBy: new Date(started + (functionSeconds - 2 * RUNNER_FINISH_MARGIN_SECONDS) * 1000),
      log: defaultRunnerDeps.log,
    });
  });
}
