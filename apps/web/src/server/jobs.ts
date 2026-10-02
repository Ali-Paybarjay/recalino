import "server-only";
import { accPeriodicJobs } from "@recalino/core/acc";
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
import { after } from "next/server";
import type { Handler } from "./api";
import { getDatabase } from "./db";
import { getObjectStore } from "./storage";

/** The runner route's limit (ADR-0001: up to 800 seconds); `maxDuration` in its route file. */
export const RUNNER_MAX_SECONDS = 800;
/** Stop claiming new jobs this long before the limit, so a started step can finish. */
const RUNNER_MARGIN_SECONDS = 100;

/** Every periodic job, from every module (FR-PLT-005); storage checks only with a real store. */
export function periodicJobs(settings: PltSettings): PeriodicJob[] {
  const store = getObjectStore();
  return [
    ...pltPeriodicJobs(settings),
    ...(store ? storagePeriodicJobs(store, settings) : []),
    ...accPeriodicJobs(),
  ];
}

// biome-ignore lint/suspicious/noExplicitAny: each definition checks its own payload type.
export function jobDefinitions(settings: PltSettings): JobDefinition<any>[] {
  return periodicJobs(settings).map((job) => job.definition);
}

interface RunnerDeps {
  settings: () => PltSettings;
  log: Logger;
  now: () => Date;
}

const defaultRunnerDeps: RunnerDeps = {
  settings: () => readPltSettings(),
  log: createLogger(),
  now: () => new Date(),
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
    for (const job of periodicJobs(settings)) {
      await ensurePeriodicJob(db, job.definition, job.everySeconds, started, settings.jobs);
    }
    const deadline = new Date(
      started.getTime() + (RUNNER_MAX_SECONDS - RUNNER_MARGIN_SECONDS) * 1000,
    );
    const summary = await runDueJobs(db, jobDefinitions(settings), {
      deadline,
      now: deps.now,
      log: deps.log,
    });
    return { body: summary };
  };
}

/**
 * Runs just-enqueued jobs right after the response is sent (ADR-0001: "فراخوانی فوری پس از ثبت
 * Job"). Anything left over, or longer than this request's own limit, is picked up by the cron.
 */
export function runJobsSoon(kinds: readonly string[], budgetSeconds: number): void {
  after(async () => {
    const settings = readPltSettings();
    await runDueJobs(getDatabase(), jobDefinitions(settings), {
      kinds,
      deadline: new Date(Date.now() + budgetSeconds * 1000),
      log: defaultRunnerDeps.log,
    });
  });
}
