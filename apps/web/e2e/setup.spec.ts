import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { signInAsNewLearner } from "./learner";
import { microphoneStats, mockMicrophone } from "./voice-capture";

// A2 — profile setup (FR-ACC-003, FR-ACC-005, FR-ACC-006, D33), through the real API.

test("a new learner completes core setup and skips optional voice setup without enabling it", async ({
  page,
}) => {
  await mockMicrophone(page);
  const voiceWrites: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/me/voice" && request.method() !== "GET")
      voiceWrites.push(request.method());
  });
  await signInAsNewLearner(page);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/setup$/);

  // 1 — first language, chosen with the keyboard; Persian is Experimental until tested (D31).
  await expect(page.getByText("1 of 6")).toBeVisible();
  const search = page.getByRole("combobox", { name: "What is your first language?" });
  await expect(page.getByRole("option", { name: /Persian/ })).toBeVisible();
  await search.fill("فار");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(page.getByRole("option", { name: /Persian/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Explanations in Persian may have mistakes")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Continue" }).click();

  // 2 — explanation language: no default, the reason is shown until one is chosen.
  await expect(page.getByText("2 of 6")).toBeVisible();
  const next = page.getByRole("button", { name: "Continue" });
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await expect(next).toHaveAccessibleDescription("Please choose one.");
  await page.getByRole("radio", { name: /فارسی/ }).check({ force: true });
  await expectNoAxeViolations(page);
  await next.click();

  // 3 — level and goal are optional.
  await expect(page.getByText("3 of 6")).toBeVisible();
  await page.getByRole("radio", { name: "B1" }).check({ force: true });
  await page.getByRole("radio", { name: "IELTS" }).check({ force: true });
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Continue" }).click();

  // 4 — the time zone from the browser.
  await expect(page.getByText("4 of 6")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Yes, that's right" }).click();

  // 5 — recording consent: never pre-ticked; finish only after ticking.
  await expect(page.getByText("5 of 6")).toBeVisible();
  const finish = page.getByRole("button", { name: "Continue" });
  const consent = page.getByRole("checkbox", {
    name: "I understand that I must ask the people in my class before I record.",
  });
  await expect(consent).not.toBeChecked();
  await expect(finish).toHaveAttribute("aria-disabled", "true");
  await expectNoAxeViolations(page);
  await consent.check({ force: true });
  await finish.click();

  // 6 — voice identification is optional, separately consented, and never auto-enabled.
  await expect(page).toHaveURL(/\/setup\/voice$/);
  await expect(page.getByText("6 of 6")).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  // Provisioned native builds expose recording; consent must still gate microphone access.
  const beforeVoice = await page.request.get("/api/me/voice");
  expect(beforeVoice.status()).toBe(200);
  const beforeProfile = await beforeVoice.json();
  expect(beforeProfile).toMatchObject({
    enabled: false,
    enrolled: false,
    consentVersion: null,
  });
  expect(typeof beforeProfile.engineAvailable).toBe("boolean");
  const record = page.getByRole("button", { name: "Record voice sample", exact: true });
  if (beforeProfile.engineAvailable) {
    await expect(record).toBeVisible();
    await expect(record).toBeDisabled();
  } else {
    await expect(page.getByText(/Audio voice matching is not available yet/)).toBeVisible();
    await expect(record).toHaveCount(0);
  }
  expect(await microphoneStats(page)).toEqual({ requests: 0, stopped: 0 });
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Do this later", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  expect(voiceWrites).toEqual([]);
  expect(await microphoneStats(page)).toEqual({ requests: 0, stopped: 0 });
  const voice = await page.request.get("/api/me/voice");
  expect(voice.status()).toBe(200);
  expect(await voice.json()).toMatchObject({
    enabled: false,
    enrolled: false,
    consentVersion: null,
  });
  await expect(page.getByRole("heading", { name: "Your first class starts here." })).toBeVisible();
});

test("a learner who leaves comes back to the same step, and Back keeps the answer", async ({
  page,
}) => {
  await signInAsNewLearner(page);
  await page.goto("/setup");
  await page.getByRole("combobox").fill("japan");
  await page.getByRole("option", { name: /Japanese/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("2 of 6")).toBeVisible();

  await page.reload();
  await expect(page.getByText("2 of 6")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText("1 of 6")).toBeVisible();
  await expect(page.getByRole("option", { name: /Japanese/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the clear button empties the search and gives the field its focus back", async ({ page }) => {
  await signInAsNewLearner(page);
  await page.goto("/setup");
  const search = page.getByRole("combobox", { name: "What is your first language?" });
  const clear = page.getByRole("button", { name: "Clear search" });
  await expect(clear).toBeHidden();
  await search.fill("zzz");
  await expect(page.getByText("Check the spelling.")).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(page.getByRole("option", { name: /Persian/ })).toBeVisible();
});

test("a finished setup is not shown again", async ({ page }) => {
  await signInAsNewLearner(page, { setup: "complete" });
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/today$/);
});
