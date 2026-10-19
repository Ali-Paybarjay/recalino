import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { AiProvider } from "@recalino/core/aip";
import { createDatabase } from "@recalino/core/db";
import { createSession } from "@recalino/core/org";
import { sha256Hex } from "@recalino/core/plt";
import { createProcessingRun, getProcessingRunSnapshot } from "@recalino/core/proc";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import { acceptSourceNotice, createSource, readInputContract } from "@recalino/core/src";
import { z } from "zod";
import { LOCAL_APP_DATABASE_URL } from "../../../packages/core/test/local-db";
import { signInAsNewLearner } from "./learner";

test.describe.configure({ timeout: 180_000 });
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
});
test.afterAll(() => {
  writeFileSync(
    new URL("../../../artifacts/verification/background-uploads-browser.json", import.meta.url),
    JSON.stringify(
      {
        environment:
          "Local Auth + Postgres; source transport and learning endpoint mocked; no live Blob or AI",
        results,
      },
      null,
      2,
    ),
  );
});
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function fixture(page: Page) {
  const local = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (
    !local(new URL(test.info().project.use.baseURL ?? "").hostname) ||
    !local(new URL(process.env.SUPABASE_URL ?? "").hostname)
  )
    throw new Error("Background upload browser fixtures require local Auth, browser and database.");
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  try {
    const ctx = { userId, requestId: randomUUID() };
    const session = await createSession(
      db,
      ctx,
      { title: "Synthetic background upload" },
      { key: randomUUID() },
    );
    const contract = await readInputContract(db);
    await acceptSourceNotice(db, ctx, contract.noticeVersion, true);
    return { userId, sessionId: session.id, contract };
  } finally {
    await db.destroy();
  }
}
async function transport(page: Page, sessionId: string) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("Expected local base URL");
  const uploads = new Map<
    string,
    {
      parts: { index: number; sizeBytes: number }[];
      stored: Set<number>;
      confirmed: Set<number>;
      state: string;
    }
  >();
  const puts: number[] = [];
  const creations: { key: string | undefined; body: Record<string, unknown> }[] = [];
  const held = gate();
  const state = {
    hold: -1,
    fail: false,
    completed: 0,
    batchId: null as string | null,
    declared: [] as string[],
    ready: false,
    read: false,
  };
  const inbox = () => ({
    items: state.ready
      ? [
          {
            id: "00000000-0000-4000-8000-000000000001",
            kind: "processing_ready",
            href: `/classes/${sessionId}/notes`,
            createdAt: new Date().toISOString(),
            readAt: state.read ? new Date().toISOString() : null,
          },
        ]
      : [],
    unreadCount: state.ready && !state.read ? 1 : 0,
  });
  await page.route("**/api/notifications", async (route) => {
    if (route.request().method() === "PATCH") state.read = true;
    await route.fulfill({ json: inbox() });
  });
  await page.route("**/api/notifications/push*", (route) =>
    route.fulfill({ json: { publicKey: null, subscribed: false } }),
  );
  await page.route(`**/api/classes/${sessionId}/learning`, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "begin") {
        state.batchId = body.batchId;
        state.declared = body.expectedFileIds;
      }
      if (body.action === "complete")
        throw new Error("The browser must leave manifest sealing to server verification.");
    }
    await route.fulfill({
      json: {
        state: "waiting_sources",
        revision: 7,
        batchId: state.batchId,
        run: null,
        snapshot: null,
        lastError: null,
        message: "Checking uploaded files…",
        notesReady: false,
        cardsReady: false,
      },
    });
  });
  await page.route(/\/api\/sources(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    const body = route.request().postDataJSON();
    creations.push({ key: route.request().headers()["idempotency-key"], body });
    expect(body.batchId).toBe(state.batchId);
    expect(state.declared).toContain(body.fileId);
    const assetId = randomUUID(),
      uploadId = randomUUID();
    uploads.set(uploadId, {
      parts: body.parts,
      stored: new Set(),
      confirmed: new Set(),
      state: "pending",
    });
    await route.fulfill({ status: 201, json: { assetId, uploadId } });
  });
  await page.route("**/api/sources/uploads/**", async (route) => {
    const chunks = new URL(route.request().url()).pathname.split("/");
    const id = chunks[4];
    const upload = id ? uploads.get(id) : undefined;
    if (!upload) throw new Error("Unknown synthetic upload");
    if (chunks[5] === "complete") {
      expect(upload.confirmed.size).toBe(upload.parts.length);
      state.completed++;
      upload.state = "verifying";
      await route.fulfill({ status: 202, json: { state: "verifying", jobId: randomUUID() } });
    } else if (chunks[5] === "parts") {
      const index = Number(chunks[6]);
      if (route.request().method() === "GET")
        await route.fulfill({ json: { url: `${baseURL}/__synthetic-background/${id}/${index}` } });
      else {
        if (upload.stored.has(index)) upload.confirmed.add(index);
        await route.fulfill({ json: { confirmed: upload.confirmed.has(index) } });
      }
    } else
      await route.fulfill({
        json: {
          state: upload.state,
          parts: upload.parts.map((part) => ({
            ...part,
            verifiedAt: upload.confirmed.has(part.index) ? new Date().toISOString() : null,
          })),
        },
      });
  });
  await page.route("**/__synthetic-background/**", async (route) => {
    const [, , id, part] = new URL(route.request().url()).pathname.split("/");
    const index = Number(part),
      upload = id ? uploads.get(id) : undefined;
    if (!upload) throw new Error("Unknown synthetic storage upload");
    puts.push(index);
    if (state.hold === index) await held.promise;
    if (state.fail) {
      await route.fulfill({ status: 400, body: "Synthetic storage rejection" });
      return;
    }
    upload.stored.add(index);
    await route.fulfill({ status: 200, body: "" }).catch(() => {});
  });
  return {
    state,
    puts,
    creations,
    uploads,
    release: () => {
      state.hold = -1;
      held.release();
    },
  };
}
async function saved(page: Page, userId: string) {
  return page.evaluate(async (owner) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("recalino-uploads-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<
        {
          id: string;
          phase: string;
          entries: { id: string; creationKey: string; phase: string }[];
        }[]
      >((resolve, reject) => {
        const request = db
          .transaction("batches")
          .objectStore("batches")
          .index("owner")
          .getAll(owner);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, userId);
}
async function selectAndSend(page: Page, sessionId: string, bytes: Buffer) {
  await page.goto(`/sessions/${sessionId}/sources`);
  await expect(page.getByLabel("Choose session files")).toBeEnabled();
  const queueTitle = page.getByRole("heading", { name: "Files to upload", exact: true });
  await expect(queueTitle).toHaveCount(0);
  await page.getByLabel("Choose session files").setInputFiles({
    name: "synthetic-background.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  const submit = page.getByRole("button", { name: "Upload & Process", exact: true });
  await expect(page.getByText("1 file to upload", { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(queueTitle).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Session material", exact: true })).toBeVisible();
  await expect(page.getByText("synthetic-background.pdf", { exact: true }).first()).toBeVisible();
}
for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`continues a saved upload after SPA navigation (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const seeded = await fixture(page),
      mock = await transport(page, seeded.sessionId);
    mock.state.hold = 0;
    await selectAndSend(
      page,
      seeded.sessionId,
      Buffer.from("%PDF-1.4 Synthetic browser transport fixture"),
    );
    await expect.poll(() => mock.puts.length).toBe(1);
    await page.evaluate(() => {
      (window as Window & { uploadNavigationMarker?: boolean }).uploadNavigationMarker = true;
    });
    await page.getByRole("link", { name: "Back to session" }).click();
    await expect(page).toHaveURL(`/sessions/${seeded.sessionId}`);
    expect(
      await page.evaluate(
        () => (window as Window & { uploadNavigationMarker?: boolean }).uploadNavigationMarker,
      ),
    ).toBe(true);
    await expect(page.getByRole("complementary", { name: "Saved uploads" })).toBeVisible();
    await page.screenshot({
      path: `../../artifacts/verification/background-uploads-${viewport.name}.png`,
      fullPage: true,
    });
    mock.release();
    await expect.poll(() => mock.state.completed).toBe(1);
    await expect.poll(async () => (await saved(page, seeded.userId))[0]?.phase).toBe("received");
    expect(mock.creations).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
test("reload restores the saved file and stable source key and skips server-confirmed parts", async ({
  page,
}) => {
  const seeded = await fixture(page),
    mock = await transport(page, seeded.sessionId);
  mock.state.hold = 1;
  const bytes = Buffer.alloc(seeded.contract.partBytes * 2 + 19, 65);
  expect(bytes.length).toBeLessThanOrEqual(seeded.contract.formats.pdf.maxBytes);
  await selectAndSend(page, seeded.sessionId, bytes);
  await expect.poll(() => mock.uploads.values().next().value?.confirmed.size).toBe(2);
  const before = (await saved(page, seeded.userId))[0];
  expect(before?.entries[0]?.creationKey).toBe(mock.creations[0]?.key);
  await page.reload();
  await expect.poll(() => mock.puts.filter((index) => index === 1).length).toBe(2);
  mock.release();
  await expect.poll(() => mock.state.completed).toBe(1);
  expect(mock.puts.filter((index) => index === 0)).toHaveLength(1);
  expect(mock.puts.filter((index) => index === 2)).toHaveLength(1);
  expect(mock.creations).toHaveLength(1);
  await expect.poll(async () => (await saved(page, seeded.userId))[0]?.phase).toBe("received");
});
test("retries a failed saved file without picker reselection", async ({ page }) => {
  const seeded = await fixture(page),
    mock = await transport(page, seeded.sessionId);
  mock.state.fail = true;
  await selectAndSend(page, seeded.sessionId, Buffer.from("%PDF-1.4 Synthetic rejected transfer"));
  await expect(page.getByRole("button", { name: "Retry saved file", exact: true })).toBeVisible();
  const before = (await saved(page, seeded.userId))[0];
  expect(mock.state.completed).toBe(0);
  mock.state.fail = false;
  await page.getByRole("button", { name: "Retry saved file", exact: true }).click();
  await expect.poll(() => mock.state.completed).toBe(1);
  expect(mock.creations).toHaveLength(1);
  await expect.poll(async () => (await saved(page, seeded.userId))[0]?.phase).toBe("received");
  expect((await saved(page, seeded.userId))[0]?.entries[0]?.creationKey).toBe(
    before?.entries[0]?.creationKey,
  );
});
test("keeps ready results in the inbox when device push is unavailable", async ({ page }) => {
  const seeded = await fixture(page),
    mock = await transport(page, seeded.sessionId);
  mock.state.ready = true;
  await page.goto(`/sessions/${seeded.sessionId}`);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(
    dialog.getByText("Your session materials are ready.", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open result" })).toHaveAttribute(
    "href",
    `/classes/${seeded.sessionId}/notes`,
  );
  await expect(dialog.getByText(/Results stay in this inbox\./)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Notify me when materials are ready" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "../../artifacts/verification/background-uploads-notification-inbox.png",
    fullPage: true,
  });
});

const noManualProviderCall = async () => {
  throw new Error("Manual audio browser fixture must never call Blob or AI.");
};
const manualProvider: AiProvider = {
  name: "synthetic-manual-browser",
  mode: "mock",
  settings: {
    version: "synthetic",
    llmModel: "synthetic/llm",
    visionModel: "synthetic/vision",
    sttModel: "synthetic/stt",
    ttsModel: "synthetic/tts",
    voice: "synthetic",
    promptVersion: "synthetic",
    maxInputCharacters: 10_000,
    maxOutputTokens: 1000,
    timeoutMs: 1000,
    maximumMicros: 1,
    currency: "USD",
    priceVersion: "synthetic",
    charactersPerPage: 1000,
    audioUrlSupported: false,
    sttProviderOptions: {},
    dataContractApproved: true,
  },
  structured: noManualProviderCall,
  transcribe: noManualProviderCall,
  speech: noManualProviderCall,
};
async function legacyAudioFixture(page: Page) {
  const base = await fixture(page);
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  const ctx = { userId: base.userId, requestId: randomUUID() };
  try {
    const bytes = Buffer.alloc(base.contract.partBytes * 2 + 19, 65);
    bytes.set([0x49, 0x44, 0x33]);
    const source = await createSource(db, ctx, {
      sessionId: base.sessionId,
      kind: "audio",
      mimeType: "audio/mpeg",
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      displayName: "synthetic-legacy-audio.mp3",
      durationMs: 4000,
      parts: [],
      operationKey: randomUUID(),
    });
    await grantEntitlement(db, {
      userId: base.userId,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3600_000),
      amounts: amounts({ audio: 100 }),
      operationKey: randomUUID(),
      actorId: "synthetic-browser-fixture",
      reason: "Local legacy audio navigation regression",
    });
    const run = await createProcessingRun(
      db,
      ctx,
      { sessionId: base.sessionId, operationKey: randomUUID() },
      {
        provider: manualProvider,
        job: {
          kind: "proc.synthetic_browser",
          version: 1,
          payload: z.strictObject({ runId: z.uuid(), userId: z.uuid() }),
          run: noManualProviderCall,
        },
      },
    );
    expect(run.state).toBe("awaiting_upload");
    expect(
      await db
        .selectFrom("proc.automatic_session")
        .select("session_id")
        .where("session_id", "=", base.sessionId)
        .execute(),
    ).toEqual([]);
    const snapshot = await getProcessingRunSnapshot(db, ctx, run.id);
    await page.goto("/sessions");
    await page.evaluate(
      async ({ userId, sessionId, sourceId, size }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("recalino-recordings-v1", 3);
          request.onupgradeneeded = () => {
            const database = request.result;
            database
              .createObjectStore("recordings", { keyPath: ["userId", "id"] })
              .createIndex("owner", "userId");
            database.createObjectStore("chunks", {
              keyPath: ["userId", "recordingId", "sequence"],
            });
            database.createObjectStore("photos", { keyPath: ["userId", "recordingId", "id"] });
            database.createObjectStore("deletedAccounts", { keyPath: "userId" });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const id = crypto.randomUUID(),
          now = new Date().toISOString(),
          bytes = new Uint8Array(size);
        bytes.fill(65);
        bytes.set([0x49, 0x44, 0x33]);
        const tx = db.transaction(["recordings", "chunks"], "readwrite");
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        tx.objectStore("recordings").put({
          id,
          userId,
          sessionId,
          sourceAssetId: sourceId,
          mimeType: "audio/mpeg",
          status: "saved",
          createdAt: now,
          updatedAt: now,
          activeMs: 4000,
          chunks: 1,
          bytes: size,
          creationKey: crypto.randomUUID(),
          autoRegister: false,
          autoGenerate: false,
        });
        tx.objectStore("chunks").put({
          userId,
          recordingId: id,
          sequence: 0,
          blob: new Blob([bytes], { type: "audio/mpeg" }),
        });
        await done;
        db.close();
      },
      {
        userId: base.userId,
        sessionId: base.sessionId,
        sourceId: source.assetId,
        size: bytes.length,
      },
    );
    return { ...base, sourceId: source.assetId, run, snapshot };
  } finally {
    await db.destroy();
  }
}

async function manualAudioTransport(
  page: Page,
  seeded: Awaited<ReturnType<typeof legacyAudioFixture>>,
) {
  const uploads = await transport(page, seeded.sessionId);
  const uploadId = randomUUID(),
    held = gate(),
    stored = new Set<number>(),
    confirmed = new Set<number>();
  const state = {
    hold: 1,
    completed: 0,
    activated: false,
    starts: [] as string[],
    puts: [] as number[],
    learningWrites: 0,
    processingWrites: 0,
  };
  const baseURL = test.info().project.use.baseURL;
  const current = () => ({ ...seeded.run, state: state.activated ? "queued" : "awaiting_upload" });
  await page.route(`**/api/classes/${seeded.sessionId}/learning`, async (route) => {
    if (route.request().method() !== "GET") state.learningWrites++;
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      json: {
        state: "idle",
        revision: 0,
        batchId: null,
        run: null,
        snapshot: null,
        lastError: null,
        message: "No automatic intent",
        notesReady: false,
        cardsReady: false,
      },
    });
  });
  await page.route(`**/api/classes/${seeded.sessionId}/processing`, async (route) => {
    if (route.request().method() !== "GET") state.processingWrites++;
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: [current()] });
  });
  await page.route(`**/api/runs/${seeded.run.id}*`, async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ action: "activate" });
      expect(state.completed).toBeGreaterThan(0);
      state.activated = true;
      await route.fulfill({ json: current() });
    } else
      await route.fulfill({
        json:
          new URL(route.request().url()).searchParams.get("includeSnapshot") === "1"
            ? { run: current(), snapshot: state.activated ? null : seeded.snapshot }
            : current(),
      });
  });
  await page.route(`**/api/sources/${seeded.sourceId}/audio*`, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (route.request().method() === "GET") {
      const index = query.get("index");
      await route.fulfill({
        json:
          index === null
            ? {
                state: state.completed ? "verifying" : "pending",
                parts: [0, 1, 2].map((index) => ({
                  index,
                  verifiedAt: confirmed.has(index) ? new Date().toISOString() : null,
                })),
              }
            : { url: `${baseURL}/__synthetic-manual-audio/${index}` },
      });
      return;
    }
    const body = route.request().postDataJSON();
    if (body.action === "start") {
      state.starts.push(route.request().headers()["idempotency-key"] ?? "");
      await route.fulfill({ status: 201, json: { uploadId } });
    } else if (body.action === "confirm_part") {
      if (stored.has(body.index)) confirmed.add(body.index);
      await route.fulfill({ json: { confirmed: confirmed.has(body.index) } });
    } else if (body.action === "complete") {
      expect(confirmed.size).toBe(3);
      state.completed++;
      await route.fulfill({ status: 202, json: { state: "verifying", uploadId } });
    } else throw new Error("Unexpected manual audio action");
  });
  await page.route("**/__synthetic-manual-audio/*", async (route) => {
    const index = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    state.puts.push(index);
    if (state.hold === index) await held.promise;
    stored.add(index);
    await route.fulfill({ status: 200, body: "" }).catch(() => {});
  });
  return {
    state,
    uploads,
    confirmed,
    release: () => {
      state.hold = -1;
      held.release();
    },
  };
}
async function savedManualAudio(page: Page, userId: string) {
  return page.evaluate(async (owner) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("recalino-manual-audio-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ runId: string; phase: string }[]>((resolve, reject) => {
        const request = db
          .transaction("transfers")
          .objectStore("transfers")
          .index("owner")
          .getAll(owner);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, userId);
}
async function captureEligibility(
  page: Page,
  userId: string,
  sessionId: string,
  eligible: boolean,
) {
  await page.evaluate(
    async ({ owner, session, eligible }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("recalino-recordings-v1", 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction("recordings", "readwrite");
        const completed = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        const store = tx.objectStore("recordings");
        const request = store.index("owner").getAll(owner);
        request.onsuccess = () => {
          for (const row of request.result)
            if (row.sessionId === session)
              store.put({
                ...row,
                autoRegister: eligible,
                autoGenerate: eligible,
                completedAt: new Date().toISOString(),
              });
        };
        await completed;
      } finally {
        db.close();
      }
    },
    { owner: userId, session: sessionId, eligible },
  );
}
for (const scenario of ["navigation", "reload"] as const) {
  test(`legacy confirmed audio survives ${scenario} without automatic intent or another paid run`, async ({
    page,
  }) => {
    const seeded = await legacyAudioFixture(page),
      mock = await manualAudioTransport(page, seeded);
    if (scenario === "navigation")
      await captureEligibility(page, seeded.userId, seeded.sessionId, true);
    await page.goto(`/sessions/${seeded.sessionId}/processing`);
    await expect.poll(() => mock.state.puts.length).toBe(3);
    await expect.poll(() => mock.state.starts.length).toBe(1);
    await expect
      .poll(async () => (await savedManualAudio(page, seeded.userId))[0]?.runId)
      .toBe(seeded.run.id);
    if (scenario === "navigation") {
      await page.evaluate(() => {
        (window as Window & { manualNavigationMarker?: boolean }).manualNavigationMarker = true;
      });
      await page.getByRole("link", { name: /Back to session/ }).click();
      await expect(page).toHaveURL(`/sessions/${seeded.sessionId}`);
      expect(
        await page.evaluate(
          () => (window as Window & { manualNavigationMarker?: boolean }).manualNavigationMarker,
        ),
      ).toBe(true);
    } else {
      await expect.poll(() => mock.confirmed.size).toBe(2);
      await page.reload();
      await expect.poll(() => mock.state.puts.filter((index) => index === 1).length).toBe(2);
    }
    await expect(page.getByRole("complementary", { name: "Saved audio uploads" })).toBeVisible();
    if (scenario === "navigation") {
      // Exercise another polling tick with automatic-eligible material in this class.
      await page.waitForTimeout(5500);
      expect(mock.state.learningWrites).toBe(0);
      expect(mock.state.processingWrites).toBe(0);
      await captureEligibility(page, seeded.userId, seeded.sessionId, false);
    }
    mock.release();
    await expect.poll(() => mock.state.completed).toBe(1);
    await expect.poll(async () => (await savedManualAudio(page, seeded.userId)).length).toBe(0);
    expect(
      mock.state.starts.every((key) => key === `audio-start:${seeded.run.id}:${seeded.sourceId}`),
    ).toBe(true);
    expect(mock.state.puts.filter((index) => index === 0)).toHaveLength(1);
    expect(mock.state.puts.filter((index) => index === 2)).toHaveLength(1);
    expect(mock.uploads.creations).toHaveLength(0);
    expect(mock.state.learningWrites).toBe(0);
    expect(mock.state.processingWrites).toBe(0);
  });
}
