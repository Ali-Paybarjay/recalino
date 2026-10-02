import { Kysely, PostgresDialect, type Transaction } from "kysely";
import pg from "pg";
import { connectionConfig } from "./connection";
import type { DB } from "./types";

export {
  connectionConfig,
  type DatabaseProbe,
  type DatabaseTls,
  databaseTls,
  probeDatabase,
} from "./connection";
export type { DB } from "./types";
export type Database = Kysely<DB>;
export type Tx = Transaction<DB>;

export interface DatabaseOptions {
  /** Connections per process. Keep this small on serverless functions behind the pooler (ADR-0002). */
  maxConnections?: number;
}

/** A pool with the app's TLS settings (connection.ts); throws on a configuration TLS forbids. */
export function createDatabase(connectionString: string, options: DatabaseOptions = {}): Database {
  const pool = new pg.Pool({
    ...connectionConfig(connectionString),
    max: options.maxConnections ?? 3,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Runs `fn` in a single transaction: commit on success, rollback on any error.
 * Module APIs accept the `Tx` so one transaction can span modules without sharing tables (ADR-0002).
 */
export function withTransaction<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}
