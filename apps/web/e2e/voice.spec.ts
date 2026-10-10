import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type {
  ClassVoiceView,
  VoiceAnalysisView,
  VoiceProfileView,
} from "@recalino/core/voice-contracts";
import { mockMicrophone } from "./voice-capture";

const output = resolve(import.meta.dirname, "../../../artifacts/verification");
const emptyProfile: VoiceProfileView = {
  enabled: false,
  consentVersion: null,
  enrolled: false,
  sampleDurationMs: null,
  modelVersion: null,
  confirmedLessons: 0,
  engineAvailable: true,
};
function analysis(source = 1): VoiceAnalysisView {
  return {
    id: `10000000-0000-4000-8000-00000000000${source + 2}`,
    sourceId: `20000000-0000-4000-8000-00000000000${source}`,
    version: 1,
    status: "unverified",
    candidateId: "speaker-1",
    verifiedSpeakerId: null,
    verificationMethod: null,
    reason: null,
    candidates: [1, 2, 3].map((speaker) => ({
      id: `speaker-${speaker}`,
      label: `Voice ${speaker}`,
      score: null,
      cleanSpeechMs: 24000,
      clips: [0, 1, 2].map((index) => ({
        startMs: index * 12000,
        endMs: index * 12000 + 8000,
        text: `Source ${source}, voice ${speaker}, excerpt ${index + 1}: I am practising English with my class.`,
      })),
      lines: ["I am practising English with my class."],
    })),
  };
}
const learnerId = "10000000-0000-4000-8000-000000000002";

/**
 * Keeps a silent synthetic original (a test asset, no person recorded) of each listed class
 * source on this device, owned by the given account, then reloads. A voice is confirmed by
 * listening (D55), so confirming needs a playable original. Call it after a source has said its
 * original audio isn't on this device: by then the page has created the device store.
 */
async function keepOriginalsOnDevice(
  page: Page,
  owners: Record<number, string> = { 1: learnerId, 2: learnerId },
) {
  await page.evaluate(async (entries) => {
    const request = indexedDB.open("recalino-recordings-v1", 3);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sampleRate = 8000,
      bytes = sampleRate * 40 * 2,
      data = new ArrayBuffer(44 + bytes),
      header = new DataView(data);
    function ascii(offset: number, value: string) {
      for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
    }
    ascii(0, "RIFF");
    header.setUint32(4, 36 + bytes, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, 1, true);
    header.setUint32(24, sampleRate, true);
    header.setUint32(28, sampleRate * 2, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    ascii(36, "data");
    header.setUint32(40, bytes, true);
    const blob = new Blob([data], { type: "audio/wav" });
    const transaction = db.transaction(["recordings", "chunks"], "readwrite");
    for (const [source, userId] of entries) {
      const id = `30000000-0000-4000-8000-00000000000${source}`;
      transaction.objectStore("recordings").put({
        id,
        userId,
        sourceAssetId: `20000000-0000-4000-8000-00000000000${source}`,
        sessionId: null,
        mimeType: "audio/wav",
        status: "saved",
        createdAt: "2026-10-06T12:00:00.000Z",
        updatedAt: "2026-10-06T12:00:00.000Z",
        activeMs: 40000,
        chunks: 1,
        bytes: blob.size,
        creationKey: id,
      });
      transaction.objectStore("chunks").put({ userId, recordingId: id, sequence: 0, blob });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, Object.entries(owners));
  await page.reload();
}
test("voice consent gates microphone; sample auto-stops and retries the same explicit save", async ({
  page,
}) => {
  await mockMicrophone(page);
  let profile = { ...emptyProfile };
  const writes: { body: unknown; key: string | undefined }[] = [];
  let deleted = false;
  let reads = 0;
  let releaseSave: (() => void) | undefined;
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/api/me/voice", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      reads++;
      if (profile.enrolled)
        return route.fulfill({
          status: 503,
          json: {
            error: { code: "unavailable", message: "Voice settings could not be refreshed." },
          },
        });
    }
    if (request.method() === "PUT") {
      writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      if (writes.length === 1) {
        await saving;
        return route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Please retry the saved sample." } },
        });
      }
      profile = {
        ...profile,
        enabled: true,
        consentVersion: "voice-v1",
        enrolled: true,
        sampleDurationMs: 30000,
      };
    }
    if (request.method() === "DELETE") {
      deleted = true;
      profile = { ...emptyProfile };
    }
    await route.fulfill({ json: profile });
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/dev/ui/voice");
  const record = page.getByRole("button", { name: "Record voice sample", exact: true });
  await expect(record).toBeDisabled();
  const stats = () =>
    page.evaluate(
      () =>
        (window as Window & { voiceCaptureStats?: { requests: number; stopped: number } })
          .voiceCaptureStats,
    );
  expect((await stats())?.requests).toBe(0);
  await page.getByRole("checkbox").check();
  expect((await stats())?.requests).toBe(0);
  await page.clock.install();
  await record.click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop sample", exact: true })).toBeVisible();
  await page.clock.fastForward(30_100);
  await expect(page.getByLabel("Your voice sample preview")).toBeVisible();
  expect(await stats()).toEqual({ requests: 1, stopped: 1 });
  const readsBeforeSave = reads;
  expect(readsBeforeSave).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Save voice sample", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Processing your voice…$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Processing your voice…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Record again", exact: true })).toBeDisabled();
  await expect(
    page.getByText("Your voice has been processed successfully.", { exact: true }),
  ).toHaveCount(0);
  releaseSave?.();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Voice processing could not be completed. Try saving again, or record another voice sample.",
  );
  await expect(page.getByLabel("Your voice sample preview")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /^Processing your voice…$/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save voice sample", exact: true }).click();
  await expect(
    page.getByText("Your voice has been processed successfully.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Voice confirmation is on · Voice sample saved/)).toBeVisible();
  await expect(page.getByLabel("Your voice sample preview")).toHaveCount(0);
  expect(reads).toBe(readsBeforeSave);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]?.body).toMatchObject({
    consent: true,
    consentVersion: "voice-v1",
    mimeType: "audio/webm",
  });
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
  await mkdir(output, { recursive: true });
  await page.getByRole("heading", { name: "Your voice · Optional" }).scrollIntoViewIfNeeded();
  await page.locator("main").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: resolve(output, "voice-profile-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Turn off and delete voice data" }).click();
  await page.getByRole("button", { name: "Delete voice data", exact: true }).click();
  await expect(page.getByText(/Voice confirmation is off/)).toBeVisible();
  expect(deleted).toBe(true);
});

