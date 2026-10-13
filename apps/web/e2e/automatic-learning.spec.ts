import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { AutomaticLearningStatus } from "../src/ui/workspace/automatic-learning";

const sessionId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
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
  await page.route("**/sessions/**", (route) => route.abort());
  return unexpected;
}

test("retry immediately focuses a clear progress card and prevents duplicate submissions", async ({
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
  const retry = page.getByRole("button", { name: /^(Retry failed attempt|Retrying…)$/ });
  await expect(retry).toHaveText("Retry failed attempt");
  await expect(page.getByRole("link", { name: "Add material", exact: true })).toHaveAttribute(
    "href",
    `/sessions/${sessionId}/sources`,
  );
  await expect(page.getByRole("link", { name: "View progress", exact: true })).toHaveAttribute(
    "href",
    `/sessions/${sessionId}/sources#session-progress`,
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
  const card = page.getByRole("region", { name: "Session progress", exact: true });
  await expect(card).toBeFocused();
  await expect(card.getByRole("heading", { name: "Retrying your session…" })).toBeInViewport();
  await expect(
    card.getByText("Please wait while we restart using your saved material.", { exact: true }),
  ).toBeInViewport();
  await expect(card.getByRole("progressbar", { name: "Updating session status" })).toBeVisible();
  await expect(
    card.getByRole("progressbar", { name: "Updating session status" }),
  ).not.toHaveAttribute("value");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.body).toEqual({ action: "retry" });
  expect(writes[0]?.key).toMatch(/^[\da-f-]{36}$/);
  await page.screenshot({
    path: resolve(output, "progress-retry-mobile-pending.png"),
    fullPage: true,
  });
  releasePost?.();
  await expect(
    page
      .getByRole("region", { name: "Session progress", exact: true })
      .filter({ hasText: "Create notes & flashcards" }),
  ).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(card.getByRole("heading", { name: "Creating notes and flashcards" })).toBeVisible();
  await expect(page).toHaveURL(/\/dev\/ui\/learning$/);
  status = ready;
  await expect(
    page.getByRole("heading", { name: "Notes and flashcards are ready", exact: true }),
  ).toBeVisible();
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
  const retry = page.getByRole("button", { name: /^(Retry failed attempt|Retrying…)$/ });
  await retry.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "The attempt could not resume." }),
  ).toBeVisible();
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    page
      .getByRole("region", { name: "Session progress", exact: true })
      .filter({ hasText: "Create notes & flashcards" }),
  ).toBeVisible();
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
  const retry = page.getByRole("button", { name: /^(Retry failed attempt|Retrying…)$/ });
  await expect(retry).toBeVisible();
  holdNextRead = true;
  await readStarted;
  await retry.click();
  await expect(
    page
      .getByRole("region", { name: "Session progress", exact: true })
      .filter({ hasText: "Create notes & flashcards" }),
  ).toBeVisible();
  const previousResponse = page.waitForResponse(async (response) => {
    if (!response.url().endsWith(path) || response.request().method() !== "GET") return false;
    return (await response.json()).state === "blocked";
  });
  releaseRead?.();
  await (await previousResponse).finished();
  await expect(
    page
      .getByRole("region", { name: "Session progress", exact: true })
      .filter({ hasText: "Create notes & flashcards" }),
  ).toBeVisible();
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
    const retry = page.getByRole("button", { name: /^(Retry failed attempt|Retrying…)$/ });
    await retry.click();
    await expect(page.getByRole("alert").filter({ hasText: "Retry was accepted" })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Session progress", exact: true })
        .filter({ hasText: "Create notes & flashcards" }),
    ).toBeVisible();
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
        `/sessions/${sessionId}/notes`,
      );
      await expect(page.getByRole("link", { name: "Flashcards", exact: true })).toHaveAttribute(
        "href",
        `/sessions/${sessionId}/cards`,
      );
    } else {
      await expect(
        page.getByRole("heading", { name: "Notes and flashcards are ready", exact: true }),
      ).toBeVisible();
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
  await expect(
    page.getByRole("button", { name: /^(Retry failed attempt|Retrying…)$/ }),
  ).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("retry guidance explains new-version allowance without promising a free retry", async ({
  page,
}) => {
  const unexpected = await interceptFixture(page);
  let current = blocked;
  await page.route(`**${path}`, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: current });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/ui/learning?view=progress");
  const guidance = page
    .getByRole("region", { name: "Session progress", exact: true })
    .getByRole("status")
    .first();
  await expect(guidance).toContainText(
    "Publishing a result uses allowance for material not already charged. A new version of existing notes also uses 1 New versions unit.",
  );
  await expect(
    page.getByRole("button", { name: "Retry failed attempt", exact: true }),
  ).toBeVisible();
  current = { ...blocked, notesReady: true, cardsReady: true };
  await expect(guidance).toContainText(
    "Publishing updated notes uses 1 New versions unit, plus allowance for any material not already charged. Audio and pages already charged for this session are not charged again.",
  );
  await expect(guidance).not.toContainText("Publishing a result uses allowance");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
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
        .getByRole("region", { name: "Session progress", exact: true })
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
      await expect(
        page
          .getByRole("region", { name: "Session progress", exact: true })
          .filter({ hasText: "Create notes & flashcards" }),
      ).toBeVisible();
      await expect(retry).toHaveCount(0);
      expect(writes.map((write) => write.body)).toEqual([{ action: "retry" }, { action: "retry" }]);
      expect(writes[0]?.key).toMatch(/^[\da-f-]{36}$/);
      expect(writes[1]?.key).toMatch(/^[\da-f-]{36}$/);
      expect(writes[1]?.key).not.toBe(writes[0]?.key);
      expect(unexpected).toEqual([]);
    });
  }
}

