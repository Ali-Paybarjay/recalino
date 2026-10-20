import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

/**
 * Second audit of problem 2: Chromium's real MediaRecorder on the fake microphone, with the page
 * hidden and frozen and the track muted mid-recording. After Stop, each saved part is decoded the
 * way the server does it (ffmpeg, PCM sample count): the declared duration must match what a
 * decoder finds, so the 67% silent loss of 2026-10-12 cannot happen again. Synthetic audio only.
 */
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});
test.beforeEach(async ({ page }) => {
  // Keep a handle on every microphone track so the test can mute it from outside the app.
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
    (window as unknown as { __recalinoTracks: MediaStreamTrack[] }).__recalinoTracks = tracks;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      tracks.push(...stream.getAudioTracks());
      return stream;
    };
  });
});

type SavedPart = {
  id: string;
  segment?: number;
  activeMs: number;
  measuredBy?: string;
  gaps?: { from: string; to: string; missingMs: number; offsetMs: number; cause: string }[];
};
async function savedParts(page: Page): Promise<SavedPart[]> {
  return page.evaluate(
    () =>
      new Promise<SavedPart[]>((resolve, reject) => {
        const request = indexedDB.open("recalino-recordings-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result
            .transaction("recordings", "readonly")
            .objectStore("recordings")
            .getAll();
          read.onsuccess = () => resolve(read.result as SavedPart[]);
          read.onerror = () => reject(read.error);
        };
      }),
  );
}
/** The saved bytes of one part, base64, exactly as the app would upload them. */
async function partBytes(page: Page, recordingId: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    (id) =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("recalino-recordings-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result
            .transaction("chunks", "readonly")
            .objectStore("chunks")
            .getAll();
          read.onsuccess = async () => {
            const chunks = (read.result as { recordingId: string; sequence: number; blob: Blob }[])
              .filter((chunk) => chunk.recordingId === id)
              .sort((a, b) => a.sequence - b.sequence);
            const blob = new Blob(chunks.map((chunk) => chunk.blob));
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (const byte of bytes) binary += String.fromCharCode(byte);
            resolve(btoa(binary));
          };
          read.onerror = () => reject(read.error);
        };
      }),
    recordingId,
  );
  return Buffer.from(base64, "base64");
}
/** The server's measurement (audio-preparer.ts): decoded 16 kHz mono PCM, 32 bytes per ms. */
function decodedMs(bytes: Buffer): number {
  const dir = mkdtempSync(join(tmpdir(), "recalino-decode-"));
  const input = join(dir, "part.webm");
  writeFileSync(input, bytes);
  const pcm = execFileSync(
    ffmpegPath as string,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return Math.ceil(pcm.length / 32);
}

test("declared part durations match the server's decode within 2% after hidden, frozen and muted intervals", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const response = await page.request.post("/dev/auth/session", { data: { setup: "complete" } });
  expect(response.status(), await response.text()).toBe(200);
  await page.goto("/recordings");
  await page.getByRole("button", { name: "Record a session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  // D107: once its session exists, the page becomes the session's recording page (client
  // navigation; the capture goes on).
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/record$/);
  await page.waitForTimeout(4000);

  // 1. Hidden and frozen for a while, as a locked phone does to a page (Page Lifecycle API).
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.waitForTimeout(4000);

  // 2. The microphone track reports muted, then unmuted (as when another app takes the mic).
  // Recovery on the fake device takes milliseconds, so the failure state is caught as it shows.
  await page.evaluate(() => {
    const seen = { alert: false };
    (window as unknown as { __recalinoSeen: typeof seen }).__recalinoSeen = seen;
    new MutationObserver(() => {
      if (/microphone was interrupted|Reconnecting/.test(document.body.textContent ?? ""))
        seen.alert = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    const track = (
      window as unknown as { __recalinoTracks: MediaStreamTrack[] }
    ).__recalinoTracks.at(-1);
    if (!track) throw new Error("no microphone track");
    Object.defineProperty(track, "muted", { configurable: true, get: () => true });
    track.dispatchEvent(new Event("mute"));
  });
  const before = (await savedParts(page)).length;
  // A real capture failure is shown at once (PRD-REC-03), with no pop-up, and a new part begins.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __recalinoSeen: { alert: boolean } }).__recalinoSeen.alert,
        ),
      {
        timeout: 3000,
      },
    )
    .toBe(true);
  await expect
    .poll(async () => (await savedParts(page)).length, { timeout: 10000 })
    .toBeGreaterThan(before - 1);
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "Stop and save", exact: true }).click();
  // D107: Stop ends this recording, not the session; the next one continues it.
  await expect(page.getByRole("button", { name: "Continue recording", exact: true })).toBeVisible();

  const parts = (await savedParts(page)).sort((a, b) => (a.segment ?? 1) - (b.segment ?? 1));
  expect(parts.length).toBeGreaterThanOrEqual(1);
  let declared = 0;
  let decoded = 0;
  for (const part of parts) {
    expect(part.measuredBy).toBe("media");
    const ms = decodedMs(await partBytes(page, part.id));
    // Per part: what the app registers (measured + 1 s margin) covers the decode and is within 2%.
    const registered = Math.round(part.activeMs) + 1000;
    expect(registered).toBeGreaterThanOrEqual(ms);
    expect(Math.abs(part.activeMs - ms)).toBeLessThanOrEqual(Math.max(60, ms * 0.02));
    declared += part.activeMs;
    decoded += ms;
  }
  expect(Math.abs(declared - decoded)).toBeLessThanOrEqual(Math.max(60, decoded * 0.02));
  console.log(
    `recording-decode: ${JSON.stringify({
      parts: parts.map((part) => ({
        segment: part.segment,
        declaredMs: Math.round(part.activeMs),
        gaps: (part.gaps ?? []).map((gap) => ({ missingMs: gap.missingMs, cause: gap.cause })),
      })),
      declaredMs: Math.round(declared),
      decodedMs: decoded,
    })}`,
  );
  // The clock ran about 17 s; anything the recorder did not capture is named, never silent.
  const wall = 17000;
  const missing = parts
    .flatMap((part) => part.gaps ?? [])
    .reduce((sum, gap) => sum + gap.missingMs, 0);
  expect(decoded + missing).toBeGreaterThan(wall * 0.6);
  if (missing > 0)
    await expect(page.getByText(/^Part of this class was not recorded/).first()).toBeVisible();
});
