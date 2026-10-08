import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { AutomaticLearningStatus } from "../src/ui/workspace/automatic-learning";

const sessionId = "10000000-0000-4000-8000-000000000001";
const path = `/api/classes/${sessionId}/learning`;
const output = resolve(import.meta.dirname, "../../../artifacts/verification");
const blocked: AutomaticLearningStatus = {
  state: "blocked",
  revision: 1,
  batchId: null,
  run: null,
  snapshot: null,
  lastError: "processing_failed",
  message:
    "Automatic creation could not finish. Your material and earlier notes and cards are saved. Check the material or retry this attempt.",
  notesReady: false,
  cardsReady: false,
};
const processing: AutomaticLearningStatus = {
  ...blocked,
  state: "processing",
  revision: 2,
  lastError: null,
  message: "Creating your class notes and flashcards…",
};
const ready: AutomaticLearningStatus = {
  ...processing,
  state: "ready",
  notesReady: true,
  cardsReady: true,
  message: "Your class notes and flashcards are ready.",
};

async function interceptFixture(page: Page) {
  const unexpected: string[] = [];
  // No request can reach a real authenticated class API from this fixture.
  await page.route("**/api/**", async (route) => {
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({
      status: 501,
      json: { error: { code: "unexpected_fixture_request", message: "Unexpected fixture API." } },
    });
  });
  await page.route("**/classes/**", (route) => route.abort());
  return unexpected;
}

test("inline retry stays in class, prevents duplicate submissions, and updates progress", async ({
  page,
}) => {
  const unexpected = await interceptFixture(page);
  let status = blocked;
  const writes: { body: unknown; key: string | undefined }[] = [];
  let releasePost: (() => void) | undefined;
  const pendingPost = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      await pendingPost;
      status = processing;
    }
    await route.fulfill({ json: status });
  });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/dev/ui/learning");
  const retry = page.getByRole("button", { name: "Retry failed attempt", exact: true });
  await expect(retry).toHaveText("retry");
  await expect(page.getByRole("link", { name: "Add material", exact: true })).toHaveAttribute(
    "href",
    `/classes/${sessionId}/sources`,
  );
  await expect(page.getByRole("link", { name: "View progress", exact: true })).toHaveAttribute(
    "href",
    `/classes/${sessionId}/processing`,
  );
  const target = await retry.boundingBox();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, "progress-retry-mobile-layout.json"),
    JSON.stringify({ viewportWidth: 375, target, horizontalOverflow }, null, 2),
  );
  expect(target?.height).toBeGreaterThanOrEqual(44);
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(horizontalOverflow).toBe(false);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: resolve(output, `progress-retry-mobile-${theme}.png`),
      fullPage: true,
    });
  }
  // Two same-tick gestures exercise the ref lock before React renders disabled.
  await retry.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText("Retrying…");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.body).toEqual({ action: "retry" });
  expect(writes[0]?.key).toMatch(/^[\da-f-]{36}$/);
  releasePost?.();
  await expect(page.getByRole("status").filter({ hasText: processing.message })).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(page).toHaveURL(/\/dev\/ui\/learning$/);
  status = ready;
  await expect(page.getByRole("link", { name: "View progress", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add material", exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(unexpected).toEqual([]);
});

test("failed inline retry shows feedback and reuses its idempotency key", async ({ page }) => {
  const unexpected = await interceptFixture(page);
  const writes: string[] = [];
  let status = blocked;
  await page.route(`**${path}`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      writes.push(request.headers()["idempotency-key"] ?? "");
      if (writes.length === 1)
        return route.fulfill({
          status: 503,
          json: {
            error: { code: "unavailable", message: "The attempt could not resume. Try again." },
          },
        });
      status = processing;
    }
    await route.fulfill({ json: status });
  });
  await page.goto("/dev/ui/learning");
  const retry = page.getByRole("button", { name: "Retry failed attempt", exact: true });
  await retry.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "The attempt could not resume." }),
  ).toBeVisible();
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole("status").filter({ hasText: processing.message })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatch(/^[\da-f-]{36}$/);
  expect(writes[1]).toBe(writes[0]);
  await expect(
    page.getByText("The attempt could not resume. Try again.", { exact: true }),
  ).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("an older blocked progress read cannot replace the accepted retry result", async ({
  page,
}) => {
  const unexpected = await interceptFixture(page);
  let status = blocked;
  let holdNextRead = false;
  let writes = 0;
  let releaseRead: (() => void) | undefined;
  let signalRead: (() => void) | undefined;
  const oldRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readStarted = new Promise<void>((resolve) => {
    signalRead = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      status = processing;
    } else if (holdNextRead) {
      holdNextRead = false;
      signalRead?.();
      await oldRead;
      return route.fulfill({ json: blocked });
    }
    await route.fulfill({ json: status });
  });
  await page.goto("/dev/ui/learning");
  const retry = page.getByRole("button", { name: "Retry failed attempt", exact: true });
  await expect(retry).toBeVisible();
  holdNextRead = true;
  await readStarted;
  await retry.click();
  await expect(page.getByRole("status").filter({ hasText: processing.message })).toBeVisible();
  const previousResponse = page.waitForResponse(async (response) => {
    if (!response.url().endsWith(path) || response.request().method() !== "GET") return false;
    return (await response.json()).state === "blocked";
  });
  releaseRead?.();
  await (await previousResponse).finished();
  await expect(page.getByRole("status").filter({ hasText: processing.message })).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(writes).toBe(1);
  expect(unexpected).toEqual([]);
});

