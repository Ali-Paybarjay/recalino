import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import type { AiProvider } from "@recalino/core/aip";
import { createDatabase } from "@recalino/core/db";
import { createSession } from "@recalino/core/org";
import { sha256Hex } from "@recalino/core/plt";
import { createProcessingRun, failAwaitingUploadRun } from "@recalino/core/proc";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import { acceptSourceNotice, createSource, readInputContract } from "@recalino/core/src";
import { z } from "zod";
import { LOCAL_APP_DATABASE_URL } from "../../../packages/core/test/local-db";
import { pendingCopy } from "../src/ui/pending-copy";
import { signInAsNewLearner } from "./learner";

const unavailable = async () => {
  throw new Error("Upload reliability browser checks never invoke AI or a worker.");
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
/** D65 review screenshots, written only when requested. */
async function capture(page: Page, name: string) {
  if (!process.env.RECALINO_SCREENSHOTS) return;
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.screenshot({
      path: `../../artifacts/verification/feat-upload-reliability/${name}-${width}.png`,
      fullPage: true,
    });
  }
}

async function awaitingRun(page: Page) {
  const { userId } = await signInAsNewLearner(page, { setup: "complete" });
  const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 1 });
  const ctx = { userId, requestId: randomUUID() };
  try {
    const session = await createSession(
      db,
      ctx,
      { title: "Synthetic upload" },
      { key: randomUUID() },
    );
    const contract = await readInputContract(db);
    await acceptSourceNotice(db, ctx, contract.noticeVersion, true);
    const bytes = new Uint8Array([0x49, 0x44, 0x33]);
    await createSource(db, ctx, {
      sessionId: session.id,
      kind: "audio",
      mimeType: "audio/mpeg",
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      displayName: "synthetic-class.mp3",
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
      reason: "Local upload reliability browser check",
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
    return { db, ctx, userId, session, run, contract };
  } catch (error) {
    await db.destroy();
    throw error;
  }
}

test.describe("Workstream 1 upload reliability", () => {
  test("names an upload that never started as lapsed, not rejected audio, and offers Review and retry", async ({
    page,
  }) => {
    const f = await awaitingRun(page);
    try {
      await failAwaitingUploadRun(f.db, f.ctx, f.run.id, "audio_upload_not_started");
    } finally {
      await f.db.destroy();
    }
    await page.goto(`/sessions/${f.session.id}/processing`);
    await expect(page.getByText(pendingCopy.uploadReliability.audio.notStarted)).toBeVisible();
    await expect(page.getByText("The audio could not be verified.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review and retry", exact: true })).toBeVisible();
    await capture(page, "processing-upload-not-started");
  });

  test("shows a closed saved upload without a Retry that cannot succeed", async ({ page }) => {
    const f = await awaitingRun(page);
    await f.db.destroy();
    await page.goto("/sessions");
    await page.evaluate(
      async ({ transfer }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("recalino-manual-audio-v1", 1);
          request.onupgradeneeded = () => {
            request.result
              .createObjectStore("transfers", { keyPath: ["userId", "runId"] })
              .createIndex("owner", "userId");
            request.result.createObjectStore("deletedAccounts", { keyPath: "userId" });
            request.result
              .createObjectStore("settledRuns", { keyPath: ["userId", "runId"] })
              .createIndex("owner", "userId");
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction("transfers", "readwrite");
          tx.objectStore("transfers").put(transfer);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        database.close();
      },
      {
        transfer: {
          userId: f.userId,
          runId: f.run.id,
          sessionId: f.session.id,
          contract: f.contract,
          createdAt: Date.now(),
          phase: "attention",
          message: "Audio upload is saved. You can use other pages while it continues.",
          problem: pendingCopy.uploadReliability.audio.uploadClosed,
          reason: "upload_closed",
        },
      },
    );
    await page.reload();
    const tray = page.getByRole("complementary", { name: "Saved audio uploads" });
    await expect(tray.getByText(pendingCopy.uploadReliability.audio.uploadClosed)).toBeVisible();
    await expect(
      tray.getByRole("link", { name: "View audio upload and processing" }),
    ).toBeVisible();
    await expect(tray.getByRole("button", { name: "Retry saved audio upload" })).toHaveCount(0);
    await capture(page, "audio-tray-upload-closed");
  });
});
