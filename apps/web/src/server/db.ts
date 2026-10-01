import "server-only";
import { readDatabaseEnv } from "@recalino/core/config";
import { createDatabase, type Database } from "@recalino/core/db";

let database: Database | undefined;

/** One small pool per server instance; created on first use so builds need no database. */
export function getDatabase(): Database {
  database ??= createDatabase(readDatabaseEnv().DATABASE_URL, { maxConnections: 3 });
  return database;
}
