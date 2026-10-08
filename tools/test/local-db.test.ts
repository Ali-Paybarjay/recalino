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
