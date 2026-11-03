// OPS-02 (audit 2026-10-18): an hourly health check without any paid service. It reads the
// database size, jobs that failed for good in the last hour, the longest wait of a due job and
// the age of the last cron runner, and raises one audit event (shown in the admin overview and
// activity history) and one error log when a signal crosses its threshold. The alert is raised
// once per episode: again only after the signal went back under its threshold, which is recorded.
// P1-09 (RR-10): a failed processing run ends its job successfully, so failed_jobs misses it; the
// failed_runs signal counts the runs that failed in the last hour (proc.countFailedRuns) instead.
import { sql } from "kysely";
import { z } from "zod";
import type { Database } from "../db";
import {
  createLogger,
  type Logger,
  latestSubjectAudit,
  type PeriodicJob,
  type PlatformHealth,
  readPlatformHealth,
  recordAudit,
  type SchemaCheck,
} from "../plt";
import { countFailedRuns } from "../proc";
import type { HealthCondition, SystemHealth } from "./admin-contracts";

/**
 * Thresholds; a deployment overrides any of them with RECALINO_HEALTH_JSON. The database limit is
 * 80% of the 500 MB at which the Supabase Free plan turns the project read-only (ADR-0001).
 */
export const healthSettingsSchema = z.strictObject({
  databaseBytesLimit: z.int().min(1),
  failedJobsPerHour: z.int().min(1),
  queuedAgeSeconds: z.int().min(60),
  runnerAgeSeconds: z.int().min(60),
});
export type HealthSettings = z.infer<typeof healthSettingsSchema>;
export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
  databaseBytesLimit: 400_000_000,
  failedJobsPerHour: 1,
  queuedAgeSeconds: 15 * 60,
  runnerAgeSeconds: 15 * 60,
};

export function readHealthSettings(
  env: Record<string, string | undefined> = process.env,
): HealthSettings {
  const raw = env.RECALINO_HEALTH_JSON;
  if (!raw) return DEFAULT_HEALTH_SETTINGS;
  let overrides: unknown;
  try {
    overrides = JSON.parse(raw);
  } catch {
    throw new Error("Invalid RECALINO_HEALTH_JSON: not valid JSON");
  }
  const result = healthSettingsSchema.safeParse(
    overrides !== null && typeof overrides === "object" && !Array.isArray(overrides)
      ? { ...DEFAULT_HEALTH_SETTINGS, ...overrides }
      : overrides,
  );
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid RECALINO_HEALTH_JSON: ${names.join(", ")}`);
  }
  return result.data;
}

/** The platform signals and the processing runs that failed in the hour before `now`. */
export interface HealthReading extends PlatformHealth {
  failedRunsLastHour: number;
}

/** One read of every health signal; the failed-run count is proc's own read-only query. */
export async function readHealth(db: Database, now: Date): Promise<HealthReading> {
  const platform = await readPlatformHealth(db, now);
  const failedRunsLastHour = await countFailedRuns(db, {
    since: new Date(now.getTime() - 3_600_000),
    until: now,
  });
  return { ...platform, failedRunsLastHour };
}

export interface HealthSignal {
  condition: HealthCondition;
  open: boolean;
  /** The measured value: bytes, a count, or an age in milliseconds (null: nothing to measure). */
  measured: number | null;
}

/**
 * Each signal against its threshold. A missing runner record counts as a stale runner. Any failed
 * run opens failed_runs: it has no setting, since RECALINO_HEALTH_JSON keeps its four keys.
 */
export function evaluateHealth(
  health: HealthReading,
  now: Date,
  settings: HealthSettings,
): HealthSignal[] {
  const age = (at: Date | null) => (at === null ? null : Math.max(0, now.getTime() - at.getTime()));
  const queuedAge = age(health.oldestQueuedAt);
  const runnerAge = age(health.lastRunnerAt);
  return [
    {
      condition: "database_size",
      open: health.databaseBytes >= settings.databaseBytesLimit,
      measured: health.databaseBytes,
    },
    {
      condition: "failed_jobs",
      open: health.failedJobsLastHour >= settings.failedJobsPerHour,
      measured: health.failedJobsLastHour,
    },
    {
      condition: "failed_runs",
      open: health.failedRunsLastHour > 0,
      measured: health.failedRunsLastHour,
    },
    {
      condition: "queue_delay",
      open: queuedAge !== null && queuedAge > settings.queuedAgeSeconds * 1000,
      measured: queuedAge,
    },
    {
      condition: "runner_stale",
      open: runnerAge === null || runnerAge > settings.runnerAgeSeconds * 1000,
      measured: runnerAge,
    },
  ];
}

const ALERT = {
  actorKind: "system",
  actorId: "ops.health_check",
  subjectType: "system_health",
} as const;
const RAISED = "ops.health_alert";
const CLEARED = "ops.health_recovered";

/** Opens or closes one condition's alert; null when its recorded state already matches. */
async function settleAlert(
  db: Database,
  condition: HealthCondition,
  open: boolean,
): Promise<"raised" | "cleared" | null> {
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`ops:health:${condition}`}, 1))`.execute(
      tx,
    );
    const raised = await latestSubjectAudit(tx, {
      ...ALERT,
      action: RAISED,
      subjectIds: [condition],
    });
    const cleared = await latestSubjectAudit(tx, {
      ...ALERT,
      action: CLEARED,
      subjectIds: [condition],
    });
    const active = raised !== null && (cleared === null || cleared.occurredAt < raised.occurredAt);
    if (open === active) return null;
    await recordAudit(tx, { ...ALERT, action: open ? RAISED : CLEARED, subjectId: condition });
    return open ? "raised" : "cleared";
  });
}

