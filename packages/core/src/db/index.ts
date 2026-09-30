import { Kysely, PostgresDialect, type Transaction } from "kysely";
import pg from "pg";
import type { DB } from "./types";

export type { DB } from "./types";
export type Database = Kysely<DB>;
export type Tx = Transaction<DB>;

export interface DatabaseOptions {
  /** Connections per process. Keep this small on serverless functions behind the pooler (ADR-0002). */
  maxConnections?: number;
}

export function createDatabase(connectionString: string, options: DatabaseOptions = {}): Database {
  const pool = new pg.Pool({ connectionString, max: options.maxConnections ?? 3 });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Runs `fn` in a single transaction: commit on success, rollback on any error.
 * Module APIs accept the `Tx` so one transaction can span modules without sharing tables (ADR-0002).
 */
export function withTransaction<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}