test("mobile progress identifies the current processing step and the completed result", async ({
  page,
}) => {
  const unexpected = await interceptFixture(page);
  let current: AutomaticLearningStatus = {
    ...processing,
    state: "waiting_sources",
    message: "Checking your uploaded files…",
  };
  await page.route(`**${path}`, (route) => route.fulfill({ json: current }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/ui/learning?view=progress");
  const card = page.getByRole("region", { name: "Session progress", exact: true });
  const steps = card.getByRole("list", { name: "Session processing steps" });
  await expect(card.getByRole("heading", { name: "Checking your files" })).toBeVisible();
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await expect(steps.locator('[aria-current="step"]')).toContainText("Check files");
  const stage = card.getByRole("progressbar", { name: "Current stage progress" });
  await expect(stage).toBeVisible();
  await expect(stage).not.toHaveAttribute("value");
  current = processing;
  await expect(card.getByRole("heading", { name: "Creating notes and flashcards" })).toBeVisible();
  await expect(steps.locator('[aria-current="step"]')).toContainText("Create notes & flashcards");
  await expect(stage).not.toHaveAttribute("value");
  await mkdir(output, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: resolve(output, `session-progress-mobile-${theme}.png`),
      fullPage: true,
    });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const accessibility = await new AxeBuilder({ page })
    .include('section[aria-label="Session progress"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.screenshot({
    path: resolve(output, "session-progress-desktop-light.png"),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  current = ready;
  await expect(card.getByRole("heading", { name: "Notes and flashcards are ready" })).toBeVisible();
  await expect(stage).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Session notes", exact: true })).toHaveAttribute(
    "href",
    `/sessions/${sessionId}/notes`,
  );
  await expect(card.getByRole("link", { name: "Flashcards", exact: true })).toHaveAttribute(
    "href",
    `/sessions/${sessionId}/cards`,
  );
  expect(unexpected).toEqual([]);
});

test("saved audio shows preparation and measured XHR bytes before verification and processing", async ({
  page,
}) => {
  const unexpected = await interceptFixture(page);
  await page.addInitScript(() => {
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof Blob) Object.assign(window, { learningUploadRequest: this });
      return send.call(this, body);
    };
  });
  const sourceId = randomUUID(),
    uploadId = randomUUID();
  const fileText = "abcd".repeat(1000);
  const run: ProcessingRun = {
    id: randomUUID(),
    sessionId,
    reservationId: randomUUID(),
    state: "awaiting_upload",
    sourcesVersion: 1,
    lastError: null,
    outputVersionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const snapshot: RunSnapshot = {
    sourcesVersion: 1,
    fingerprint: "a".repeat(64),
    sources: [
      {
        sourceId,
        kind: "audio",
        sha256: createHash("sha256").update(fileText).digest("hex"),
        mimeType: "audio/webm",
        durationMs: 1000,
        pageCount: null,
        objectId: null,
        contentVersionId: null,
        captureAnchor: null,
        ranges: [],
        units: [],
        blocks: [],
      },
    ],
  };
  let current: AutomaticLearningStatus = {
    ...processing,
    state: "waiting_upload",
    run,
    snapshot,
    message:
      "Uploading the saved audio automatically. Keep this device connected until the upload finishes.",
  };
  let reads = 0,
    uploads = 0,
    completions = 0;
  let releaseChecking: (() => void) | undefined;
  const checkingGate = new Promise<void>((resolve) => {
    releaseChecking = resolve;
  });
  let releaseUpload: (() => void) | undefined;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let releaseTransfer: (() => void) | undefined;
  const transferGate = new Promise<void>((resolve) => {
    releaseTransfer = resolve;
  });
  let releaseVerification: (() => void) | undefined;
  const verificationGate = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    expect(route.request().method()).toBe("GET");
    reads++;
    await route.fulfill({ json: current });
  });
  await page.route("**/api/sources/contract", (route) =>
    route.fulfill({ json: { contract: { partBytes: fileText.length / 2 } } }),
  );
  await page.route(`**/api/classes/${sessionId}/sources`, (route) =>
    route.fulfill({ json: [{ assetId: sourceId, displayName: "Synthetic saved audio.webm" }] }),
  );
  await page.route(`**/api/sources/${sourceId}/audio*`, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === "GET") {
      if (url.searchParams.has("index")) {
        expect(url.searchParams.get("index")).toBe("1");
        await uploadGate;
        await route.fulfill({ json: { url: `${url.origin}/__synthetic-learning-audio` } });
      } else
        await route.fulfill({
          json: {
            parts: [
              { index: 0, verifiedAt: new Date().toISOString() },
              { index: 1, verifiedAt: null },
            ],
          },
        });
      return;
    }
    const body = request.postDataJSON();
    if (body.action === "start") {
      await checkingGate;
      await route.fulfill({ json: { uploadId } });
    } else if (body.action === "confirm_part")
      await route.fulfill({ json: { confirmed: uploads > 0 } });
    else if (body.action === "complete") {
      completions++;
      await verificationGate;
      current = {
        ...current,
        state: "waiting_sources",
        run: { ...run, state: "queued" },
        message: "Checking your uploaded files…",
      };
      await route.fulfill({ json: { uploadId, state: "pending" } });
    } else throw new Error(`Unexpected synthetic upload action ${body.action}`);
  });
  await page.route("**/__synthetic-learning-audio", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataBuffer()?.toString()).toBe(fileText.slice(fileText.length / 2));
    uploads++;
    await transferGate;
    await route.fulfill({ status: 200, body: "" });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/ui/learning?view=progress");
  await page.evaluate(
    async ({ owner, session, source, content }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("recalino-recordings-v1", 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(["recordings", "chunks"], "readwrite");
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      const id = crypto.randomUUID(),
        now = new Date().toISOString();
      tx.objectStore("recordings").put({
        id,
        userId: owner,
        sessionId: session,
        sourceAssetId: source,
        mimeType: "audio/webm",
        status: "saved",
        createdAt: now,
        updatedAt: now,
        activeMs: 1000,
        chunks: 1,
        bytes: content.length,
        creationKey: crypto.randomUUID(),
      });
      tx.objectStore("chunks").put({
        userId: owner,
        recordingId: id,
        sequence: 0,
        blob: new Blob([content], { type: "audio/webm" }),
      });
      await done;
      db.close();
    },
    { owner: userId, session: sessionId, source: sourceId, content: fileText },
  );
  await page.reload();
  const card = page.getByRole("region", { name: "Session progress", exact: true });
  const overall = card.getByRole("progressbar", { name: "Material upload progress", exact: true });
  const file = card.getByRole("progressbar", { name: /^Upload progress for / });
  // This gate holds file validation/setup before any upload bytes are sent.
  await expect(card.getByRole("heading", { name: "Preparing audio for upload" })).toBeInViewport();
  await expect(
    card.getByText(
      "Checking your files on this device before sending them. Larger files can take a little longer. Keep this app open; the upload starts automatically.",
      { exact: true },
    ),
  ).toBeInViewport();
  await expect(overall).not.toHaveAttribute("value");
  await expect(file).not.toHaveAttribute("value");
  await expect(card.getByText("Checking audio before upload", { exact: true })).toBeVisible();
  expect(uploads).toBe(0);
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: resolve(output, "session-upload-mobile-preparing.png"),
    fullPage: true,
  });
  releaseChecking?.();
  await expect(card.getByRole("heading", { name: "Uploading your material" })).toBeVisible();
  await expect(overall).toHaveAttribute("value", "50");
  await expect(file).toHaveAttribute("value", "50");
  const previousReads = reads;
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(overall).toHaveAttribute("value", "50");
  await expect(file).toHaveAttribute("value", "50");
  await expect(
    card.getByRole("list", { name: "Session processing steps" }).locator('[aria-current="step"]'),
  ).toContainText("Upload material");
  expect(uploads).toBe(0);
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: resolve(output, "session-upload-mobile-halfway.png"),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  await expect(card.getByRole("heading", { name: "Upload paused", exact: true })).toBeVisible();
  await expect(
    card.getByText(
      "Reconnect this device to the internet. Your upload will resume automatically; keep this app open.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(overall).toHaveAttribute("value", "50");
  await expect(card.locator('[data-active="true"]')).toHaveCount(0);
  await page.screenshot({
    path: resolve(output, "session-upload-mobile-offline.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
  });
  await expect(
    card.getByRole("heading", { name: "Uploading your material", exact: true }),
  ).toBeVisible();
  await expect(overall).toHaveAttribute("value", "50");
  releaseUpload?.();
  await expect.poll(() => uploads).toBe(1);
  // Route interception alone cannot exercise byte progress. Dispatch through the
  // real XHR upload EventTarget, including browsers that omit a computable total.
  await page.evaluate(() => {
    const request = (window as unknown as { learningUploadRequest: XMLHttpRequest })
      .learningUploadRequest;
    request.upload.dispatchEvent(
      new ProgressEvent("progress", { lengthComputable: false, loaded: 1000, total: 0 }),
    );
  });
  await expect(overall).toHaveAttribute("value", "75");
  await expect(file).toHaveAttribute("value", "75");
  const transferReads = reads;
  await expect.poll(() => reads).toBeGreaterThan(transferReads);
  await expect(overall).toHaveAttribute("value", "75");
  await page.screenshot({
    path: resolve(output, "session-upload-mobile-transferring.png"),
    fullPage: true,
  });
  releaseTransfer?.();
  await expect.poll(() => completions).toBe(1);
  await expect(card.getByRole("heading", { name: "Checking your files" })).toBeVisible();
  releaseVerification?.();
  await expect(card.getByRole("heading", { name: "Checking your files" })).toBeVisible();
  await expect(overall).toHaveCount(0);
  await expect(file).toHaveCount(0);
  await expect(
    card.getByRole("list", { name: "Session processing steps" }).locator('[aria-current="step"]'),
  ).toContainText("Check files");
  current = { ...processing, run: { ...run, state: "queued" }, snapshot };
  await expect(card.getByRole("heading", { name: "Waiting to process" })).toBeVisible();
  await expect(
    card.getByRole("list", { name: "Session processing steps" }).locator('[aria-current="step"]'),
  ).toContainText("Create notes & flashcards");
  await expect(
    card.getByRole("progressbar", { name: "Current stage progress" }),
  ).not.toHaveAttribute("value");
  await expect(overall).toHaveCount(0);
  expect(uploads).toBe(1);
  expect(completions).toBe(1);
  expect(unexpected).toEqual([]);
});