test("an unusable voice sample asks for a new recording and gives that save a fresh key", async ({
  page,
}) => {
  await mockMicrophone(page);
  let profile = { ...emptyProfile, version: 0 };
  const writes: { body: unknown; key: string | undefined }[] = [];
  await page.route("**/api/me/voice", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      if (writes.length === 1) {
        profile = { ...profile, version: 1, enabled: true, consentVersion: "voice-v1" };
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code: "validation_failed",
              message: "A clear recording with one speaker is required.",
              details: { fields: { audio: ["one_clear_voice_required"] } },
            },
          },
        });
      }
      return route.fulfill({
        json: {
          ...profile,
          version: 2,
          enabled: true,
          consentVersion: "voice-v1",
          enrolled: true,
          sampleDurationMs: 30000,
        },
      });
    }
    await route.fulfill({ json: profile });
  });
  await page.goto("/dev/ui/voice");
  await page.getByRole("checkbox").check();
  await page.clock.install();
  await page.getByRole("button", { name: "Record voice sample", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop sample", exact: true })).toBeVisible();
  await page.clock.fastForward(30_100);
  await expect(page.getByLabel("Your voice sample preview")).toBeVisible();
  await page.getByRole("button", { name: "Save voice sample", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Your voice could not be processed. Please record another voice sample and try again.",
  );
  await expect(page.getByLabel("Your voice sample preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save voice sample", exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Your voice has been processed successfully.", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Record again", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop sample", exact: true })).toBeVisible();
  await page.clock.fastForward(30_100);
  await page.getByRole("button", { name: "Save voice sample", exact: true }).click();
  await expect(
    page.getByText("Your voice has been processed successfully.", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]?.key).toBeTruthy();
  expect(writes[1]?.key).toBeTruthy();
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
  expect(writes[0]?.body).toMatchObject({ expectedVersion: 0 });
  expect(writes[1]?.body).toMatchObject({ expectedVersion: 1 });
});

test("replacing a sample after a transient failure uses current voice settings and a fresh key", async ({
  page,
}) => {
  await mockMicrophone(page);
  let profile = { ...emptyProfile, version: 0 };
  const writes: { body: unknown; key: string | undefined }[] = [];
  await page.route("**/api/me/voice", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      if (writes.length === 1) {
        profile = { ...profile, version: 1, enabled: true, consentVersion: "voice-v1" };
        return route.fulfill({
          status: 503,
          json: {
            error: { code: "unavailable", message: "The voice processor needs another try." },
          },
        });
      }
      profile = { ...profile, version: 2, enrolled: true, sampleDurationMs: 30000 };
    }
    await route.fulfill({ json: profile });
  });
  await page.goto("/dev/ui/voice");
  await page.getByRole("checkbox").check();
  await page.clock.install();
  await page.getByRole("button", { name: "Record voice sample", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop sample", exact: true })).toBeVisible();
  await page.clock.fastForward(30_100);
  await page.getByRole("button", { name: "Save voice sample", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Voice processing could not be completed. Try saving again, or record another voice sample.",
  );
  await expect(page.getByLabel("Your voice sample preview")).toBeVisible();
  await page.getByRole("button", { name: "Record again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop sample", exact: true })).toBeVisible();
  await page.clock.fastForward(30_100);
  await page.getByRole("button", { name: "Save voice sample", exact: true }).click();
  await expect(
    page.getByText("Your voice has been processed successfully.", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]?.key).toBeTruthy();
  expect(writes[1]?.key).toBeTruthy();
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
  expect(writes[0]?.body).toMatchObject({ expectedVersion: 0 });
  expect(writes[1]?.body).toMatchObject({ expectedVersion: 1 });
});

test("a save response without a processed sample cannot show a success message", async ({
  page,
}) => {
  await mockMicrophone(page);
  await page.route("**/api/me/voice", (route) =>
    route.fulfill({
      json:
        route.request().method() === "PUT"
          ? { ...emptyProfile, enabled: true, consentVersion: "voice-v1" }
          : emptyProfile,
    }),
  );
  await page.goto("/dev/ui/voice");
  await page.getByRole("checkbox").check();
  await page.clock.install();
  await page.getByRole("button", { name: "Record voice sample", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop sample", exact: true })).toBeVisible();
  await page.clock.fastForward(30_100);
  await page.getByRole("button", { name: "Save voice sample", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Voice processing could not be completed. Try saving again, or record another voice sample.",
  );
  await expect(
    page.getByText("Your voice has been processed successfully.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Your voice sample preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save voice sample", exact: true })).toBeEnabled();
});

test("class confirmation is per source, retries safely, and offers correction and none", async ({
  page,
}) => {
  const view: ClassVoiceView = {
    enabled: true,
    engineAvailable: true,
    analyses: [analysis(1), analysis(2)],
  };
  const writes: { body: Record<string, unknown>; key: string | undefined }[] = [];
  await page.route("**/api/classes/*/voice", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ body, key: request.headers()["idempotency-key"] });
      if (writes.length === 1)
        return route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Your voice choice needs another try." } },
        });
      const current = view.analyses.find((item) => item.id === body.analysisId);
      if (current) {
        current.version++;
        if (body.action === "confirm") {
          current.status = "verified";
          current.verifiedSpeakerId = String(body.speakerId);
          current.verificationMethod = "manual";
        }
        if (body.action === "reject" || body.action === "revoke") {
          current.status = "unverified";
          current.candidates = current.candidates.filter(
            (item) => item.id !== (body.speakerId ?? current.verifiedSpeakerId),
          );
          current.verifiedSpeakerId = null;
          current.candidateId = current.candidates[0]?.id ?? null;
        }
        if (body.action === "none") {
          current.status = "none";
          current.verifiedSpeakerId = null;
        }
      }
    }
    await route.fulfill({ json: view });
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/dev/ui/voice?view=class");
  let source = page.getByRole("region", { name: "Source 1 voice confirmation" });
  // D55: nothing is offered for confirmation before the excerpts can play here.
  await expect(source.getByText("The original audio isn't on this device.")).toBeVisible();
  await expect(source.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(0);
  await keepOriginalsOnDevice(page);
  await expect(source.getByRole("listitem")).toHaveCount(3);
  await source.getByRole("button", { name: "Yes, this is my voice" }).click();
  await expect(page.getByRole("button", { name: "Retry voice choice" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toHaveCount(0);
  await expect(source.getByRole("button", { name: "None of these voices is mine" })).toBeDisabled();
  await page.getByRole("button", { name: "Retry voice choice" }).click();
  await expect(source.getByRole("button", { name: "This is not my voice" })).toBeVisible();
  expect(writes[0]).toEqual(writes[1]);
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Source 2 voice confirmation" })
      .getByRole("button", { name: "Yes, this is my voice" }),
  ).toBeVisible();
  await source.getByRole("button", { name: "This is not my voice" }).click();
  await expect(source.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(2);
  await expect(source.getByRole("listitem")).toHaveCount(2);
  await expect(source.getByText("Voice 1", { exact: true })).toHaveCount(0);
  await expect(source.getByRole("button", { name: "Yes, this is my voice" }).first()).toBeEnabled();
  await mkdir(output, { recursive: true });
  await page.locator("main").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: resolve(output, "voice-confirmation-mobile.png"), fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: resolve(output, "voice-confirmation-dark.png"), fullPage: true });
  await source.getByRole("button", { name: "None of these voices is mine" }).click();
  await expect(source.getByText(/None of these speakers was selected/)).toBeVisible();
  source = page.getByRole("region", { name: "Source 2 voice confirmation" });
  await source.getByRole("button", { name: "No, show other speakers" }).click();
  await expect(source.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(2);
});

test("class voices explain missing transcripts before a check can be submitted", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") writes++;
    return route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        analyses: [],
        analysisBlockedReason: "transcript_required",
      } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await expect(
    page.getByRole("button", { name: "Check session voices", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Select a session recording in Sources and process it/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open session sources" })).toHaveAttribute(
    "href",
    "/sessions/10000000-0000-4000-8000-000000000001/sources",
  );
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  expect(writes).toBe(0);
});

test("a completed voice check leads to an explicit speaker choice and the refreshed class notes", async ({
  page,
}) => {
  let checked = false;
  let poll = 0;
  const result = analysis(1);
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (body.action === "analyze") checked = true;
      if (body.action === "confirm") {
        result.status = "verified";
        result.version++;
        result.verifiedSpeakerId = String(body.speakerId);
        result.verificationMethod = "manual";
      }
      return route.fulfill({ status: body.action === "analyze" ? 202 : 200, json: {} });
    }
    const processing = checked && poll++ === 0;
    return route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        processing,
        analyses: checked && !processing ? [result] : [],
      } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await page.getByRole("button", { name: "Check session voices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Checking session voices…" })).toBeDisabled();
  // D55: until the excerpts can play here, the summary names that step instead of a choice.
  await expect(
    page.getByText(/Voice check finished. To confirm your voice, its excerpts must first play/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Read session notes", exact: true })).toBeVisible();
  await expect(page.getByText("The original audio isn't on this device.")).toBeVisible();
  await keepOriginalsOnDevice(page, { 1: learnerId });
  await expect(
    page.getByText(/Voice check finished. Next, confirm which speaker is you/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Yes, this is my voice", exact: true }).click();
  await expect(page.getByText("Voice verified", { exact: true })).toBeVisible();
  await expect(page.getByText(/Your voice choices are saved/)).toBeVisible();
  const continuation = page.getByRole("link", { name: "Read session notes", exact: true });
  await expect(continuation).toHaveAttribute("href", "#class-notes");
  await continuation.click();
  await expect(page).toHaveURL(/#class-notes$/);
  await expect(
    page.locator("#class-notes").getByRole("region", { name: "Synthetic session notes" }),
  ).toBeVisible();
  expect(writes).toEqual([
    { action: "analyze" },
    { action: "confirm", analysisId: result.id, expectedVersion: 1, speakerId: "speaker-1" },
  ]);
});

test("a check without usable excerpts reports its outcome and offers source material or class notes", async ({
  page,
}) => {
  let checked = false;
  let poll = 0;
  const result: VoiceAnalysisView = {
    ...analysis(1),
    status: "unavailable",
    candidateId: null,
    candidates: [],
    reason: "voice_engine_or_audio_unavailable",
  };
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") {
      checked = true;
      return route.fulfill({ status: 202, json: {} });
    }
    const processing = checked && poll++ === 0;
    return route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        processing,
        analyses: checked && !processing ? [result] : [],
      } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await page.getByRole("button", { name: "Check session voices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Checking session voices…" })).toBeDisabled();
  const source = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(source.getByText("No usable excerpts", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs confirmation", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/Voice check finished, but some recordings have no usable speaker excerpts/),
  ).toBeVisible();
  await expect(source.getByRole("link", { name: "Check source material" })).toHaveAttribute(
    "href",
    "/sessions/10000000-0000-4000-8000-000000000001/sources",
  );
  await expect(page.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Read session notes", exact: true })).toBeVisible();
});

test("a failed class voice check offers a working retry instead of asking for confirmation", async ({
  page,
}) => {
  let result: VoiceAnalysisView = { ...analysis(1), status: "failed", candidates: [] };
  const writes: { body: unknown; key: string | undefined }[] = [];
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") {
      writes.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()["idempotency-key"],
      });
      result = analysis(1);
    }
    return route.fulfill({
      json: { enabled: true, engineAvailable: true, analyses: [result] } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  const source = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(source.getByText("Voice check failed", { exact: true })).toBeVisible();
  await expect(source.getByText("Needs confirmation", { exact: true })).toHaveCount(0);
  await source.getByRole("button", { name: "Retry session voice check", exact: true }).click();
  // The new check prepared excerpts; they are confirmed by listening once the original is here.
  await expect(source.getByText("Needs confirmation", { exact: true })).toBeVisible();
  await expect(source.getByText("The original audio isn't on this device.")).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toEqual({ action: "analyze" });
  expect(writes[0]?.key).toBeTruthy();
});

test("speaker labels without any excerpts offer recovery instead of asking for a blind confirmation", async ({
  page,
}) => {
  const result = analysis(1);
  result.candidates = result.candidates.map((candidate) => ({
    ...candidate,
    clips: [],
    lines: [],
  }));
  await page.route("**/api/classes/*/voice", (route) =>
    route.fulfill({
      json: { enabled: true, engineAvailable: true, analyses: [result] } satisfies ClassVoiceView,
    }),
  );
  await page.goto("/dev/ui/voice?view=class");
  const source = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(source.getByText("No usable excerpts", { exact: true })).toBeVisible();
  await expect(source.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(0);
  await expect(source.getByRole("button", { name: "None of these voices is mine" })).toHaveCount(0);
  await expect(source.getByRole("link", { name: "Check source material" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read session notes", exact: true })).toBeVisible();
});

test("a saved personal sample does not hide the missing class recording or permit a no-op check", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") writes++;
    return route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        analyses: [],
        analysisBlockedReason: "original_audio_required",
      } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await expect(
    page.getByRole("button", { name: "Check session voices", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      /Checking session voices needs the original session recording, even if you have saved a personal voice sample/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open session sources" })).toHaveAttribute(
    "href",
    "/sessions/10000000-0000-4000-8000-000000000001/sources",
  );
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  expect(writes).toBe(0);
});

test("sampled voice checks disclose their coverage before and after speaker confirmation", async ({
  page,
}) => {
  const result = { ...analysis(1), reason: "sampled_audio" };
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") {
      result.status = "verified";
      result.verifiedSpeakerId = "speaker-1";
      result.verificationMethod = "manual";
      result.version++;
    }
    return route.fulfill({
      json: { enabled: true, engineAvailable: true, analyses: [result] } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await expect(page.getByText(/excerpts sampled across your selected class audio/)).toBeVisible();
  await expect(page.getByText("The original audio isn't on this device.")).toBeVisible();
  await keepOriginalsOnDevice(page, { 1: learnerId });
  await page.getByRole("button", { name: "Yes, this is my voice", exact: true }).click();
  await expect(page.getByText("Voice verified", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Only speech in those checked excerpts can contribute spoken mistakes/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Read session notes", exact: true })).toBeVisible();
});

test("a rejected voice check keeps notes visible and permits a fresh request after recovery", async ({
  page,
}) => {
  const writes: { key: string | undefined; body: unknown }[] = [];
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") {
      writes.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postDataJSON(),
      });
      if (writes.length === 1)
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: "validation_failed",
              message: "Some information is missing or not valid.",
              details: { fields: { voice: ["transcript_required"] } },
            },
          },
        });
    }
    return route.fulfill({
      json: { enabled: true, engineAvailable: true, analyses: [] } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await page.getByRole("button", { name: "Check session voices", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Select a session recording in Sources and process it before checking session voices.",
  );
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Retry voice/ })).toHaveCount(0);
  await expect(page.getByText(/Your last choice still needs to be confirmed/)).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh voice status" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Check session voices", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]?.body).toEqual({ action: "analyze" });
  expect(writes[1]?.key).toBeTruthy();
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
});

test("an uncertain voice check retries the same request with voice-check copy", async ({
  page,
}) => {
  const writes: { key: string | undefined; body: unknown }[] = [];
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") {
      writes.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postDataJSON(),
      });
      if (writes.length === 1)
        return route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "The voice check needs another try." } },
        });
    }
    return route.fulfill({
      json: { enabled: true, engineAvailable: true, analyses: [] } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await page.getByRole("button", { name: "Check session voices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry voice check", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry voice choice", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Retry voice check", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test("an accepted voice check with a failed status read stays pending until reconciled", async ({
  page,
}) => {
  const keys: (string | undefined)[] = [];
  let reads = 0;
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") {
      keys.push(route.request().headers()["idempotency-key"]);
      return route.fulfill({ status: 202, json: {} });
    }
    reads++;
    if (reads === 2)
      return route.fulfill({
        status: 400,
        json: {
          error: { code: "validation_failed", message: "Voice status could not be loaded." },
        },
      });
    return route.fulfill({
      json: { enabled: true, engineAvailable: true, analyses: [] } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await page.getByRole("button", { name: "Check session voices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry voice check", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry voice check", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

test("a rejected retry cannot release notes while an earlier voice check remains uncertain", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/api/classes/*/voice", (route) => {
    if (route.request().method() === "POST") {
      writes++;
      if (writes <= 2)
        return route.fulfill({
          status: writes === 1 ? 503 : 400,
          json: {
            error: { code: writes === 1 ? "unavailable" : "validation_failed", message: "Retry." },
          },
        });
    } else if (writes === 2) {
      return route.fulfill({
        status: 503,
        json: { error: { code: "unavailable", message: "Voice status is unavailable." } },
      });
    }
    return route.fulfill({
      json: { enabled: true, engineAvailable: true, analyses: [] } satisfies ClassVoiceView,
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await page.getByRole("button", { name: "Check session voices", exact: true }).click();
  await page.getByRole("button", { name: "Retry voice check", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry voice check", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry voice check", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  expect(writes).toBe(3);
});

test("unavailable engine supports consent without a sample and active class capture blocks microphone", async ({
  page,
}) => {
  let profile = { ...emptyProfile, engineAvailable: false };
  const requests: unknown[] = [];
  await page.route("**/api/me/voice", async (route) => {
    if (route.request().method() === "PUT") {
      requests.push(route.request().postDataJSON());
      profile = { ...profile, enabled: true, consentVersion: "voice-v1" };
    }
    await route.fulfill({ json: profile });
  });
  await page.goto("/dev/ui/voice");
  await expect(page.getByText(/Audio voice matching is not available yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record voice sample" })).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enable without a sample" }).click();
  await expect(page.getByText(/Voice confirmation is enabled/)).toBeVisible();
  expect(requests).toEqual([{ consent: true, consentVersion: "voice-v1" }]);
  profile = { ...emptyProfile };
  await page.goto("/dev/ui/voice?blocked=1");
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Record voice sample" })).toBeDisabled();
});

test("original audio stays account scoped and clip playback seeks and stops at its bounds", async ({
  page,
}) => {
  const view: ClassVoiceView = {
    enabled: true,
    engineAvailable: true,
    analyses: [analysis(1), analysis(2)],
  };
  await page.route("**/api/classes/*/voice", (route) => route.fulfill({ json: view }));
  await page.goto("/dev/ui/voice?view=class");
  await expect(
    page
      .getByRole("region", { name: "Source 1 voice confirmation" })
      .getByText("The original audio isn't on this device."),
  ).toBeVisible();
  // Source 2's original belongs to another account on this device and must not play here.
  await keepOriginalsOnDevice(page, { 1: learnerId, 2: "90000000-0000-4000-8000-000000000009" });
  const first = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(first.getByRole("button", { name: "Play Voice 1 excerpt 2" })).toBeVisible();
  const second = page.getByRole("region", { name: "Source 2 voice confirmation" });
  await expect(second.getByText("The original audio isn't on this device.")).toBeVisible();
  await expect(second.getByRole("button", { name: /^Play/ })).toHaveCount(0);
  const audio = first.locator("audio");
  await expect(audio).toHaveJSProperty("paused", true);
  await first.getByRole("button", { name: "Play Voice 1 excerpt 2" }).click();
  await expect(first.getByRole("button", { name: "Pause Voice 1 excerpt 2" })).toBeVisible();
  expect(
    await audio.evaluate((element) => (element as HTMLAudioElement).currentTime),
  ).toBeGreaterThanOrEqual(12);
  await audio.evaluate((element) => {
    (element as HTMLAudioElement).currentTime = 19.95;
  });
  await expect(audio).toHaveJSProperty("paused", true);
  await first.getByRole("button", { name: "Play Voice 1 excerpt 1" }).click();
  expect(await audio.evaluate((element) => (element as HTMLAudioElement).currentTime)).toBeLessThan(
    1,
  );
  await page.goto("/dev/ui/voice");
});

test("a queued voice job polls before any analysis exists and an old consent retry requires a fresh choice", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/classes/*/voice", (route) => {
    reads++;
    return route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        processing: reads < 2,
        analyses: reads < 2 ? [] : [analysis(1)],
      },
    });
  });
  await page.goto("/dev/ui/voice?view=class");
  await expect(page.getByRole("button", { name: "Checking session voices…" })).toBeDisabled();
  await expect(page.getByText("Needs confirmation", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic session notes" })).toBeVisible();
  const saves: { body: Record<string, unknown>; key: string | undefined }[] = [];
  let version = 0;
  await page.route("**/api/me/voice", async (route) => {
    if (route.request().method() === "PUT") {
      saves.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()["idempotency-key"],
      });
      if (saves.length === 1) {
        version = 2;
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code: "validation_failed",
              message: "Voice consent changed.",
              details: { fields: { voice: ["enrollment_revoked"] } },
            },
          },
        });
      }
    }
    await route.fulfill({
      json: {
        ...emptyProfile,
        version,
        enabled: saves.length > 1,
        consentVersion: saves.length > 1 ? "voice-v1" : null,
      },
    });
  });
  await page.goto("/dev/ui/voice");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enable without a sample" }).click();
  await expect(page.getByText(/Your voice settings changed/)).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Enable without a sample" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enable without a sample" }).click();
  await expect(page.getByText(/Voice confirmation is enabled/)).toBeVisible();
  expect(saves[0]?.body.expectedVersion).toBe(0);
  expect(saves[1]?.body.expectedVersion).toBe(2);
  expect(saves[0]?.key).not.toBe(saves[1]?.key);
});

