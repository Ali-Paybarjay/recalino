import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { renderStudyCard } from "@recalino/core/study-render";
import { referenceStudyModel } from "../../../packages/core/test/reference-study-fixture";

const sessionId = "10000000-0000-4000-8000-000000000001";
const mediaId = "10000000-0000-4000-8000-000000000099";
const mediaPath = `**/api/classes/${sessionId}/media`;
const ready = { id: mediaId, kind: "tts", state: "ready", mimeType: "audio/mpeg", synthetic: true };

function queue(studySet = "production", skipFirst = false) {
  const createdAt = "2026-10-05T12:00:00.000Z";
  const cards = referenceStudyModel()
    .learningItems.map((item, index) => ({
      id: `reference-card-${index}`,
      ownerId: "synthetic-owner",
      learningItemId: item.id,
      sessionIds: [sessionId],
      template: "basic",
      direction: "forward",
      ...renderStudyCard(item),
      provenance: item.claim,
      status: "active",
      contentVersion: 1,
      important: false,
      qualityConfirmed: true,
      frontMediaId: null,
      backMediaId: null,
      createdAt,
      updatedAt: createdAt,
      contentFormat: "lesson_html",
      studySet: item.study?.set,
      pronunciationTarget:
        index === 0
          ? "wear and tear"
          : index === 1
            ? "kit it out"
            : index === 8
              ? "a hefty discount"
              : undefined,
    }))
    .filter((card) => card.studySet === studySet && (!skipFirst || card.id !== "reference-card-0"));
  return {
    studySet,
    availableStudySets: ["production", "recognition"],
    cards: cards.map((card) => ({
      card,
      schedule: {
        cardId: card.id,
        version: 0,
        dueAt: createdAt,
        introducedAt: null,
        state: {
          due: createdAt,
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: 0,
          reps: 0,
          lapses: 0,
          state: 0,
        },
      },
    })),
    dueCount: 0,
    newRemaining: 10,
    buriedSiblings: 0,
    nextDueAt: null,
    studyDay: "2026-10-05",
    timezone: "Europe/London",
    settings: { mode: "simple", desiredRetention: 0.9, dailyNewLimit: 20, timeBudgetMinutes: 10 },
  };
}

async function fixtures(page: Page, skipFirst = () => false) {
  await page.addInitScript(() => {
    const events: Array<{ kind: string; src: string }> = [];
    Object.assign(window, { pronunciationEvents: events });
    HTMLMediaElement.prototype.play = function () {
      events.push({ kind: "play", src: this.src });
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      events.push({ kind: "pause", src: this.src });
    };
  });
  await page.route("**/api/review?*", (route) =>
    route.fulfill({
      json: queue(
        new URL(route.request().url()).searchParams.get("studySet") ?? "production",
        skipFirst(),
      ),
    }),
  );
  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(16000, 40);
  await page.route("**/synthetic-pronunciation.wav", (route) =>
    route.fulfill({ contentType: "audio/wav", body: wav }),
  );
  await page.route(`**/api/media/${mediaId}/read`, (route) =>
    route.fulfill({ json: { url: "/synthetic-pronunciation.wav" } }),
  );
}