for (const view of ["class", "progress"] as const) {
  test(`${view} retry accepted before failed progress refresh can recover without another POST`, async ({
    page,
  }) => {
    const unexpected = await interceptFixture(page);
    let writes = 0;
    let readsFail = false;
    let status = blocked;
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() === "POST") {
        writes++;
        status = processing;
        readsFail = true;
        return route.fulfill({ json: status });
      }
      if (readsFail)
        return route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Progress is temporarily unavailable." } },
        });
      await route.fulfill({ json: status });
    });
    await page.goto(`/dev/ui/learning${view === "progress" ? "?view=progress" : ""}`);
    const retry = page.getByRole("button", { name: "Retry failed attempt", exact: true });
    await retry.click();
    await expect(page.getByRole("alert").filter({ hasText: "Retry was accepted" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: processing.message })).toBeVisible();
    await expect(retry).toHaveCount(0);
    readsFail = false;
    status = ready;
    await page.getByRole("button", { name: "Check progress again", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Retry was accepted" })).toHaveCount(0);
    if (view === "progress") {
      await expect(
        page.getByRole("heading", { name: "Notes and flashcards are ready" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Session notes", exact: true })).toHaveAttribute(
        "href",
        `/classes/${sessionId}/notes`,
      );
      await expect(page.getByRole("link", { name: "Flashcards", exact: true })).toHaveAttribute(
        "href",
        `/classes/${sessionId}/cards`,
      );
    } else {
      await expect(page.getByRole("link", { name: "View progress", exact: true })).toHaveCount(0);
    }
    await expect(page).toHaveURL(
      new RegExp(`/dev/ui/learning${view === "progress" ? "\\?view=progress" : ""}$`),
    );
    expect(writes).toBe(1);
    expect(unexpected).toEqual([]);
  });
}

test("an unresolved provider result keeps progress visible without offering retry", async ({
  page,
}) => {
  const unexpected = await interceptFixture(page);
  await page.route(`**${path}`, (route) =>
    route.fulfill({ json: { ...blocked, lastError: "provider_outcome_unresolved" } }),
  );
  await page.goto("/dev/ui/learning");
  await expect(page.getByRole("link", { name: "View progress", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry failed attempt", exact: true })).toHaveCount(
    0,
  );
  expect(unexpected).toEqual([]);
});

for (const view of ["notice", "progress"] as const) {
  for (const recovery of [
    {
      code: "quota_insufficient",
      message:
        "This class needs more allowance than is currently available. Your material is saved.",
      label: "Review allowance",
      href: "/me/quota",
      retry: "Retry after allowance changes",
    },
  ]) {
    test(`${view}: ${recovery.code} provides the right recovery and retries only on request`, async ({
      page,
    }) => {
      const unexpected = await interceptFixture(page);
      let current: AutomaticLearningStatus = {
        ...blocked,
        lastError: recovery.code,
        message: recovery.message,
      };
      const writes: { body: unknown; key: string | undefined }[] = [];
      let serviceUpdated = false;
      await page.route(`**${path}`, async (route) => {
        const request = route.request();
        if (request.method() === "POST") {
          writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
          if (serviceUpdated) current = processing;
        }
        await route.fulfill({ json: current });
      });
      await page.setViewportSize({ width: 375, height: 844 });
      await page.goto(`/dev/ui/learning${view === "progress" ? "?view=progress" : ""}`);
      const action = page.getByRole("link", { name: recovery.label, exact: true });
      const blockedMessage = page
        .getByRole(view === "notice" ? "alert" : "status")
        .filter({ hasText: recovery.message });
      await expect(action).toBeVisible();
      await expect(action).toHaveAttribute("href", recovery.href);
      await expect(blockedMessage).toBeVisible();
      if (recovery.code === "processing_budget_session") {
        await expect(page.getByRole("link", { name: "Review allowance", exact: true })).toHaveCount(
          0,
        );
      } else {
        await expect(
          page.getByRole("link", { name: "Ask for more allowance", exact: true }),
        ).toHaveAttribute("href", "/help/new");
      }
      if (view === "progress") {
        await expect(page.getByRole("link", { name: "Add material", exact: true })).toHaveCount(0);
        await expect(page.getByText("Processing continues when you leave this page.")).toHaveCount(
          0,
        );
      }
      const bounds = await action.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      ).toBe(false);
      expect(writes).toHaveLength(0);
      if (view === "progress") {
        for (const theme of ["light", "dark"] as const) {
          await page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          await mkdir(output, { recursive: true });
          await page.screenshot({
            path: resolve(output, `allowance-recovery-${recovery.code}-${theme}.png`),
            fullPage: true,
          });
        }
      }
      const retry = page.getByRole("button", { name: recovery.retry, exact: true });
      await expect(retry).toBeVisible();
      await retry.click();
      await expect.poll(() => writes.length).toBe(1);
      await expect(retry).toBeEnabled();
      await expect(action).toBeVisible();
      await expect(blockedMessage).toBeVisible();
      serviceUpdated = true;
      await retry.click();
      await expect.poll(() => writes.length).toBe(2);
      await expect(page.getByRole("status").filter({ hasText: processing.message })).toBeVisible();
      await expect(retry).toHaveCount(0);
      expect(writes.map((write) => write.body)).toEqual([{ action: "retry" }, { action: "retry" }]);
      expect(writes[0]?.key).toMatch(/^[\da-f-]{36}$/);
      expect(writes[1]?.key).toMatch(/^[\da-f-]{36}$/);
      expect(writes[1]?.key).not.toBe(writes[0]?.key);
      expect(unexpected).toEqual([]);
    });
  }
}