/** A silent synthetic WAV (test asset, no person recorded) and its registered identity. */
function syntheticOriginal(seconds: number, fill = 0) {
  const sampleRate = 8000,
    bytes = sampleRate * seconds * 2,
    buffer = Buffer.alloc(44 + bytes, fill);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(bytes, 40);
  return buffer;
}

test("VOICE-AC-08: a missing original is re-attached on this device, plays at once, and a different file changes nothing", async ({
  page,
}) => {
  const original = syntheticOriginal(40);
  // Same size, different bytes: only the checksum can tell it apart.
  const imposter = Buffer.from(original);
  imposter.fill(1, 44);
  const { createHash } = await import("node:crypto");
  const source = {
    name: "Tuesday class.wav",
    durationMs: 40000,
    sizeBytes: original.length,
    sha256: createHash("sha256").update(original).digest("hex"),
    mimeType: "audio/wav",
  };
  const view: ClassVoiceView = {
    enabled: true,
    engineAvailable: true,
    analyses: [{ ...analysis(1), source }],
  };
  const forbidden: string[] = [];
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (/\/api\/classes\/[^/]+\/voice$/.test(url)) return route.fulfill({ json: view });
    // Re-attaching is local: no source, recording, upload or learning request may be sent.
    forbidden.push(`${route.request().method()} ${new URL(url).pathname}`);
    return route.fulfill({ status: 500, json: {} });
  });
  await page.goto("/dev/ui/voice?view=class");
  const region = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(region.getByRole("heading", { name: "Tuesday class.wav" })).toBeVisible();
  await expect(region.getByText("Session source 1 · 0:40")).toBeVisible();
  await expect(region.getByText("The original audio isn't on this device.")).toBeVisible();
  await expect(region.getByText(/Listen to the excerpts/)).toHaveCount(0);
  await expect(region.getByRole("button", { name: /^Play/ })).toHaveCount(0);
  const picker = region.locator('input[type="file"][aria-label="Select original recording"]');
  await picker.setInputFiles({
    name: "Tuesday class.wav",
    mimeType: "audio/wav",
    buffer: imposter,
  });
  await expect(
    region.getByText(
      "This file is not the original recording of this session source, so nothing was changed.",
    ),
  ).toBeVisible();
  await expect(region.getByRole("button", { name: /^Play/ })).toHaveCount(0);
  // The check swapped the Select button for Cancel and back; keyboard focus followed it.
  await expect(region.getByRole("button", { name: "Select original recording" })).toBeFocused();
  await picker.setInputFiles({ name: "renamed copy.wav", mimeType: "audio/wav", buffer: original });
  await expect(
    region.getByText(
      "The original recording is back on this device. You can play the excerpts now.",
    ),
  ).toBeVisible();
  await expect(
    region.getByText("Listen to the excerpts, then confirm which voice is yours."),
  ).toBeVisible();
  const play = region.getByRole("button", { name: "Play Voice 1 excerpt 2" });
  await expect(play).toBeVisible();
  await play.click();
  await expect(region.getByRole("button", { name: "Pause Voice 1 excerpt 2" })).toBeVisible();
  expect(
    await region.locator("audio").evaluate((element) => (element as HTMLAudioElement).currentTime),
  ).toBeGreaterThanOrEqual(12);
  const rows = await page.evaluate(async () => {
    const request = indexedDB.open("recalino-recordings-v1", 3);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const read = db.transaction("recordings").objectStore("recordings").getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    db.close();
    return all;
  });
  expect(rows).toEqual([
    expect.objectContaining({
      userId: "10000000-0000-4000-8000-000000000002",
      sourceAssetId: "20000000-0000-4000-8000-000000000001",
      sessionId: null,
      bytes: original.length,
      chunks: 1,
    }),
  ]);
  expect(rows[0]).not.toHaveProperty("autoRegister");
  // The original stays playable after a reload, from this device only.
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Source 1 voice confirmation" })
      .getByRole("button", { name: "Play Voice 1 excerpt 1" }),
  ).toBeVisible();
  expect(forbidden).toEqual([]);
});

