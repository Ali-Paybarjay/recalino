import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import type { DB } from "../src/db";

/**
 * Characterization tests (audit QUA-01): the real Kysely compiler with a driver that writes
 * every statement and transaction boundary, in order, to one log that mocked collaborators can
 * also write to. `respond` supplies the fixture rows of each statement; nothing reaches a database.
 */
export function statementLogDatabase(respond: (query: CompiledQuery) => unknown[] = () => []) {
  const log: string[] = [];
  const statements: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery) {
      statements.push(query);
      log.push(query.sql);
      return { rows: respond(query) as R[] };
    },
    async *streamQuery<R>() {
      yield { rows: [] as R[] };
    },
  };
  class Driver extends DummyDriver {
    override async acquireConnection() {
      return connection;
    }
    override async beginTransaction() {
      log.push("begin");
    }
    override async commitTransaction() {
      log.push("commit");
    }
    override async rollbackTransaction() {
      log.push("rollback");
    }
  }
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new Driver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, log, statements };
}
