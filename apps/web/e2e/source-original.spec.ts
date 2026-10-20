import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "@recalino/core/db";
import { createSession } from "@recalino/core/org";
import { DEFAULT_PLT_SETTINGS, MemoryObjectStore, sha256Hex } from "@recalino/core/plt";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import {
  acceptSourceNotice,
  confirmUploadPart,
  createSource,
  readInputContract,
  uploadPartLink,
  verifyUpload,
} from "@recalino/core/src";
import { LOCAL_APP_DATABASE_URL } from "../../../packages/core/test/local-db";
import { expectNoAxeViolations, VIEWPORTS } from "./helpers";
import { signInAsNewLearner } from "./learner";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function syntheticAudio() {
  const bytes = Buffer.alloc(16044);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

async function fixture(page: Page, kind: "text" | "audio" = "text") {
  const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (
    !loopback(new URL(test.info().project.use.baseURL ?? "").hostname) ||
    !loopback(new URL(process.env.SUPABASE_URL ?? "").hostname)
  )
    throw new Error("Original-file fixtures require local browser, local Auth and local Postgres.");
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  const ctx = { userId, requestId: randomUUID() };
  try {
    const session = await createSession(
      db,
      ctx,
      { title: "Synthetic original-file access" },
      { key: randomUUID() },
    );
    const bytes =
      kind === "audio"
        ? syntheticAudio()
        : new TextEncoder().encode("Synthetic original-file browser regression.");
    const contract = await readInputContract(db);
    await acceptSourceNotice(db, ctx, contract.noticeVersion, true);
    await grantEntitlement(db, {
      userId,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3600000),
      amounts: amounts({ storage: 1000000 }),
      operationKey: randomUUID(),
      actorId: "synthetic-browser-fixture",
      reason: "Local original-file browser regression",
    });
    const checksum = sha256Hex(bytes);
    const source = await createSource(db, ctx, {
      sessionId: session.id,
      kind,
      mimeType: kind === "audio" ? "audio/wav" : "text/plain",
      sizeBytes: bytes.length,
      sha256: checksum,
      displayName: kind === "audio" ? "synthetic-local-audio.wav" : "synthetic-original.txt",
      ...(kind === "audio" ? { durationMs: 1000 } : {}),
      parts: kind === "audio" ? [] : [{ index: 0, sizeBytes: bytes.length, sha256: checksum }],
      operationKey: randomUUID(),
    });
    if (kind === "audio") {
      await page.goto("/sessions");
      await page.evaluate(
        async ({ owner, sessionId, sourceId, bytes }) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("recalino-recordings-v1", 3);
            request.onupgradeneeded = () => {
              const result = request.result;
              if (!result.objectStoreNames.contains("recordings")) {
                result
                  .createObjectStore("recordings", { keyPath: ["userId", "id"] })
                  .createIndex("owner", "userId");
                result.createObjectStore("chunks", {
                  keyPath: ["userId", "recordingId", "sequence"],
                });
              }
              if (!result.objectStoreNames.contains("photos"))
                result.createObjectStore("photos", { keyPath: ["userId", "recordingId", "id"] });
              if (!result.objectStoreNames.contains("deletedAccounts"))
                result.createObjectStore("deletedAccounts", { keyPath: "userId" });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const transaction = database.transaction(["recordings", "chunks"], "readwrite");
          const done = new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
          });
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          transaction.objectStore("recordings").put({
            id,
            userId: owner,
            sessionId,
            sourceAssetId: sourceId,
            mimeType: "audio/wav",
            status: "saved",
            createdAt: now,
            updatedAt: now,
            activeMs: 1000,
            chunks: 1,
            bytes: bytes.length,
            creationKey: crypto.randomUUID(),
          });
          transaction.objectStore("chunks").put({
            userId: owner,
            recordingId: id,
            sequence: 0,
            blob: new Blob([Uint8Array.from(bytes)], { type: "audio/wav" }),
          });
          await done;
          database.close();
        },
        {
          owner: userId,
          sessionId: session.id,
          sourceId: source.assetId,
          bytes: Array.from(bytes),
        },
      );
      return { sessionId: session.id, sourceId: source.assetId };
    }
    if (!source.uploadId) throw new Error("Synthetic original upload is missing.");
    const store = new MemoryObjectStore();
    const write = await uploadPartLink(
      db,
      store,
      ctx,
      source.uploadId,
      0,
      DEFAULT_PLT_SETTINGS.storage,
    );
    expect(store.upload(write.url, bytes, "text/plain")).toBe(200);
    await confirmUploadPart(db, store, ctx, source.uploadId, 0);
    const verified = await verifyUpload(db, store, ctx, source.uploadId);
    expect(verified.state).toBe("verified");
    return { sessionId: session.id, sourceId: source.assetId };
  } finally {
    await db.destroy();
  }
}

