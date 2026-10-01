import { expect, test } from "@playwright/test";

// Page weight budget (M2, T7): the product owner asked that the app stay light and fast
// (D31 rule 8). Bytes transferred (compressed) on the production build. Measured on 2026-10-01:
// "/" 136 KB JS and 4.3 KB CSS (the React and Next.js baseline); "/dev/ui", which holds every
// component and icon, 165 KB JS and 8.4 KB CSS. A budget rises only by a recorded decision.
const BUDGETS: Record<string, { script: number; css: number }> = {
  "/": { script: 160_000, css: 12_000 },
  "/dev/ui": { script: 190_000, css: 12_000 },
};

test.skip(!process.env.CI, "measured on the production build, which CI runs");

for (const [path, budget] of Object.entries(BUDGETS)) {
  test(`${path} stays within its page weight budget`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    const sizes = await page.evaluate(() => {
      const totals = { script: 0, css: 0 };
      for (const entry of performance.getEntriesByType("resource")) {
        const resource = entry as PerformanceResourceTiming;
        if (resource.name.endsWith(".css")) totals.css += resource.transferSize;
        else if (resource.initiatorType === "script" || resource.name.endsWith(".js")) {
          totals.script += resource.transferSize;
        }
      }
      return totals;
    });
    expect(sizes.script, "JavaScript bytes").toBeLessThanOrEqual(budget.script);
    expect(sizes.css, "CSS bytes").toBeLessThanOrEqual(budget.css);
  });
}
