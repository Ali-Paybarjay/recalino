import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "@recalino/core/db";
import { createSession } from "@recalino/core/org";
import { sha256Hex } from "@recalino/core/plt";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import { acceptSourceNotice, createSource, readInputContract } from "@recalino/core/src";
import { LOCAL_APP_DATABASE_URL } from "../../../packages/core/test/local-db";
import type { UploadBatch } from "../src/ui/workspace/upload-store";
import { signInAsNewLearner } from "./learner";

// Local Auth/Postgres supply the actual rejected source rows rendered by the server.
// Learning/unlock requests are synthetic: these checks must never start paid processing.
test.describe.configure({ timeout: 120_000 });
const artifactDirectory = new URL("../../../artifacts/verification/", import.meta.url);
const diagnostics = new WeakMap<Page, { pageErrors: string[]; consoleErrors: string[] }>();
const results: { title: string; status: string; pageErrors: string[]; consoleErrors: string[] }[] =
  [];
test.beforeEach(async ({ page }) => {
  const events = { pageErrors: [] as string[], consoleErrors: [] as string[] };
  diagnostics.set(page, events);
  page.on("pageerror", (error) => events.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") events.consoleErrors.push(message.text());
  });
});
test.afterEach(async ({ page }, info) => {
  const events = diagnostics.get(page) ?? { pageErrors: [], consoleErrors: [] };
  results.push({ title: info.title, status: info.status ?? "unknown", ...events });
  expect(events.pageErrors).toEqual([]);
  // Only the deliberate rejection of skipping the last remaining file may log HTTP 400.
  expect(events.consoleErrors.filter((message) => !message.includes("status of 400"))).toEqual([]);
});
test.afterAll(() => {
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(
    new URL("upload-recovery-browser.json", artifactDirectory),
    JSON.stringify(
      { environment: "Local Auth/Postgres; mocked learning and PDF unlock; no Blob/AI", results },
      null,
      2,
    ),
  );
});

