import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
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
  await expect(source.getByText(/Original audio is not on this device/)).toBeVisible();
  await expect(source.getByRole("listitem")).toHaveCount(3);
  await source.getByRole("button", { name: "Yes, this is my voice" }).click();
  await expect(page.getByRole("button", { name: "Retry voice choice" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toHaveCount(0);
  await expect(source.getByRole("button", { name: "None of these voices is mine" })).toBeDisabled();
  await page.getByRole("button", { name: "Retry voice choice" }).click();
  await expect(source.getByRole("button", { name: "This is not my voice" })).toBeVisible();
  expect(writes[0]).toEqual(writes[1]);
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
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
    page.getByRole("button", { name: "Check class voices", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/Select a class recording in Sources and process it/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open class sources" })).toHaveAttribute(
    "href",
    "/classes/10000000-0000-4000-8000-000000000001/sources",
  );
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
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
  await page.getByRole("button", { name: "Check class voices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Checking class voices…" })).toBeDisabled();
  await expect(
    page.getByText(/Voice check finished. Next, confirm which speaker is you/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Read class notes", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yes, this is my voice", exact: true }).click();
  await expect(page.getByText("Voice verified", { exact: true })).toBeVisible();
  await expect(page.getByText(/Your voice choices are saved/)).toBeVisible();
  const continuation = page.getByRole("link", { name: "Read class notes", exact: true });
  await expect(continuation).toHaveAttribute("href", "#class-notes");
  await continuation.click();
  await expect(page).toHaveURL(/#class-notes$/);
  await expect(
    page.locator("#class-notes").getByRole("region", { name: "Synthetic class notes" }),
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
  await page.getByRole("button", { name: "Check class voices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Checking class voices…" })).toBeDisabled();
  const source = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(source.getByText("No usable excerpts", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs confirmation", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/Voice check finished, but some recordings have no usable speaker excerpts/),
  ).toBeVisible();
  await expect(source.getByRole("link", { name: "Check source material" })).toHaveAttribute(
    "href",
    "/classes/10000000-0000-4000-8000-000000000001/sources",
  );
  await expect(page.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Read class notes", exact: true })).toBeVisible();
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
  await source.getByRole("button", { name: "Retry class voice check", exact: true }).click();
  await expect(
    source.getByRole("button", { name: "Yes, this is my voice", exact: true }),
  ).toBeVisible();
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
  await expect(page.getByRole("link", { name: "Read class notes", exact: true })).toBeVisible();
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
    page.getByRole("button", { name: "Check class voices", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      /Checking class voices needs the original class recording, even if you have saved a personal voice sample/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Restore class recording" })).toHaveAttribute(
    "href",
    "/classes/10000000-0000-4000-8000-000000000001/sources",
  );
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
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
  await page.getByRole("button", { name: "Yes, this is my voice", exact: true }).click();
  await expect(page.getByText("Voice verified", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Only speech in those checked excerpts can contribute spoken mistakes/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Read class notes", exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Check class voices", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Select a class recording in Sources and process it before checking class voices.",
  );
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Retry voice/ })).toHaveCount(0);
  await expect(page.getByText(/Your last choice still needs to be confirmed/)).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh voice status" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Check class voices", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
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
  await page.getByRole("button", { name: "Check class voices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry voice check", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry voice choice", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Retry voice check", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
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
  await page.getByRole("button", { name: "Check class voices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry voice check", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry voice check", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
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
  await page.getByRole("button", { name: "Check class voices", exact: true }).click();
  await page.getByRole("button", { name: "Retry voice check", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry voice check", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry voice check", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
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
      .getByText(/Original audio is not on this device/),
  ).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("recalino-recordings-v1", 3);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // A silent synthetic WAV is a test asset, not a person's recorded voice.
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
    for (const source of [1, 2]) {
      const userId =
        source === 1
          ? "10000000-0000-4000-8000-000000000002"
          : "90000000-0000-4000-8000-000000000009";
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
  });
  await page.reload();
  const first = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(first.getByRole("button", { name: "Play Voice 1 excerpt 2" })).toBeVisible();
  const second = page.getByRole("region", { name: "Source 2 voice confirmation" });
  await expect(second.getByText(/Original audio is not on this device/)).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Checking class voices…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Yes, this is my voice" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic class notes" })).toBeVisible();
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
