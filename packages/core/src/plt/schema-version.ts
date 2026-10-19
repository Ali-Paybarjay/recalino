// OPS-05 (audit 2026-10-18): code goes live when it is merged, the migration it needs is applied
// afterwards (release runbook). Until then the job runner must not start work on the old schema.
import { sql } from "kysely";
import type { Database } from "../db";
import type { Logger } from "./log";
import { recordAuditOnce } from "./security";

/**
 * current: the database has exactly the newest migration this code knows; ahead: it has a newer
 * one (a backward-compatible migration applied before the code, the intended order); behind: a
 * migration this code needs is missing; unknown: the applied version could not be read.
 */
export type SchemaState = "current" | "ahead" | "behind" | "unknown";

export interface SchemaCheck {
  state: SchemaState;
  expected: string;
  applied: string | null;
}

const VERSION = /^\d{14}$/;

export function compareSchemaVersions(expected: string, applied: string | null): SchemaState {
  if (!VERSION.test(expected) || applied === null || !VERSION.test(applied)) return "unknown";
  return applied === expected ? "current" : applied > expected ? "ahead" : "behind";
}

/**
 * The newest applied migration, as `supabase db push` and `pnpm db:apply` record it. Throws when
 * the role may not read the table (a missing grant); callers decide how to treat that.
 */
export async function readAppliedSchemaVersion(db: Database): Promise<string | null> {
  const { rows } = await sql<{ version: string | null }>`
    select max(version) as version from supabase_migrations.schema_migrations`.execute(db);
  return rows[0]?.version ?? null;
}

const BEHIND_ALERT = {
  actorKind: "system",
  actorId: "plt.job_runner",
  action: "ops.schema_behind",
  subjectType: "schema_version",
} as const;

export interface SchemaGuardOptions {
  /** The newest migration of this build (apps/web/src/server/schema-version.generated.ts). */
  expected: string;
  log: Logger;
  /** How long a reading is reused; the runner asks once per claim loop. */
  cacheMs?: number;
  now?: () => number;
  read?: (db: Database) => Promise<string | null>;
  /** Records the alert once per expected version; true when this call recorded it. */
  raise?: (db: Database, check: SchemaCheck) => Promise<boolean>;
}

export interface SchemaGuard {
  check(db: Database): Promise<SchemaCheck>;
  /** False only when the database is known to be behind; an unreadable version fails open. */
  allowsWork(db: Database): Promise<boolean>;
}

/**
 * Reads the applied version at most once per `cacheMs`. When the database is behind, every
 * refusal writes a `schema_behind` warning and the first one per expected version records an
 * audit event, which the admin overview shows. When the version cannot be read (the role lacks
 * the grant, or the table is missing locally), the guard warns once and lets the runner work, so
 * the check never stops production on its own.
 */
export function createSchemaGuard(options: SchemaGuardOptions): SchemaGuard {
  const cacheMs = options.cacheMs ?? 30_000;
  const now = options.now ?? Date.now;
  const read = options.read ?? readAppliedSchemaVersion;
  const raise =
    options.raise ??
    ((db: Database, result: SchemaCheck) =>
      recordAuditOnce(db, { ...BEHIND_ALERT, subjectId: result.expected }));
  let cached: { at: number; check: SchemaCheck } | undefined;
  let unreadableLogged = false;

  async function check(db: Database): Promise<SchemaCheck> {
    if (cached && now() - cached.at < cacheMs) return cached.check;
    let result: SchemaCheck;
    try {
      const applied = await read(db);
      result = {
        state: compareSchemaVersions(options.expected, applied),
        expected: options.expected,
        applied,
      };
    } catch (error) {
      result = { state: "unknown", expected: options.expected, applied: null };
      if (!unreadableLogged) {
        unreadableLogged = true;
        options.log("warn", "schema_version_unreadable", {
          module: "plt",
          schema_expected: options.expected,
          pg_code: postgresCode(error),
          error_name: error instanceof Error ? error.name : typeof error,
        });
      }
    }
    cached = { at: now(), check: result };
    return result;
  }

  return {
    check,
    async allowsWork(db) {
      const result = await check(db);
      if (result.state !== "behind") return true;
      options.log("warn", "schema_behind", {
        module: "plt",
        schema_expected: result.expected,
        schema_applied: result.applied,
      });
      try {
        const raised = await raise(db, result);
        if (raised)
          options.log("error", "schema_behind_alert", {
            module: "plt",
            schema_expected: result.expected,
            schema_applied: result.applied,
          });
      } catch (error) {
        // The refusal itself must not depend on the audit write.
        options.log("warn", "schema_behind_alert_failed", {
          module: "plt",
          error_name: error instanceof Error ? error.name : typeof error,
          pg_code: postgresCode(error),
        });
      }
      return false;
    },
  };
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { code: unknown }).code;
  return typeof value === "string" && /^[0-9A-Z]{5}$/.test(value) ? value : undefined;
}
