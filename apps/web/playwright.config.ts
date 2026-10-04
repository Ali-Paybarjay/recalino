import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { localJournalFixtureAvailable } from "./src/server/local-test-policy";

const localEnvironment = new URL("./.env.local", import.meta.url);
if (existsSync(localEnvironment)) loadEnvFile(localEnvironment);
const testJournal = localJournalFixtureAvailable({ ...process.env, RECALINO_TEST_JOURNAL: "1" });

const port = 3000;
const baseURL = `http://localhost:${port}`;

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
    env: testJournal ? { RECALINO_TEST_JOURNAL: "1" } : {},
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
