import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { assertFixturesUseAppDatabase } from "../../packages/core/test/local-db";
import { localJournalFixtureAvailable } from "./src/server/local-test-policy";

const localEnvironment = new URL("./.env.local", import.meta.url);
if (existsSync(localEnvironment)) loadEnvFile(localEnvironment);
// Fixtures write straight to Postgres; stop before the server starts unless it is the app's.
assertFixturesUseAppDatabase(process.env);
const testJournal = localJournalFixtureAvailable({ ...process.env, RECALINO_TEST_JOURNAL: "1" });

const port = 3000;
const baseURL = `http://localhost:${port}`;
const loopbackUrl = (value: string | undefined, protocols: string[]) => {
  try {
    const url = new URL(value ?? "");
    return (
      protocols.includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};
// Mocked PDF transfers need the SSR storage flag. CI's `next start` uses production mode;
// only an explicitly enabled local fixture may receive this credential-free store marker.
const localUploadFixture =
  testJournal &&
  localJournalFixtureAvailable({
    ...process.env,
    ...(process.env.CI ? { NODE_ENV: "production" } : {}),
    RECALINO_TEST_JOURNAL: "1",
  }) &&
  loopbackUrl(process.env.DATABASE_URL, ["postgres:", "postgresql:"]) &&
  loopbackUrl(baseURL, ["http:"]);

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  // The dev server compiles each page on first visit, which can take several seconds.
  expect: { timeout: process.env.CI ? 5_000 : 15_000 },
  // M0 smoke test only. The browser matrix of FR-PLT-010 is added after SPIKE-01.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI runs the production build; locally the dev server is enough.
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    env: {
      ...(testJournal ? { RECALINO_TEST_JOURNAL: "1" } : {}),
      ...(localUploadFixture ? { BLOB_STORE_ID: "synthetic-background-upload-browser" } : {}),
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
