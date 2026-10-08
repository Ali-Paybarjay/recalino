/**
 * Connection strings of the local Supabase started by `pnpm db:start`.
 * Local development and CI only; they never point at the cloud project.
 */
function localOverride(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined) return fallback;
  try {
    const url = new URL(value);
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("not_local");
    return value;
  } catch {
    // Never include credentials from a rejected override in a test report.
    throw new Error(`Invalid local test database configuration: ${name}`);
  }
}

export const LOCAL_APP_DATABASE_URL = localOverride(
  "LOCAL_TEST_APP_DATABASE_URL",
  "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres",
);

/** The same role through the local Supavisor in transaction mode, as the cloud app connects. */
export const LOCAL_POOLER_DATABASE_URL = localOverride(
  "LOCAL_TEST_POOLER_DATABASE_URL",
  "postgresql://recalino_app.pooler-dev:recalino-local-only@127.0.0.1:54329/postgres",
);

/** Public default superuser of the local stack; used only to impersonate other roles in tests. */
export const LOCAL_ADMIN_DATABASE_URL = localOverride(
  "LOCAL_TEST_ADMIN_DATABASE_URL",
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
);

export function testDatabaseUrl(): string {
  return process.env.LOCAL_TEST_APP_DATABASE_URL !== undefined
    ? LOCAL_APP_DATABASE_URL
    : (process.env.DATABASE_URL ?? LOCAL_APP_DATABASE_URL);
}
