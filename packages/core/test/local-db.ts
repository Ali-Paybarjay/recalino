/**
 * Connection strings of the local Supabase started by `pnpm db:start`.
 * Local development and CI only; they never point at the cloud project.
 */
type Env = Readonly<Record<string, string | undefined>>;

const POSTGRES_PROTOCOLS = ["postgresql:", "postgres:"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const APP_DEFAULT = "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres";
const ADMIN_DEFAULT = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function localOverride(name: string, fallback: string, env: Env = process.env): string {
  const value = env[name];
  if (value === undefined) return fallback;
  try {
    const url = new URL(value);
    if (!POSTGRES_PROTOCOLS.includes(url.protocol) || !LOOPBACK_HOSTS.includes(url.hostname))
      throw new Error("not_local");
    return value;
  } catch {
    // Never include credentials from a rejected override in a test report.
    throw new Error(`Invalid local test database configuration: ${name}`);
  }
}

export const LOCAL_APP_DATABASE_URL = localOverride("LOCAL_TEST_APP_DATABASE_URL", APP_DEFAULT);

/** The same role through the local Supavisor in transaction mode, as the cloud app connects. */
export const LOCAL_POOLER_DATABASE_URL = localOverride(
  "LOCAL_TEST_POOLER_DATABASE_URL",
  "postgresql://recalino_app.pooler-dev:recalino-local-only@127.0.0.1:54329/postgres",
);

/** Public default superuser of the local stack; used only to impersonate other roles in tests. */
export const LOCAL_ADMIN_DATABASE_URL = localOverride(
  "LOCAL_TEST_ADMIN_DATABASE_URL",
  ADMIN_DEFAULT,
);

export function testDatabaseUrl(): string {
  return process.env.LOCAL_TEST_APP_DATABASE_URL !== undefined
    ? LOCAL_APP_DATABASE_URL
    : (process.env.DATABASE_URL ?? LOCAL_APP_DATABASE_URL);
}

/** Whether a run names its test databases itself, as a run against an isolated stack does. */
export function usesLocalTestOverrides(env: Env): boolean {
  return [
    "LOCAL_TEST_APP_DATABASE_URL",
    "LOCAL_TEST_ADMIN_DATABASE_URL",
    "LOCAL_TEST_POOLER_DATABASE_URL",
  ].some((name) => env[name] !== undefined);
}

/**
 * Port and database of a loopback Postgres URL that names both, never its user or password.
 * Every loopback name reaches this computer, so these two decide which local database it is.
 */
function localDatabase(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? "");
    const database = url.pathname.slice(1);
    if (
      !POSTGRES_PROTOCOLS.includes(url.protocol) ||
      !LOOPBACK_HOSTS.includes(url.hostname) ||
      url.port === "" ||
      database === ""
    )
      return undefined;
    return `port ${url.port}, database ${database}`;
  } catch {
    return undefined;
  }
}

/**
 * Browser tests sign learners in through the app, which uses DATABASE_URL, and then write their
 * fixtures through the app and admin connections above; the pooler one is not used there. The
 * Playwright config calls this before any test runs. It throws when the fixtures would reach
 * another database than the app, such as the shared stack on 54322 while the app runs on an
 * isolated one, because their rows would then land in someone else's data.
 */
export function assertFixturesUseAppDatabase(env: Env): void {
  const app = localDatabase(env.DATABASE_URL);
  if (app === undefined)
    throw new Error(
      "Browser tests need DATABASE_URL to be a loopback postgresql URL with a port and a " +
        "database. The app under test reads it from apps/web/.env.local; `pnpm db:env` writes " +
        "the default local stack's.",
    );
  for (const [name, fallback] of [
    ["LOCAL_TEST_APP_DATABASE_URL", APP_DEFAULT],
    ["LOCAL_TEST_ADMIN_DATABASE_URL", ADMIN_DEFAULT],
  ] as const) {
    const fixtures = localDatabase(localOverride(name, fallback, env));
    if (fixtures === undefined)
      throw new Error(
        `Invalid local test database configuration: ${name} needs a port and a database`,
      );
    if (fixtures !== app) {
      const used = env[name] === undefined ? "is unset, so fixtures use" : "uses";
      throw new Error(
        "Browser-test fixtures would write to another database than the app under test: " +
          `${name} ${used} ${fixtures}; DATABASE_URL uses ${app}. Point ` +
          "LOCAL_TEST_APP_DATABASE_URL, LOCAL_TEST_ADMIN_DATABASE_URL and the app's DATABASE_URL " +
          "(apps/web/.env.local) at the same local stack.",
      );
    }
  }
}
