import { expect, test } from "@playwright/test";
import { signInAsNewLearner } from "./learner";

// UX-04: a request that never reaches the server must read as a connection problem with a next
// step, not as the browser's own words ("Failed to fetch", "Load failed").
test("a lost connection shows the connection message, not the browser's error text", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/me/review-settings");
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Save review settings", exact: true }).click();
  const problem = page.getByRole("alert").filter({ hasText: "We couldn't connect" });
  await expect(problem).toHaveText(
    "We couldn't connect. Check your internet connection and try again.",
  );
  await expect(page.getByText(/failed to fetch|load failed|networkerror/i)).toHaveCount(0);
  await expect(page.getByText(/idempotency|same key/i)).toHaveCount(0);
  // Back online, the same button saves.
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Save review settings", exact: true }).click();
  await expect(page.getByText("Review settings saved.")).toBeVisible();
});
