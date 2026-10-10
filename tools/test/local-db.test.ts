import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps isolated CI connections together even when a generic database variable is present", async () => {
  vi.stubEnv("LOCAL_TEST_APP_DATABASE_URL", "postgresql://app:local@127.0.0.1:55322/postgres");
  vi.stubEnv(
    "LOCAL_TEST_ADMIN_DATABASE_URL",
    "postgresql://postgres:local@localhost:55322/postgres",
  );
  vi.stubEnv(
    "LOCAL_TEST_POOLER_DATABASE_URL",
    "postgresql://app.ci:local@127.0.0.1:55329/postgres",
  );
  vi.stubEnv("DATABASE_URL", "postgresql://old:local@127.0.0.1:54322/postgres");
  const endpoints = await import("../../packages/core/test/local-db");
  expect(new URL(endpoints.testDatabaseUrl()).port).toBe("55322");
  expect(new URL(endpoints.LOCAL_ADMIN_DATABASE_URL).port).toBe("55322");
  expect(new URL(endpoints.LOCAL_POOLER_DATABASE_URL).port).toBe("55329");
});

it("rejects a cloud test override without disclosing its credentials", async () => {
  vi.stubEnv(
    "LOCAL_TEST_APP_DATABASE_URL",
    "postgresql://app:private-value@cloud.example/postgres",
  );
  await expect(import("../../packages/core/test/local-db")).rejects.toThrow(
    /^Invalid local test database configuration: LOCAL_TEST_APP_DATABASE_URL$/,
  );
});

const app = (port: number, database = "postgres") =>
  `postgresql://recalino_app:app-secret@127.0.0.1:${port}/${database}`;
const admin = (port: number, host = "127.0.0.1") =>
  `postgresql://postgres:admin-secret@${host}:${port}/postgres`;

async function fixtureGuard() {
  return (await import("../../packages/core/test/local-db")).assertFixturesUseAppDatabase;
}

/** The reason an environment is refused; it never quotes a connection string or its user. */
function refusal(check: () => void): string {
  try {
    check();
  } catch (error) {
    const { message } = error as Error;
    expect(message).not.toMatch(/@|secret|example|recalino_app|recalino-local-only/);
    return message;
  }
  throw new Error("Expected the environment to be refused");
}

it("lets browser tests start when their fixtures reach the app's database", async () => {
  const assertFixtures = await fixtureGuard();
  // CI: `pnpm db:env` points the app at the default stack and no override is set.
  expect(() =>
    assertFixtures({
      DATABASE_URL: "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres",
    }),
  ).not.toThrow();
  // An isolated stack; any loopback name reaches the same port on this computer.
  expect(() =>
    assertFixtures({
      DATABASE_URL: app(58322),
      LOCAL_TEST_APP_DATABASE_URL: app(58322),
      LOCAL_TEST_ADMIN_DATABASE_URL: admin(58322, "localhost"),
    }),
  ).not.toThrow();
});

it("stops browser tests whose fixtures would write to another database than the app", async () => {
  const assertFixtures = await fixtureGuard();
  // The app runs on an isolated stack while the fixtures fall back to the shared one.
  expect(refusal(() => assertFixtures({ DATABASE_URL: app(55322) }))).toBe(
    "Browser-test fixtures would write to another database than the app under test: " +
      "LOCAL_TEST_APP_DATABASE_URL is unset, so fixtures use port 54322, database postgres; " +
      "DATABASE_URL uses port 55322, database postgres. Point LOCAL_TEST_APP_DATABASE_URL, " +
      "LOCAL_TEST_ADMIN_DATABASE_URL and the app's DATABASE_URL (apps/web/.env.local) at the " +
      "same local stack.",
  );
  // Only the app connection follows the isolated stack; the admin fixtures would not.
  expect(
    refusal(() =>
      assertFixtures({ DATABASE_URL: app(55322), LOCAL_TEST_APP_DATABASE_URL: app(55322) }),
    ),
  ).toContain(
    "LOCAL_TEST_ADMIN_DATABASE_URL is unset, so fixtures use port 54322, database postgres; " +
      "DATABASE_URL uses port 55322, database postgres.",
  );
  // The fixtures follow an isolated stack while the app still uses the shared one.
  expect(
    refusal(() =>
      assertFixtures({
        DATABASE_URL: app(54322),
        LOCAL_TEST_APP_DATABASE_URL: app(55322),
        LOCAL_TEST_ADMIN_DATABASE_URL: admin(55322),
      }),
    ),
  ).toContain(
    "LOCAL_TEST_APP_DATABASE_URL uses port 55322, database postgres; " +
      "DATABASE_URL uses port 54322, database postgres.",
  );
  // The same stack, but another database in it.
  expect(
    refusal(() =>
      assertFixtures({
        DATABASE_URL: app(55322, "recalino"),
        LOCAL_TEST_APP_DATABASE_URL: app(55322),
        LOCAL_TEST_ADMIN_DATABASE_URL: admin(55322),
      }),
    ),
  ).toContain("database postgres; DATABASE_URL uses port 55322, database recalino.");
});

it("stops browser tests when the app's database is missing, remote or unspecific", async () => {
  const assertFixtures = await fixtureGuard();
  for (const DATABASE_URL of [
    undefined,
    "",
    "postgresql://app:cloud-secret@db.cloud.example:5432/postgres",
    "postgresql://app:local-secret@127.0.0.1/postgres",
    "postgresql://app:local-secret@127.0.0.1:55322",
    "postgresql://app:local-secret@127.0.0.1:55322/",
    "http://app:local-secret@127.0.0.1:55322/postgres",
  ]) {
    const message = refusal(() =>
      assertFixtures({
        DATABASE_URL,
        LOCAL_TEST_APP_DATABASE_URL: app(55322),
        LOCAL_TEST_ADMIN_DATABASE_URL: admin(55322),
      }),
    );
    expect(message).toMatch(/^Browser tests need DATABASE_URL to be a loopback postgresql URL/);
  }
});

it("refuses a fixture override that is remote or unspecific by its name only", async () => {
  const assertFixtures = await fixtureGuard();
  const env = { DATABASE_URL: app(55322), LOCAL_TEST_APP_DATABASE_URL: app(55322) };
  expect(
    refusal(() =>
      assertFixtures({
        ...env,
        LOCAL_TEST_ADMIN_DATABASE_URL:
          "postgresql://postgres:cloud-secret@db.cloud.example/postgres",
      }),
    ),
  ).toBe("Invalid local test database configuration: LOCAL_TEST_ADMIN_DATABASE_URL");
  expect(
    refusal(() =>
      assertFixtures({
        ...env,
        LOCAL_TEST_ADMIN_DATABASE_URL: "postgresql://postgres:admin-secret@127.0.0.1/postgres",
      }),
    ),
  ).toBe(
    "Invalid local test database configuration: LOCAL_TEST_ADMIN_DATABASE_URL needs a port and " +
      "a database",
  );
});
