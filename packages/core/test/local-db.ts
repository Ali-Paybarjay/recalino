/**
 * Connection strings of the local Supabase started by `pnpm db:start`.
 * Local development and CI only; they never point at the cloud project.
 */
export const LOCAL_APP_DATABASE_URL =
  "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres";

/** The same role through the local Supavisor in transaction mode, as the cloud app connects. */
export const LOCAL_POOLER_DATABASE_URL =
  "postgresql://recalino_app.pooler-dev:recalino-local-only@127.0.0.1:54329/postgres";

/** Public default superuser of the local stack; used only to impersonate other roles in tests. */
export const LOCAL_ADMIN_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? LOCAL_APP_DATABASE_URL;
}
