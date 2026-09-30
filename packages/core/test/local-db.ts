/**
 * Connection string of the local Supabase started by `pnpm db:start` (password from supabase/seed.sql).
 * Local development and CI only; it never points at the cloud project.
 */
export const LOCAL_APP_DATABASE_URL =
  "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres";

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? LOCAL_APP_DATABASE_URL;
}
