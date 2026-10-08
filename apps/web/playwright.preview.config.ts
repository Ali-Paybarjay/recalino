import { defineConfig, devices } from "@playwright/test";

const suppliedURL = process.env.RECALINO_PREVIEW_BASE_URL;
if (!suppliedURL) {
  throw new Error("RECALINO_PREVIEW_BASE_URL is required; preview tests never start a server.");
}
const target = new URL(suppliedURL);
if (!["http:", "https:"].includes(target.protocol)) {
  throw new Error("RECALINO_PREVIEW_BASE_URL must use HTTP or HTTPS.");
}

export default defineConfig({
  testDir: "./e2e-preview",
  outputDir: "./test-results-preview",
  forbidOnly: true,
  retries: 0,
  workers: 2,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: target.origin,
    // A protected deployment's bootstrap URL contains a sharing credential.
    trace: process.env.RECALINO_PREVIEW_ACCESS_URL ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