test("VOICE-AC-08: waiting for the class lock can be cancelled and changes nothing", async ({
  page,
}) => {
  const original = syntheticOriginal(40);
  const { createHash } = await import("node:crypto");
  const source = {
    name: "Tuesday class.wav",
    durationMs: 40000,
    sizeBytes: original.length,
    sha256: createHash("sha256").update(original).digest("hex"),
    mimeType: "audio/wav",
  };
  await page.route("**/api/classes/*/voice", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        analyses: [{ ...analysis(1), source }],
      } satisfies ClassVoiceView,
    }),
  );
  await page.goto("/dev/ui/voice?view=class");
  // A transfer in this session holds the learning lock and does not let go.
  await page.evaluate(() => {
    void navigator.locks.request(
      "recalino-learning:10000000-0000-4000-8000-000000000002:10000000-0000-4000-8000-000000000001",
      () => new Promise(() => {}),
    );
  });
  const region = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await region
    .locator('input[type="file"][aria-label="Select original recording"]')
    .setInputFiles({ name: "Tuesday class.wav", mimeType: "audio/wav", buffer: original });
  const cancel = region.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(region.getByText("Checking was cancelled. Nothing was changed.")).toBeVisible();
  await expect(region.getByRole("button", { name: "Select original recording" })).toBeFocused();
  await expect(region.getByRole("button", { name: /^Play/ })).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const request = indexedDB.open("recalino-recordings-v1", 3);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const count = await new Promise<number>((resolve, reject) => {
        const read = db.transaction("recordings").objectStore("recordings").count();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      db.close();
      return count;
    }),
  ).toBe(0);
});

