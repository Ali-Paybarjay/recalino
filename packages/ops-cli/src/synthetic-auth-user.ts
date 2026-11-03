import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@recalino/core/db";
import { sql } from "kysely";
import { assertLocalEvaluationDatabase } from "./evaluation-config";

/** Public default superuser of the local Supabase stack started by `pnpm db:start`. */
const LOCAL_ADMIN_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export interface SyntheticAuthUserOptions {
  /** Defaults to LOCAL_TEST_ADMIN_DATABASE_URL, then the local stack's public superuser. */
  connectionString?: string;
  /** Opens the admin connection; called only after the target passed the local check. */
  open?: (connectionString: string) => Database;
}

function localTarget(connectionString: string): string {
  try {
    assertLocalEvaluationDatabase(connectionString);
  } catch {
    // An invalid URL error carries its input; never let credentials reach a report.
    throw new Error("local_supabase_database_required");
  }
  return connectionString;
}

/**
 * Creates a Supabase Auth user in the local evaluation database, standing in for a Google
 * sign-in. Local synthetic evaluation only: it needs the local superuser, which the app never
 * has, so the target must pass assertLocalEvaluationDatabase before any connection is opened.
 */
export async function createSyntheticAuthUser(
  options: SyntheticAuthUserOptions = {},
): Promise<string> {
  const connectionString = localTarget(
    options.connectionString ??
      process.env.LOCAL_TEST_ADMIN_DATABASE_URL ??
      LOCAL_ADMIN_DATABASE_URL,
  );
  const open = options.open ?? ((url: string) => createDatabase(url, { maxConnections: 1 }));
  const db = open(connectionString);
  try {
    const id = randomUUID();
    await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
      db,
    );
    return id;
  } finally {
    await db.destroy();
  }
}
