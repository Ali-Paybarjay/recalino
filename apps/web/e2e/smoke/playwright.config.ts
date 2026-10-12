import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Release smoke test (D66): read-only checks against an already running deployment.
 * It never starts a server, never signs in and never submits a form.
 *
 *   BASE_URL=https://recalino.vercel.app pnpm --filter @recalino/web exec \
 *     playwright test -c e2e/smoke/playwright.config.ts
 */
const supplied = process.env.BASE_URL;
if (!supplied) throw new Error("BASE_URL is required; the smoke test never starts a server.");
const target = new URL(supplied);
if (!["http:", "https:"].includes(target.protocol)) {
  throw new Error("BASE_URL must use HTTP or HTTPS.");
}

// Cloud sessions ship one Chromium build; use it instead of downloading another.
const preinstalled = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.SMOKE_CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: ".",
  testMatch: "*.smoke.ts",
  outputDir: "../../test-results-smoke",
  forbidOnly: true,
  retries: 0,
  workers: 2,
  reporter: "list",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: { baseURL: target.origin, trace: "off", screenshot: "only-on-failure" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
  ],
});
