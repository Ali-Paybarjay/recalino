import { randomUUID } from "node:crypto";
import pg from "pg";
import { LOCAL_ADMIN_DATABASE_URL } from "./local-db";

/**
 * Creates a Supabase Auth user directly in the local database, standing in for a Google
 * sign-in. Tests only: it uses the local superuser, which the app never has.
 */
export async function createAuthUser(): Promise<string> {
  const client = new pg.Client({ connectionString: LOCAL_ADMIN_DATABASE_URL });
  await client.connect();
  try {
    const id = randomUUID();
    await client.query("insert into auth.users (id, email) values ($1, $2)", [
      id,
      `${id}@example.test`,
    ]);
    return id;
  } finally {
    await client.end();
  }
}