export interface HealthCheckOptions {
  settings?: HealthSettings;
  log?: Logger;
  read?: (db: Database, now: Date) => Promise<HealthReading>;
}

/** One pass of the health check; returns the conditions it raised and cleared. */
export async function runHealthCheck(
  db: Database,
  now: Date,
  options: HealthCheckOptions = {},
): Promise<{ raised: HealthCondition[]; cleared: HealthCondition[] }> {
  const settings = options.settings ?? readHealthSettings();
  const log = options.log ?? createLogger();
  const health = await (options.read ?? readHealth)(db, now);
  const result = { raised: [] as HealthCondition[], cleared: [] as HealthCondition[] };
  for (const signal of evaluateHealth(health, now, settings)) {
    const change = await settleAlert(db, signal.condition, signal.open);
    if (change === null) continue;
    result[change].push(signal.condition);
    // Allow-listed fields only (PRD-PRIV-06): a condition name and a number.
    log(
      change === "raised" ? "error" : "info",
      change === "raised" ? "health_alert" : "health_recovered",
      {
        module: "ops",
        kind: signal.condition,
        measured: signal.measured,
      },
    );
  }
  return result;
}

export function systemHealthJob(options: { log?: Logger } = {}): PeriodicJob {
  return {
    everySeconds: 3600,
    definition: {
      kind: "ops.health_check",
      version: 1,
      payload: z.strictObject({}),
      async run(_input, job) {
        // Read per run: an invalid override fails the job loudly instead of hiding an alert.
        await runHealthCheck(job.db, job.now(), {
          settings: readHealthSettings(),
          log: options.log,
        });
      },
    },
  };
}

/** The admin overview's System health data (ADM-01, ADM-12), from the same signals. */
export async function readSystemHealth(
  db: Database,
  now: Date,
  options: { settings?: HealthSettings; schema?: SchemaCheck | null } = {},
): Promise<SystemHealth> {
  const settings = options.settings ?? readHealthSettings();
  const health = await readHealth(db, now);
  return {
    checkedAt: now.toISOString(),
    databaseBytes: health.databaseBytes,
    databaseBytesLimit: settings.databaseBytesLimit,
    failedJobsLastHour: health.failedJobsLastHour,
    oldestQueuedAt: health.oldestQueuedAt?.toISOString() ?? null,
    lastRunnerAt: health.lastRunnerAt?.toISOString() ?? null,
    schema: options.schema
      ? {
          state: options.schema.state,
          expected: options.schema.expected,
          applied: options.schema.applied,
        }
      : null,
    alerts: evaluateHealth(health, now, settings)
      .filter((signal) => signal.open)
      .map((signal) => signal.condition),
  };
}
