import "server-only";
import { readCronSecret } from "@recalino/core/config";
import type { Database } from "@recalino/core/db";
import {
  createLogger,
  createSchemaGuard,
  errorLocation,
  type Logger,
  pingDatabase,
  type SchemaGuard,
} from "@recalino/core/plt";
import { assertSystemCaller, type Handler } from "./api";
import { EXPECTED_SCHEMA_VERSION } from "./schema-version.generated";

export interface HealthDeps {
  cronSecret: () => string;
  /** One round trip to the database; throws when it cannot be reached. */
  ping: (db: Database) => Promise<void>;
  schema: SchemaGuard;
  log: Logger;
}

const log = createLogger();
const defaultDeps: HealthDeps = {
  cronSecret: () => readCronSecret(),
  ping: pingDatabase,
  schema: createSchemaGuard({ expected: EXPECTED_SCHEMA_VERSION, log }),
  log,
};

/**
 * GET /api/health. Without parameters a public liveness answer that touches nothing. With
 * `?deep=1` (OPS-02, OPS-05) a readiness check for the operator's monitor, behind the cron bearer
 * token: 503 when the database cannot be reached or lacks a migration this code needs.
 */
export function healthHandler(overrides: Partial<HealthDeps> = {}): Handler {
  const deps: HealthDeps = { ...defaultDeps, ...overrides };
  return async (args) => {
    if (new URL(args.request.url).searchParams.get("deep") !== "1")
      return { body: { status: "ok" } };
    assertSystemCaller(args.request, deps.cronSecret());
    let db: Database;
    try {
      // The pool is opened here, so a missing DATABASE_URL also answers 503.
      db = args.db;
      await deps.ping(db);
    } catch (error) {
      deps.log("error", "health_database_unavailable", {
        route: "health",
        error_name: error instanceof Error ? error.name : typeof error,
        error_location: errorLocation(error),
      });
      return { status: 503, body: { status: "unavailable", database: "unavailable" } };
    }
    const schema = await deps.schema.check(db);
    const ready = schema.state !== "behind";
    return {
      status: ready ? 200 : 503,
      body: { status: ready ? "ok" : "unavailable", database: "ok", schema: schema.state },
    };
  };
}
