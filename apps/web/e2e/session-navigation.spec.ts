import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";

// Workstream 5 (FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12 §7.3): one next step per session state.
for (const width of [390, 1440]) {
  test(`each session state names one next step that can succeed (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: {} }));
    await page.goto("/dev/ui/session");
    const card = (state: string) =>
      page.locator(`[data-state="${state}"]`).getByRole("region", { name: "Session progress" });

    await expect(
      card("empty").getByRole("heading", { name: "Add your session material" }),
    ).toBeVisible();
    await expect(card("empty").getByRole("link")).toHaveCount(1);

    await expect(
      card("ready-voice").getByRole("link", { name: "Read notes", exact: true }),
    ).toHaveClass(/btn-primary/);
    await expect(
      page.locator('[data-state="ready-voice"]').getByRole("link", { name: "Confirm your voice" }),
    ).toHaveAttribute("href", /\/voice$/);

    const short = card("allowance-short");
    await expect(short.getByRole("link", { name: "Ask for more allowance" })).toHaveClass(
      /btn-primary/,
    );
    await expect(short.getByRole("button", { name: /Retry/ })).toHaveCount(0);

    const audio = card("audio-not-received");
    await expect(audio.getByText(/did not reach Recalino/)).toBeVisible();
    await expect(audio.getByRole("link", { name: "Review material" })).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await expectNoAxeViolations(page);
  });
}
