import { randomUUID } from "node:crypto";
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

const unavailable = async () => {
  throw new Error("Browser audio regression must never invoke AI or a worker.");
};
const provider: AiProvider = {
  name: "synthetic-browser-fixture",
  mode: "mock",
  settings: {
    version: "synthetic",
    llmModel: "synthetic/llm",
    visionModel: "synthetic/vision",
    sttModel: "synthetic/stt",
    ttsModel: "synthetic/tts",
    voice: "synthetic",
    promptVersion: "synthetic",
    maxInputCharacters: 10000,
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
  structured: unavailable,
  transcribe: unavailable,
  speech: unavailable,
};

async function fixture(page: Page) {
  const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (
    !loopback(new URL(test.info().project.use.baseURL ?? "").hostname) ||
    !loopback(new URL(process.env.SUPABASE_URL ?? "").hostname)
  )
    throw new Error("Audio fixtures require local browser, local Auth and local Postgres.");
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  const ctx = { userId, requestId: randomUUID() };
  try {
    const session = await createSession(
      db,
      ctx,
      { title: "Synthetic audio recovery" },
      { key: randomUUID() },
    );
    const contract = await readInputContract(db);
    const sizeBytes = contract.partBytes * 4 + 3;
    const bytes = new Uint8Array(sizeBytes);
    bytes.set([0x49, 0x44, 0x33]);
    await acceptSourceNotice(db, ctx, contract.noticeVersion, true);
    const source = await createSource(db, ctx, {
      sessionId: session.id,
      kind: "audio",
      mimeType: "audio/mpeg",
      sizeBytes,
      sha256: sha256Hex(bytes),
      displayName: "synthetic-device-recording.mp3",
      durationMs: 4000,
      parts: [],
      operationKey: randomUUID(),
    });
    await grantEntitlement(db, {
      userId,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 3600000),
      amounts: amounts({ audio: 100 }),
      operationKey: randomUUID(),
      actorId: "synthetic-browser-fixture",
      reason: "Local audio upload browser regression",
    });
    const run = await createProcessingRun(
      db,
      ctx,
      { sessionId: session.id, operationKey: randomUUID() },
      {
        provider,
        job: {
          kind: "proc.synthetic_browser",
          version: 1,
          payload: z.strictObject({ runId: z.uuid(), userId: z.uuid() }),
          run: unavailable,
        },
      },
    );
    expect(run.state).toBe("awaiting_upload");
    await page.goto("/classes");
    await page.evaluate(
      async ({ owner, sessionId, sourceId, size }) => {
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
        const bytes = new Uint8Array(size);
        bytes.set([0x49, 0x44, 0x33]);
        transaction.objectStore("recordings").put({
          id,
          userId: owner,
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
        });
        transaction.objectStore("chunks").put({
          userId: owner,
          recordingId: id,
          sequence: 0,
          blob: new Blob([bytes], { type: "audio/mpeg" }),
        });
        await done;
        database.close();
      },
      { owner: userId, sessionId: session.id, sourceId: source.assetId, size: sizeBytes },
    );
    const snapshot = await getProcessingRunSnapshot(db, ctx, run.id);
    return { userId, sessionId: session.id, sourceId: source.assetId, run, snapshot };
  } finally {
    await db.destroy();
  }
}