test("VOICE-AC-07/D55: speakers with only saved lines are not offered for a blind confirmation", async ({
  page,
}) => {
  const textOnly = analysis(1);
  textOnly.candidates = textOnly.candidates.map((candidate) => ({ ...candidate, clips: [] }));
  await page.route("**/api/classes/*/voice", (route) =>
    route.fulfill({
      json: { enabled: true, engineAvailable: true, analyses: [textOnly] } satisfies ClassVoiceView,
    }),
  );
  await page.goto("/dev/ui/voice?view=class");
  const region = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(region.getByText("No usable excerpts", { exact: true })).toBeVisible();
  await expect(
    region.getByText(/This source does not have usable speaker excerpts to confirm/),
  ).toBeVisible();
  await expect(region.getByRole("link", { name: "Check source material" })).toBeVisible();
  await expect(region.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "None of these voices is mine" })).toHaveCount(0);
  await expect(region.getByRole("button", { name: /^Play/ })).toHaveCount(0);
});

test("VOICE-AC-07: listening-only excerpts still show the voice's saved lines", async ({
  page,
}) => {
  const listening = analysis(1);
  listening.candidates = listening.candidates.map((candidate) => ({
    ...candidate,
    clips: candidate.clips.map((clip) => ({ ...clip, text: "" })),
  }));
  const line = listening.candidates[0]?.lines[0];
  if (!line) throw new Error("fixture candidate has no saved line");
  await page.route("**/api/classes/*/voice", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        analyses: [listening],
      } satisfies ClassVoiceView,
    }),
  );
  await page.goto("/dev/ui/voice?view=class");
  const region = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(region.getByText("The original audio isn't on this device.")).toBeVisible();
  await keepOriginalsOnDevice(page, { 1: learnerId });
  await expect(region.getByText(/^Excerpt 1 ·/).first()).toBeVisible();
  await expect(region.getByText(line, { exact: true }).first()).toBeVisible();
  await expect(region.getByRole("button", { name: "Play Voice 1 excerpt 1" })).toBeVisible();
});

