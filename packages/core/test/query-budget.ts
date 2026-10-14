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

/** Real Kysely compiler/driver boundary; fixture rows substitute only the remote database. */
export function queryBudgetDatabase(rows: unknown[][]) {
  const queries: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery) {
      queries.push(query);
      return { rows: (rows.shift() ?? []) as R[] };
    },
    async *streamQuery<R>() {
      yield { rows: [] as R[] };
    },
  };
  class Driver extends DummyDriver {
    override async acquireConnection() {
      return connection;
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
  return { db, queries };
}