async function mockUpload(
  page: Page,
  seeded: Awaited<ReturnType<typeof fixture>>,
  mode: "transient" | "corrupt" | "offline" | "exhausted",
) {
  const uploadId = randomUUID();
  const stored = new Set<number>();
  const confirmed = new Set<number>();
  const puts: { index: number; lease: string }[] = [];
  const leases: number[] = [];
  let failures = 0;
  let complete = 0;
  let activations = 0;
  let recovered = false;
  let retriesObserved!: () => void;
  const failedAttemptsObserved = new Promise<void>((resolve) => {
    retriesObserved = resolve;
  });
  let completionObserved!: () => void;
  const completed = new Promise<void>((resolve) => {
    completionObserved = resolve;
  });
  const baseURL = test.info().project.use.baseURL ?? "";
  await page.route(`**/api/classes/${seeded.sessionId}/processing`, (route) =>
    route.fulfill({ json: [{ ...seeded.run, state: complete ? "queued" : "awaiting_upload" }] }),
  );
  await page.route(`**/api/runs/${seeded.run.id}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          run: { ...seeded.run, state: complete ? "queued" : "awaiting_upload" },
          snapshot: seeded.snapshot,
        },
      });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({ action: "activate" });
    expect(confirmed.size).toBe(5);
    expect(complete).toBe(1);
    activations++;
    await route.fulfill({ json: { ...seeded.run, state: "queued" } });
  });
  await page.route(`**/api/sources/${seeded.sourceId}/audio*`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      const index = url.searchParams.get("index");
      if (index !== null) {
        const part = Number(index);
        leases[part] = (leases[part] ?? 0) + 1;
        await route.fulfill({
          json: { url: `${baseURL}/__synthetic-audio/${part}?lease=${leases[part]}` },
        });
      } else
        await route.fulfill({
          json: {
            parts: Array.from({ length: 5 }, (_, index) => ({
              index,
              verifiedAt: confirmed.has(index) ? new Date().toISOString() : null,
            })),
          },
        });
      return;
    }
    const body = request.postDataJSON();
    if (body.action === "start") {
      await route.fulfill({ status: 201, json: { uploadId } });
    } else if (body.action === "confirm_part") {
      if (mode === "corrupt" && body.index === 3 && stored.has(3))
        await route.fulfill({
          status: 400,
          json: {
            error: {
              code: "validation_failed",
              message: "Some information is missing or not valid.",
              details: { fields: { audio: ["part_integrity_mismatch"] } },
            },
          },
        });
      else {
        if (stored.has(body.index)) confirmed.add(body.index);
        await route.fulfill({ json: { confirmed: stored.has(body.index) } });
      }
    } else if (body.action === "complete") {
      complete++;
      await route.fulfill({ status: 202, json: { uploadId, state: "pending" } });
      completionObserved();
    } else throw new Error(`Unexpected synthetic audio action: ${body.action}`);
  });
  await page.route("**/__synthetic-audio/*", async (route) => {
    const url = new URL(route.request().url());
    const index = Number(url.pathname.split("/").at(-1));
    puts.push({ index, lease: url.searchParams.get("lease") ?? "" });
    const fail = index === 3 && (mode === "exhausted" ? !recovered : failures < 1);
    if (fail && mode !== "corrupt") {
      failures++;
      if (mode === "offline") {
        await connectivity(page, false);
        await route.abort("internetdisconnected");
      } else {
        await route.fulfill({ status: 503, body: "Temporary synthetic gateway failure" });
        if (mode === "exhausted" && failures >= 3) retriesObserved();
      }
    } else {
      stored.add(index);
      await route.fulfill({ status: 200, body: "" });
    }
  });
  return {
    puts,
    leases,
    confirmed,
    completions: () => complete,
    waitForCompletion: () => completed,
    activations: () => activations,
    waitForFailedAttempts: () => failedAttemptsObserved,
    recover: () => {
      recovered = true;
    },
  };
}

async function connectivity(page: Page, online: boolean) {
  await page.evaluate((connected) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => connected });
    window.dispatchEvent(new Event(connected ? "online" : "offline"));
  }, online);
}

test.describe("FR-SRC-004 audio upload recovery", () => {
  test.describe.configure({ timeout: 120000 });

  test("retries part 4 with a fresh URL, confirms every successful part and clears old progress", async ({
    page,
  }) => {
    const seeded = await fixture(page);
    const state = await mockUpload(page, seeded, "transient");
    await page.goto(`/classes/${seeded.sessionId}/processing`);
    await state.waitForCompletion();
    await expect.poll(state.completions).toBe(1);
    expect(state.puts.map((part) => part.index).sort()).toEqual([0, 1, 2, 3, 3, 4]);
    expect(state.puts.filter((part) => part.index === 3).map((part) => part.lease)).toEqual([
      "1",
      "2",
    ]);
    expect([...state.confirmed].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(state.completions()).toBe(1);
    await expect.poll(state.activations).toBe(1);
    await expect(page.getByRole("complementary", { name: "Saved audio uploads" })).toHaveCount(0);
    await expect(
      page.getByText(/Uploading audio part|Connection interrupted\. Retrying/),
    ).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("stops on an integrity failure without retrying or leaving an uploading message", async ({
    page,
  }) => {
    const seeded = await fixture(page);
    const state = await mockUpload(page, seeded, "corrupt");
    await page.goto(`/classes/${seeded.sessionId}/processing`);
    await expect(
      page
        .getByRole("complementary", { name: "Saved audio uploads" })
        .getByRole("status")
        .filter({ hasText: "The uploaded audio part did not match the saved recording." }),
    ).toBeVisible();
    expect(state.puts.map((part) => part.index).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(state.completions()).toBe(0);
    expect(state.activations()).toBe(0);
    await expect(
      page.getByText(/Uploading audio part|Connection interrupted\. Retrying/),
    ).toHaveCount(0);
    await connectivity(page, false);
    await connectivity(page, true);
    await expect(
      page.getByRole("button", { name: "Retry saved audio upload", exact: true }),
    ).toBeEnabled();
    expect(state.puts).toHaveLength(5);
  });

  test("waits through disconnection and resumes after reconnect without reuploading confirmed parts", async ({
    page,
  }) => {
    const seeded = await fixture(page);
    const state = await mockUpload(page, seeded, "offline");
    await page.goto(`/classes/${seeded.sessionId}/processing`);
    await expect(
      page.getByText("Saved on this device. Upload resumes when you reconnect."),
    ).toBeVisible();
    expect(state.completions()).toBe(0);
    await connectivity(page, true);
    await expect.poll(state.completions).toBe(1);
    expect(state.puts.map((part) => part.index).sort()).toEqual([0, 1, 2, 3, 3, 4]);
    expect(state.completions()).toBe(1);
    await expect.poll(state.activations).toBe(1);
  });

  test("retries on return to the foreground after automatic attempts are exhausted", async ({
    page,
  }) => {
    const seeded = await fixture(page);
    const state = await mockUpload(page, seeded, "exhausted");
    await page.goto(`/classes/${seeded.sessionId}/processing`);
    await state.waitForFailedAttempts();
    await expect(
      page
        .getByRole("complementary", { name: "Saved audio uploads" })
        .getByRole("status")
        .filter({ hasText: "Audio upload was interrupted. The original is saved on this device." }),
    ).toBeVisible();
    const failedAttempts = state.puts.filter((part) => part.index === 3).length;
    expect(failedAttempts).toBeGreaterThanOrEqual(3);
    expect(state.completions()).toBe(0);
    await expect(
      page.getByText(/Uploading audio part|Connection interrupted\. Retrying/),
    ).toHaveCount(0);
    state.recover();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(state.completions).toBe(1);
    expect(
      state.puts
        .filter((part) => part.index !== 3)
        .map((part) => part.index)
        .sort(),
    ).toEqual([0, 1, 2, 4]);
    expect(state.puts.filter((part) => part.index === 3)).toHaveLength(failedAttempts + 1);
    expect(state.completions()).toBe(1);
    await expect.poll(state.activations).toBe(1);
  });
});