test("D55: a source whose excerpts cannot play here warns, names the next step and asks nothing", async ({
  page,
}) => {
  const original = syntheticOriginal(40);
  const { createHash } = await import("node:crypto");
  const restorable: VoiceAnalysisView = {
    ...analysis(1),
    source: {
      name: "Tuesday class.wav",
      durationMs: 40000,
      sizeBytes: original.length,
      sha256: createHash("sha256").update(original).digest("hex"),
      mimeType: "audio/wav",
    },
  };
  await page.route("**/api/classes/*/voice", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        analyses: [restorable, analysis(2)],
      } satisfies ClassVoiceView,
    }),
  );
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/dev/ui/voice?view=class");
  const listenFirst =
    "You confirm your voice by listening to these excerpts. Until they can play here, spoken mistakes from this source are withheld; your session notes stay available.";
  await expect(
    page.getByText(
      "Voice check finished. To confirm your voice, its excerpts must first play on this device; the next step is shown below. Your session notes stay available.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/Next, confirm which speaker is you/)).toHaveCount(0);
  const first = page.getByRole("region", { name: "Source 1 voice confirmation" });
  // The excerpts the warning refers to stay readable, with nothing to play or choose.
  await expect(first.getByText(/^Excerpt 1 ·/).first()).toBeVisible();
  await expect(first.getByText(/Source 1, voice 1, excerpt 1/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Play/ })).toHaveCount(0);
  const warning = first
    .getByRole("status")
    .filter({ hasText: "The original audio isn't on this device." });
  await expect(warning).toContainText("To play these excerpts here, select the original recording");
  await expect(warning).toContainText(listenFirst);
  // The warning tint of the design tokens, not the neutral status surface.
  await expect(warning).toHaveCSS("background-color", "rgb(251, 240, 214)");
  // The next step is the primary action inside the warning.
  await expect(warning.getByRole("button", { name: "Select original recording" })).toHaveClass(
    /btn-primary/,
  );
  // A source without a checksum cannot be restored; it says so and still asks nothing.
  const second = page.getByRole("region", { name: "Source 2 voice confirmation" });
  await expect(second.getByText(/its original cannot be restored here/)).toBeVisible();
  await expect(second.getByText(listenFirst)).toBeVisible();
  await expect(second.getByRole("button", { name: "Select original recording" })).toHaveCount(0);
  for (const name of [
    "Yes, this is my voice",
    "No, show other speakers",
    "None of these voices is mine",
  ])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Read session notes", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await mkdir(output, { recursive: true });
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "voice-confirmation-blocked-mobile.png") });
  // Once the original is back on this device, the excerpts play and the choice is offered.
  await first
    .locator('input[type="file"][aria-label="Select original recording"]')
    .setInputFiles({ name: "Tuesday class.wav", mimeType: "audio/wav", buffer: original });
  await expect(first.getByRole("button", { name: "Play Voice 1 excerpt 1" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Yes, this is my voice" })).toBeEnabled();
  await expect(second.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(0);
  // One source can now be confirmed, so the summary asks for that choice again.
  await expect(
    page.getByText(/Voice check finished. Next, confirm which speaker is you/),
  ).toBeVisible();
});

test("VOICE-AC-03/05: the class says why it asks and what a confirmation taught", async ({
  page,
}) => {
  const asking = { ...analysis(1), matchReason: "similar_voices" as const };
  const confirmed: VoiceAnalysisView = {
    ...analysis(2),
    status: "verified",
    verifiedSpeakerId: "speaker-1",
    verificationMethod: "manual",
    referenceStatus: "mismatch",
  };
  await page.route("**/api/classes/*/voice", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        engineAvailable: true,
        analyses: [asking, confirmed],
      } satisfies ClassVoiceView,
    }),
  );
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/dev/ui/voice?view=class");
  await expect(
    page
      .getByRole("region", { name: "Source 1 voice confirmation" })
      .getByText(/more than one voice in this recording sounds similar to yours/),
  ).toBeVisible();
  const second = page.getByRole("region", { name: "Source 2 voice confirmation" });
  await expect(second.getByText(/does not sound like your saved voice sample/)).toBeVisible();
  await expect(second.getByRole("button", { name: "This is not my voice" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