async function fixture(page: Page, withRejectedSibling = false) {
  const local = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (
    !local(new URL(test.info().project.use.baseURL ?? "").hostname) ||
    !local(new URL(process.env.SUPABASE_URL ?? "").hostname)
  )
    throw new Error("Upload recovery fixtures require local Auth, browser and database.");
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  try {
    const ctx = { userId, requestId: randomUUID() };
    const session = await createSession(
      db,
      ctx,
      { title: "Synthetic received upload recovery" },
      { key: randomUUID() },
    );
    const contract = await readInputContract(db);
    await acceptSourceNotice(db, ctx, contract.noticeVersion, true);
    await grantEntitlement(db, {
      userId,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3600000),
      amounts: amounts({ storage: 100000 }),
      operationKey: randomUUID(),
      actorId: "synthetic-browser-fixture",
      reason: "Local received upload recovery regression",
    });
    const createdAt = Date.now();
    const batch: UploadBatch = {
      id: randomUUID(),
      userId,
      sessionId: session.id,
      contract,
      storageConfigured: true,
      createdAt,
      opened: true,
      phase: "received",
      entries: [],
      receipt: {
        revision: 11,
        previousRunId: null,
        sourceIds: [],
        total: withRejectedSibling ? 2 : 1,
        failed: 0,
        startedAt: createdAt,
      },
    };
    const sourceDeclarations: [string, string][] = [["password-protected.pdf", "needs_password"]];
    if (withRejectedSibling)
      sourceDeclarations.push(["rejected-checksum.pdf", "checksum_mismatch"]);
    for (const [displayName, rejectionReason] of sourceDeclarations) {
      const bytes = Buffer.from(`%PDF-1.4 Synthetic ${displayName}`);
      const source = await createSource(db, ctx, {
        sessionId: session.id,
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        sha256: sha256Hex(bytes),
        displayName,
        operationKey: randomUUID(),
        parts: [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }],
      });
      expect(source.uploadId).not.toBeNull();
      if (!source.uploadId) throw new Error("Expected a PDF upload session");
      await db
        .updateTable("src.upload_session")
        .set({ state: "rejected", rejection_reason: rejectionReason })
        .where("id", "=", source.uploadId)
        .execute();
      batch.entries.push({
        id: randomUUID(),
        displayName,
        sizeBytes: bytes.length,
        lastModified: createdAt,
        mimeType: "application/pdf",
        creationKey: randomUUID(),
        phase: "verifying",
        sentBytes: bytes.length,
        startedAt: createdAt,
        finishedAt: createdAt,
        serverSeen: true,
        registered: true,
        source: {
          assetId: source.assetId,
          uploadId: source.uploadId,
          displayName,
          kind: "pdf",
          mimeType: "application/pdf",
          sizeBytes: bytes.length,
          durationMs: null,
          pageCount: null,
          verifiedAt: null,
          originalDeletedAt: null,
          selected: false,
          role: "class_material",
          ranges: [],
          timeStatus: "unknown",
          contentVersionId: null,
          uploadState: "rejected",
          rejectionReason,
          anchorSourceId: null,
          captureOffsetMs: null,
          captureState: null,
        },
      });
      batch.receipt.sourceIds.push(source.assetId);
    }
    return { userId, sessionId: session.id, batch };
  } finally {
    await db.destroy();
  }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function mockRecovery(page: Page, seeded: Fixture) {
  const state = { sealed: false, cancelled: false, skipped: new Set<string>(), gets: 0 };
  const actions: { action: string; batchId: string; fileId?: string }[] = [];
  const unlocks: { assetId: string; password: string }[] = [];
  const forbidden: string[] = [];
  const status = () => ({
    state: state.cancelled ? "blocked" : state.sealed ? "processing" : "waiting_sources",
    revision: state.sealed || state.cancelled ? 12 : 11,
    batchId: state.sealed || state.cancelled ? null : seeded.batch.id,
    run: null,
    snapshot: null,
    lastError: state.cancelled
      ? "upload_batch_cancelled"
      : state.sealed
        ? null
        : "upload_needs_attention",
    message: state.cancelled
      ? "Saved upload cancelled."
      : state.sealed
        ? "Preparing class materials…"
        : "A file needs attention.",
    notesReady: false,
    cardsReady: false,
  });
  await page.route("**/api/notifications", (route) =>
    route.fulfill({ json: { items: [], unreadCount: 0 } }),
  );
  await page.route("**/api/notifications/push*", (route) =>
    route.fulfill({ json: { publicKey: null, subscribed: false } }),
  );
  await page.route(`**/api/classes/${seeded.sessionId}/learning`, async (route) => {
    if (route.request().method() === "GET") state.gets++;
    else {
      const body = route.request().postDataJSON() as (typeof actions)[number];
      actions.push(body);
      expect(body.batchId).toBe(seeded.batch.id);
      // Any destructive POST after sealing is a regression, even if its server would reject it.
      expect(state.sealed).toBe(false);
      if (body.action === "skip_file") {
        const entry = seeded.batch.entries.find((row) => row.id === body.fileId);
        expect(entry).toBeDefined();
        if (!entry?.source || !body.fileId) throw new Error("Expected a declared source entry");
        if (seeded.batch.entries.length - state.skipped.size <= 1) {
          await route.fulfill({
            status: 400,
            json: {
              error: {
                code: "validation_failed",
                message: "Some information is missing or not valid.",
                details: { fields: { batch: ["select_at_least_one"] } },
              },
            },
          });
          return;
        }
        state.skipped.add(body.fileId);
        await detach(seeded, [entry.source.assetId]);
      } else if (body.action === "cancel_batch") {
        state.cancelled = true;
        await detach(seeded, seeded.batch.receipt.sourceIds);
      } else throw new Error(`Unexpected received upload action: ${body.action}`);
    }
    await route.fulfill({ json: status() });
  });
  await page.route(/\/api\/sources\/[^/]+\/unlock$/, async (route) => {
    const assetId = new URL(route.request().url()).pathname.split("/")[3];
    if (!assetId) throw new Error("Expected a PDF source ID");
    unlocks.push({ assetId, password: route.request().postDataJSON().password });
    await route.fulfill({ status: 202, json: { state: "verifying" } });
  });
  // The received batch has no originals in IndexedDB. Recovery must not recreate or resend it.
  for (const pattern of [
    /\/api\/sources(?:\?.*)?$/,
    "**/api/sources/uploads/**",
    `**/api/classes/${seeded.sessionId}/sources**`,
  ])
    await page.route(pattern, async (route) => {
      forbidden.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: "conflict",
            message: "Unexpected source transport during received recovery.",
          },
        },
      });
    });
  return { state, actions, unlocks, forbidden };
}
async function detach(seeded: Fixture, assetIds: string[]) {
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  try {
    await db
      .updateTable("src.session_source")
      .set({ active: false })
      .where("user_id", "=", seeded.userId)
      .where("session_id", "=", seeded.sessionId)
      .where("asset_id", "in", assetIds)
      .execute();
  } finally {
    await db.destroy();
  }
}
async function openReceived(page: Page, seeded: Fixture, freezePolling = false) {
  await page.goto("/classes");
  await page.evaluate(async (batch) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("recalino-uploads-v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("batches", { keyPath: ["userId", "id"] }).createIndex(
          "owner",
          "userId",
        );
        db.createObjectStore("files", { keyPath: ["userId", "batchId", "id"] }).createIndex(
          "owner",
          "userId",
        );
        db.createObjectStore("deletedAccounts", { keyPath: "userId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction("batches", "readwrite");
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
      tx.objectStore("batches").put(batch);
      await done;
    } finally {
      db.close();
    }
  }, seeded.batch);
  if (freezePolling) {
    await page.clock.install();
  }
  await page.goto(`/classes/${seeded.sessionId}/sources`);
  await expect(page.getByRole("heading", { name: "Resolve uploaded files" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel saved upload", exact: true }),
  ).toBeVisible();
  if (freezePolling) {
    // Hydrate first, then keep the old controls while the next action GET sees sealing.
    const pauseAt = await page.evaluate(() => Date.now() + 1000);
    await page.clock.pauseAt(new Date(pauseAt));
  }
}
async function persisted(page: Page, seeded: Fixture) {
  return page.evaluate(
    async ({ userId, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("recalino-uploads-v1", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction(["batches", "files"]);
        const get = <T>(request: IDBRequest<T>) =>
          new Promise<T>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        const [batch, files] = await Promise.all([
          get(tx.objectStore("batches").get([userId, id])),
          get(tx.objectStore("files").index("owner").getAll(userId)),
        ]);
        return { batch: batch as UploadBatch, files: files.length };
      } finally {
        db.close();
      }
    },
    { userId: seeded.userId, id: seeded.batch.id },
  );
}
const sourceItem = (page: Page, name: string) =>
  page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`recovers received rejected and password files by skip or explicit cancellation (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const seeded = await fixture(page, true),
      mock = await mockRecovery(page, seeded);
    await openReceived(page, seeded);
    const password = sourceItem(page, "password-protected.pdf");
    await expect(
      password.getByText("Needs a password — enter it or upload an unlocked copy"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry saved file", exact: true })).toHaveCount(
      0,
    );
    expect((await persisted(page, seeded)).files).toBe(0);
    await password.getByText("Delete options", { exact: true }).click();
    await password.getByLabel("I understand that deletion cannot be undone.").check();
    await expect(password.getByRole("button", { name: "Delete entire source" })).toBeDisabled();
    await password.getByLabel("PDF password").fill("synthetic-secret");
    await password.getByRole("button", { name: "Unlock PDF" }).click();
    await expect(password.getByLabel("PDF password")).toHaveValue("");
    expect(mock.unlocks).toEqual([
      { assetId: seeded.batch.entries[0]?.source?.assetId, password: "synthetic-secret" },
    ]);
    expect(JSON.stringify((await persisted(page, seeded)).batch)).not.toContain("synthetic-secret");

    await sourceItem(page, "rejected-checksum.pdf")
      .getByRole("button", { name: "Skip this file", exact: true })
      .click();
    await expect(sourceItem(page, "rejected-checksum.pdf")).toHaveCount(0);
    const afterSkip = (await persisted(page, seeded)).batch;
    expect(afterSkip.phase).toBe("received");
    expect(afterSkip.receipt.total).toBe(1);
    expect(afterSkip.receipt.sourceIds).toEqual([seeded.batch.entries[0]?.source?.assetId]);
    expect(afterSkip.entries[1]?.phase).toBe("skipped");

    await password.getByRole("button", { name: "Skip this file", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "This is the last file in the upload group. Cancel this saved upload before adding a replacement.",
      }),
    ).toBeVisible();
    expect((await persisted(page, seeded)).batch.phase).toBe("received");
    mkdirSync(artifactDirectory, { recursive: true });
    await page.screenshot({
      path: `../../artifacts/verification/upload-recovery-${viewport.name}.png`,
      fullPage: true,
    });
    if (viewport.name === "mobile") {
      await page.getByRole("heading", { name: "Resolve uploaded files" }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "../../artifacts/verification/upload-recovery-mobile-actions.png",
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: "Cancel saved upload", exact: true }).click();
    await expect.poll(async () => (await persisted(page, seeded)).batch.phase).toBe("cancelled");
    await expect(
      page.getByText("Saved upload cancelled. You can add another file.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resolve uploaded files" })).toHaveCount(0);
    expect(mock.actions.map((body) => body.action)).toEqual([
      "skip_file",
      "skip_file",
      "cancel_batch",
    ]);
    expect(mock.forbidden).toEqual([]);
  });
}
for (const action of ["cancel", "skip"] as const) {
  test(`a stale received ${action} control reads the sealed server batch before any destructive request`, async ({
    page,
  }) => {
    const seeded = await fixture(page),
      mock = await mockRecovery(page, seeded);
    await openReceived(page, seeded, true);
    const before = await persisted(page, seeded),
      reads = mock.state.gets;
    mock.state.sealed = true;
    await page
      .getByRole("button", {
        name: action === "cancel" ? "Cancel saved upload" : "Skip this file",
        exact: true,
      })
      .click({ force: true });
    await expect.poll(() => mock.state.gets).toBeGreaterThan(reads);
    await expect(page.getByRole("heading", { name: "Resolve uploaded files" })).toHaveCount(0);
    const after = await persisted(page, seeded);
    expect(after.batch.phase).toBe("received");
    expect(after.batch.receipt.sourceIds).toEqual(before.batch.receipt.sourceIds);
    expect(after.batch.entries[0]?.phase).toBe("verifying");
    expect(after.files).toBe(0);
    expect(mock.actions).toEqual([]);
    expect(mock.unlocks).toEqual([]);
    expect(mock.forbidden).toEqual([]);
    await expect(
      sourceItem(page, "password-protected.pdf").getByRole("button", {
        name: "Remove from class",
        exact: true,
      }),
    ).toBeVisible();
    await page.clock.resume();
    await page.reload();
    await expect(
      sourceItem(page, "password-protected.pdf").getByRole("button", {
        name: "Remove from class",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resolve uploaded files" })).toHaveCount(0);
    expect((await persisted(page, seeded)).batch.phase).toBe("received");
    expect(mock.actions).toEqual([]);
    expect(mock.forbidden).toEqual([]);
  });
}