async function mockRead(page: Page, seeded: Awaited<ReturnType<typeof fixture>>, failure = false) {
  const seen = deferred();
  const response = deferred();
  let requests = 0;
  const originalUrl = new URL(
    `/__synthetic-original/${seeded.sourceId}`,
    test.info().project.use.baseURL,
  ).href;
  await page.context().route(originalUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Synthetic original</title><p>Synthetic original opened.</p>",
    }),
  );
  await page.route(`**/api/sources/${seeded.sourceId}/read`, async (route) => {
    requests++;
    seen.resolve();
    await response.promise;
    await route.fulfill(
      failure
        ? {
            status: 404,
            json: {
              error: { code: "not_found", message: "The original file is no longer available." },
            },
          }
        : { json: { url: originalUrl } },
    );
  });
  await page.goto(`/sessions/${seeded.sessionId}/sources`);
  const button = page.getByRole("button", { name: "Open original", exact: true });
  await expect(button).toBeEnabled();
  return {
    button,
    originalUrl,
    requests: () => requests,
    seen: seen.promise,
    release: response.resolve,
  };
}

test.describe("FR-SRC-012 original-file access", () => {
  test.describe.configure({ timeout: 120000 });

  test("reserves a safe tab on the click before a delayed read link returns", async ({ page }) => {
    const seeded = await fixture(page);
    const read = await mockRead(page, seeded);
    const opened = page.waitForEvent("popup");
    await read.button.click();
    const popup = await opened;
    await read.seen;
    expect(popup.url()).toBe("about:blank");
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await expect(read.button).toBeDisabled();
    read.release();
    await expect(popup).toHaveURL(read.originalUrl);
    await expect(popup.getByText("Synthetic original opened.")).toBeVisible();
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await expect(read.button).toBeEnabled();
    expect(read.requests()).toBe(1);
    await page.screenshot({
      path: test.info().outputPath("open-original-success.png"),
      fullPage: true,
    });
    await popup.close();
  });

  test("offers a direct link when the browser blocks the reserved tab", async ({ page }) => {
    await page.addInitScript(() => {
      window.open = () => null;
    });
    const seeded = await fixture(page);
    const read = await mockRead(page, seeded);
    await read.button.click();
    await read.seen;
    expect(page.context().pages()).toHaveLength(1);
    read.release();
    const fallback = page.getByRole("link", {
      name: "Open file: synthetic-original.txt",
      exact: true,
    });
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute("href", read.originalUrl);
    await expect(fallback).toHaveAttribute("target", "_blank");
    await expect(fallback).toHaveAttribute("rel", /noopener/);
    const opened = page.context().waitForEvent("page");
    await fallback.click();
    const popup = await opened;
    await expect(popup).toHaveURL(read.originalUrl);
    await expect(popup.getByText("Synthetic original opened.")).toBeVisible();
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(read.requests()).toBe(1);
    await popup.close();
  });

  test("closes the reserved tab and shows the read error when the original is unavailable", async ({
    page,
  }) => {
    const seeded = await fixture(page);
    const read = await mockRead(page, seeded, true);
    const opened = page.waitForEvent("popup");
    await read.button.click();
    const popup = await opened;
    await read.seen;
    const closed = popup.waitForEvent("close");
    read.release();
    await closed;
    await expect(
      page.getByRole("alert").filter({ hasText: "The original file is no longer available." }),
    ).toBeVisible();
    await expect(read.button).toBeEnabled();
    expect(page.context().pages()).toHaveLength(1);
    expect(read.requests()).toBe(1);
    await expect(
      page.getByRole("link", { name: "Open file: synthetic-original.txt", exact: true }),
    ).toHaveCount(0);
  });

  test("a rapid double click does not create another blank tab or another read request", async ({
    page,
  }) => {
    const seeded = await fixture(page);
    const read = await mockRead(page, seeded);
    const popups: Page[] = [];
    page.context().on("page", (popup) => popups.push(popup));
    const opened = page.waitForEvent("popup");
    await read.button.dblclick();
    const popup = await opened;
    await read.seen;
    await expect(read.button).toBeDisabled();
    expect(popups).toHaveLength(1);
    expect(page.context().pages()).toHaveLength(2);
    expect(read.requests()).toBe(1);
    read.release();
    await expect(popup).toHaveURL(read.originalUrl);
    await expect(read.button).toBeEnabled();
    expect(popups).toHaveLength(1);
    expect(read.requests()).toBe(1);
    await popup.close();
  });

  test("opens saved local audio without requesting a server original", async ({ page }) => {
    const seeded = await fixture(page, "audio");
    let reads = 0;
    await page.route(`**/api/sources/${seeded.sourceId}/read`, async (route) => {
      reads++;
      await route.abort();
    });
    await page.goto(`/sessions/${seeded.sessionId}/sources`);
    const button = page.getByRole("button", { name: "Open original", exact: true });
    await expect(button).toBeEnabled();
    const opened = page.waitForEvent("popup");
    await button.click();
    const popup = await opened;
    await expect(popup).toHaveURL(/^blob:/);
    await expect
      .poll(() => new URL(popup.url()).origin)
      .toBe(new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin);
    const media = popup.locator("audio, video");
    await expect(media).toBeVisible();
    await expect
      .poll(() => media.evaluate((element: HTMLMediaElement) => element.currentSrc))
      .toBe(popup.url());
    await expect
      .poll(() => media.evaluate((element: HTMLMediaElement) => element.duration))
      .toBe(1);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await expect(page.getByText("Original opened in a new tab.", { exact: true })).toBeVisible();
    expect(reads).toBe(0);
    await popup.close();
  });

  test("invalidates the cached local-audio link only after source deletion succeeds", async ({
    page,
  }) => {
    const revoked: string[] = [];
    await page.exposeFunction("__originalRevoked", (url: string) => revoked.push(url));
    await page.addInitScript(() => {
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => {
        revoke(url);
        const report = (window as unknown as { __originalRevoked: (url: string) => Promise<void> })
          .__originalRevoked;
        void report(url);
      };
    });
    const seeded = await fixture(page, "audio");
    const deletionStarted = deferred();
    const deletionResponse = deferred();
    await page.route(`**/api/sources/${seeded.sourceId}`, async (route) => {
      expect(route.request().method()).toBe("DELETE");
      expect(route.request().postDataJSON()).toEqual({ mode: "all" });
      deletionStarted.resolve();
      await deletionResponse.promise;
      await route.fulfill({
        status: 202,
        json: { deletionRequestId: randomUUID(), privacyRequestId: randomUUID() },
      });
    });
    await page.goto(`/sessions/${seeded.sessionId}/sources`);
    const button = page.getByRole("button", { name: "Open original", exact: true });
    await expect(button).toBeEnabled();
    const opened = page.waitForEvent("popup");
    await button.click();
    const popup = await opened;
    await expect(popup).toHaveURL(/^blob:/);
    await expect
      .poll(() => new URL(popup.url()).origin)
      .toBe(new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin);
    const originalUrl = popup.url();
    await expect(page.getByText("Original opened in a new tab.", { exact: true })).toBeVisible();
    await expect(button).toBeEnabled();
    await popup.close();
    expect(revoked).not.toContain(originalUrl);
    expect(
      await page.evaluate((url) => fetch(url).then((response) => response.ok), originalUrl),
    ).toBe(true);
    // D106: the line's Delete options control opens a sheet with the same choices.
    await page.getByRole("button", { name: "Delete options", exact: true }).click();
    await page.getByLabel("I understand that deletion cannot be undone.", { exact: true }).check();
    await page.getByRole("button", { name: "Delete from all sessions", exact: true }).click();
    await deletionStarted.promise;
    expect(revoked).not.toContain(originalUrl);
    deletionResponse.resolve();
    await expect(
      page.getByText("Material deleted from all sessions.", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => revoked.filter((url) => url === originalUrl)).toEqual([originalUrl]);
    expect(
      await page.evaluate(
        (url) =>
          fetch(url).then(
            () => true,
            () => false,
          ),
        originalUrl,
      ),
    ).toBe(false);
  });
});

// D106: one compact line per file, with small controls, and Add more material at the end.
test.describe("D106 session material list", () => {
  test.describe.configure({ timeout: 120000 });

  for (const viewport of [VIEWPORTS.mobile, VIEWPORTS.desktop]) {
    test(`shows a compact line and ends with Add more material (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const seeded = await fixture(page);
      let reads = 0;
      await page.route(`**/api/sources/${seeded.sourceId}/read`, async (route) => {
        reads++;
        await route.abort();
      });
      await page.goto(`/sessions/${seeded.sessionId}/sources`);
      const material = page.locator("#session-material");
      const line = material
        .getByRole("listitem")
        .filter({ has: page.getByText("synthetic-original.txt", { exact: true }) });
      await expect(line.getByRole("button", { name: "Open original", exact: true })).toBeEnabled();
      await expect(
        line.getByRole("button", { name: "Remove from session", exact: true }),
      ).toBeVisible();
      // A text file keeps its icon: no picture and no read link is requested for it.
      await expect(line.locator("img")).toHaveCount(0);
      const add = material.getByRole("button", { name: "Add more material", exact: true });
      await expect(add).toBeEnabled();
      await expect(material.getByRole("button", { name: "Use existing material" })).toBeEnabled();
      const chooser = page.waitForEvent("filechooser");
      await add.click();
      await chooser;
      await expect(
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).resolves.toBe(true);
      await expectNoAxeViolations(page);

      await line.getByRole("button", { name: "Delete options", exact: true }).click();
      const removeAll = line.getByRole("button", { name: "Delete from all sessions", exact: true });
      await expect(removeAll).toBeDisabled();
      await line.getByLabel("I understand that deletion cannot be undone.").check();
      await expect(removeAll).toBeEnabled();
      await line.getByRole("button", { name: "Close", exact: true }).click();
      await expect(line.getByRole("heading", { name: "Delete options" })).toHaveCount(0);
      await expect(line.getByRole("button", { name: "Delete options", exact: true })).toBeFocused();
      expect(reads).toBe(0);
    });
  }
});