test("AC-D46-01/02 pronunciation follows reveal, prepares saved audio and replays accessibly", async ({
  page,
}) => {
  await fixtures(page);
  const submitted: Array<{ body: unknown; key: string | undefined }> = [];
  await page.route(mediaPath, (route) => {
    submitted.push({
      body: route.request().postDataJSON(),
      key: route.request().headers()["idempotency-key"],
    });
    return route.fulfill({ json: { ...ready, state: "queued" } });
  });
  let polls = 0;
  await page.route(`**/api/media/${mediaId}`, (route) =>
    route.fulfill({ json: { ...ready, state: ++polls === 1 ? "processing" : "ready" } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/ui/study?view=review");
  await expect(page.getByRole("button", { name: "Hear pronunciation" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  const hear = page.getByRole("button", { name: "Hear pronunciation", exact: true });
  await hear.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Preparing pronunciation…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeEnabled();
  const audio = page.locator('audio[aria-label="Pronunciation of wear and tear"]');
  await expect(audio).toBeVisible();
  expect(submitted).toEqual([
    {
      body: { kind: "pronunciation", cardId: "reference-card-0", expectedContentVersion: 1 },
      key: expect.any(String),
    },
  ]);
  expect(polls).toBe(2);
  await hear.click();
  expect(submitted).toHaveLength(1);
  const output = resolve(import.meta.dirname, "../../../artifacts/verification");
  await mkdir(output, { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: resolve(output, `recall-pronunciation-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: /Supplementary · recognition/ }).click();
  await expect(audio).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { pronunciationEvents: Array<{ kind: string }> }
        ).pronunciationEvents.filter((event) => event.kind === "pause").length,
    ),
  ).toBeGreaterThan(0);
});

test("AC-D46-03 unavailable and failed pronunciation retries without blocking grades", async ({
  page,
}) => {
  await fixtures(page);
  const keys: string[] = [];
  await page.route(mediaPath, (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (keys.length === 1)
      return route.fulfill({
        status: 422,
        json: {
          error: {
            code: "validation_failed",
            message: "Unavailable",
            details: { fields: { media: ["pronunciation_not_configured"] } },
          },
        },
      });
    if (keys.length === 2)
      return route.fulfill({
        status: 409,
        json: { error: { code: "conflict", message: "Conflicting change" } },
      });
    return route.fulfill({ json: { ...ready, state: keys.length === 3 ? "failed" : "ready" } });
  });
  await page.goto("/dev/ui/study?view=review");
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: "Hear pronunciation", exact: true }).click();
  const problem = page.getByRole("alert").filter({ hasText: "Pronunciation" });
  await expect(problem).toContainText("Pronunciation is not configured yet");
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Retry pronunciation", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Another task" })).toBeVisible();
  await page.getByRole("button", { name: "Retry pronunciation", exact: true }).click();
  await expect(problem).toContainText("could not be prepared");
  await page.getByRole("button", { name: "Retry pronunciation", exact: true }).click();
  await expect(page.locator("audio")).toBeVisible();
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).toBe(keys[1]);
  expect(keys[3]).not.toBe(keys[2]);
});

test("AC-D46-03 grading during preparation discards late audio and leaving review pauses playback", async ({
  page,
}) => {
  let saved = false;
  await fixtures(page, () => saved);
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(mediaPath, async (route) => {
    await pending;
    await route.fulfill({ json: ready }).catch(() => {});
  });
  await page.route("**/api/review/events", (route) => {
    saved = true;
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        ...body,
        version: 1,
        dueAt: "2026-10-06T12:00:00.000Z",
        rating: 3,
        studyDay: "2026-10-05",
      },
    });
  });
  await page.goto("/dev/ui/study?view=review");
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: "Hear pronunciation", exact: true }).click();
  await page.getByRole("button", { name: "Remembered", exact: true }).click();
  await expect(page.locator(".fc-face")).toContainText("new office");
  release?.();
  await expect(page.locator("audio")).toHaveCount(0);
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: "Hear pronunciation", exact: true }).click();
  await expect(page.locator("audio")).toHaveAttribute("aria-label", "Pronunciation of kit it out");
  await page.getByRole("link", { name: "Notes", exact: true }).click();
  await expect(page.locator("audio")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { pronunciationEvents: Array<{ kind: string }> }
        ).pronunciationEvents.filter((event) => event.kind === "pause").length,
    ),
  ).toBeGreaterThan(0);
});

test("AC-D46-01 a changed card requires reload before speaking its newer answer", async ({
  page,
}) => {
  await fixtures(page);
  await page.route(mediaPath, (route) => {
    expect(route.request().postDataJSON().expectedContentVersion).toBe(1);
    return route.fulfill({
      status: 422,
      json: {
        error: {
          code: "validation_failed",
          message: "Changed card",
          details: { fields: { pronunciation: ["card_changed"] } },
        },
      },
    });
  });
  await page.goto("/dev/ui/study?view=review");
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: "Hear pronunciation", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This card changed" })).toContainText(
    "Reload review",
  );
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeEnabled();
});
