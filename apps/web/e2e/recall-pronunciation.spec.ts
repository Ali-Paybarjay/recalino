import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { studyPronunciationTarget } from "@recalino/core/card";
import { renderStudyCard } from "@recalino/core/study-render";
import { referenceStudyModel } from "../../../packages/core/test/reference-study-fixture";

const sessionId = "10000000-0000-4000-8000-000000000001";
const mediaId = "10000000-0000-4000-8000-000000000099";
const mediaPath = `**/api/classes/${sessionId}/media`;
const ready = { id: mediaId, kind: "tts", state: "ready", mimeType: "audio/mpeg", synthetic: true };

function queue(skipFirst = false) {
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
      pronunciationTarget: studyPronunciationTarget(item),
    }))
    .filter((card) => !skipFirst || card.id !== "reference-card-0")
    // D78: one queue, core cards before supplementary ones within the session.
    .sort((a, b) => Number(a.studySet !== "production") - Number(b.studySet !== "production"));
  return {
    hasCards: true,
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

async function fixtures(page: Page, skipFirst?: () => boolean) {
  let answered = false;
  await page.route("**/api/review/events", (route) => {
    answered = true;
    return route.fulfill({
      json: {
        ...route.request().postDataJSON(),
        version: 1,
        dueAt: "2026-10-06T12:00:00.000Z",
        rating: 3,
        studyDay: "2026-10-05",
      },
    });
  });
  await page.addInitScript(() => {
    const events: Array<{ kind: string; src: string }> = [];
    Object.assign(window, { pronunciationEvents: events });
    const playing = new WeakSet<HTMLMediaElement>();
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return !playing.has(this);
      },
    });
    HTMLMediaElement.prototype.play = function () {
      playing.add(this);
      events.push({ kind: "play", src: this.src });
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      playing.delete(this);
      events.push({ kind: "pause", src: this.src });
      this.dispatchEvent(new Event("pause"));
    };
  });
  await page.route("**/api/review?*", (route) =>
    route.fulfill({
      json: queue(skipFirst ? skipFirst() : answered),
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
  await page.route(
    (url) => url.pathname === `/api/media/${mediaId}`,
    (route) => route.fulfill({ json: { ...ready, state: ++polls === 1 ? "processing" : "ready" } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/ui/study?view=review");
  await expect(
    page.getByRole("button", { name: "Hear pronunciation of wear and tear" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  expect(submitted).toHaveLength(0);
  const hear = page.getByRole("button", {
    name: "Hear pronunciation of wear and tear",
    exact: true,
  });
  await hear.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Preparing pronunciation of wear and tear", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeEnabled();
  const audio = page.locator('audio[aria-label="Pronunciation of wear and tear"]');
  await expect(audio).toBeHidden();
  await expect(audio).not.toHaveAttribute("controls", "");
  expect(submitted).toEqual([
    {
      body: { kind: "pronunciation", cardId: "reference-card-0", expectedContentVersion: 1 },
      key: expect.any(String),
    },
  ]);
  expect(polls).toBe(2);
  await hear.click();
  expect(submitted).toHaveLength(1);
  const output = resolve(
    import.meta.dirname,
    "../../../artifacts/verification/pronunciation-screenshots",
  );
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
  await page.getByRole("button", { name: "Remembered", exact: true }).click();
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
  await page
    .getByRole("button", { name: "Hear pronunciation of wear and tear", exact: true })
    .click();
  const problem = page.getByRole("alert").filter({ hasText: "Pronunciation" });
  await expect(problem).toContainText("Pronunciation is not configured yet");
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeEnabled();
  await page
    .getByRole("button", { name: "Retry pronunciation of wear and tear", exact: true })
    .click();
  await expect(page.getByRole("alert").filter({ hasText: "Another task" })).toBeVisible();
  await page
    .getByRole("button", { name: "Retry pronunciation of wear and tear", exact: true })
    .click();
  await expect(problem).toContainText("could not be prepared");
  await page
    .getByRole("button", { name: "Retry pronunciation of wear and tear", exact: true })
    .click();
  await expect(page.locator("audio")).toBeHidden();
  await expect(page.locator("audio")).toHaveCount(1);
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
  await page
    .getByRole("button", { name: "Hear pronunciation of wear and tear", exact: true })
    .click();
  await page.getByRole("button", { name: "Remembered", exact: true }).click();
  // A failed optional font can leave hidden server markup beside the hydrated card.
  await expect(page.locator(".fc-face:visible")).toHaveText([/new office/]);
  release?.();
  await expect(page.locator("audio")).toHaveCount(0);
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: "Hear pronunciation of kit it out", exact: true }).click();
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
  await page
    .getByRole("button", { name: "Hear pronunciation of wear and tear", exact: true })
    .click();
  await expect(page.getByRole("alert").filter({ hasText: "This card changed" })).toContainText(
    "Reload review",
  );
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeEnabled();
});

for (const width of [390, 1440]) {
  for (const studySet of ["production", "recognition"]) {
    test(`AC-D46-01 speaker stays beside the English target in ${studySet} at ${width}px`, async ({
      page,
    }) => {
      await fixtures(page);
      // The target and control must stay together when optional web fonts fail.
      await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
      const requests: unknown[] = [];
      await page.route(mediaPath, (route) => {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ json: ready });
      });
      if (studySet === "recognition") {
        await page.route("**/api/review?*", (route) => {
          const value = queue();
          value.cards = value.cards.filter(({ card }) => card.learningItemId === "manager");
          return route.fulfill({ json: value });
        });
      }
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dev/ui/study?view=review");
      if (studySet === "recognition") {
        // D78: the supplementary card follows the core card in the same queue.
        await page.getByRole("button", { name: "Show answer", exact: true }).click();
        await page.getByRole("button", { name: "Remembered", exact: true }).click();
        await expect(page.getByText("Supplementary · recognition", { exact: true })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: /^Hear pronunciation of/ })).toHaveCount(0);
      await page.getByRole("button", { name: "Show answer", exact: true }).click();
      const target = studySet === "production" ? "wear and tear" : "manager";
      const speaker = page.getByRole("button", {
        name: `Hear pronunciation of ${target}`,
        exact: true,
      });
      await expect(speaker).toBeVisible();
      expect(requests).toHaveLength(0);
      const word = page
        .locator(".fc-face:visible")
        .getByText(studySet === "production" ? target : "manager (pronunciation)", { exact: true });
      // Fonts and the inline control settle after the answer is revealed.
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(async () => {
          const wordBounds = await word.boundingBox();
          const control = await speaker.boundingBox();
          return wordBounds && control
            ? Math.abs(control.y + control.height / 2 - wordBounds.y - wordBounds.height / 2)
            : Number.POSITIVE_INFINITY;
        })
        .toBeLessThan(32);
      const wordBounds = await word.boundingBox();
      const speakerBounds = await speaker.boundingBox();
      expect(wordBounds).not.toBeNull();
      expect(speakerBounds).not.toBeNull();
      if (!wordBounds || !speakerBounds)
        throw new Error("The English target and speaker must be visible");
      expect(
        Math.abs(speakerBounds.y + speakerBounds.height / 2 - wordBounds.y - wordBounds.height / 2),
      ).toBeLessThan(32);
      expect(
        Math.min(
          Math.abs(speakerBounds.x - wordBounds.x - wordBounds.width),
          Math.abs(wordBounds.x - speakerBounds.x - speakerBounds.width),
        ),
      ).toBeLessThan(40);
      expect(
        await page
          .locator("html")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await speaker.focus();
      await page.keyboard.press("Space");
      await expect(
        page.getByRole("button", { name: `Hear pronunciation of ${target}`, exact: true }),
      ).toBeVisible();
      await expect(page.locator(`audio[aria-label="Pronunciation of ${target}"]`)).toHaveCount(1);
      await expect(
        page.getByRole("status").filter({ hasText: "Synthetic British pronunciation" }),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const readyWord = await word.boundingBox();
          const readySpeaker = await speaker.boundingBox();
          return readyWord && readySpeaker
            ? Math.abs(
                readySpeaker.y + readySpeaker.height / 2 - readyWord.y - readyWord.height / 2,
              )
            : Number.POSITIVE_INFINITY;
        })
        .toBeLessThan(32);
      if (studySet === "recognition") {
        const screenshots = resolve(
          import.meta.dirname,
          "../../../artifacts/verification/pronunciation-screenshots",
        );
        await mkdir(screenshots, { recursive: true });
        await page.screenshot({
          path: resolve(screenshots, `recall-recognition-pronunciation-${width}.png`),
          fullPage: true,
        });
      }
      expect(requests).toEqual([
        {
          kind: "pronunciation",
          cardId: studySet === "production" ? "reference-card-0" : "reference-card-5",
          expectedContentVersion: 1,
        },
      ]);
    });
  }
}

test("AC-D46-03 autoplay rejection exposes native playback without another generation", async ({
  page,
}) => {
  await fixtures(page);
  await page.addInitScript(() => {
    let attempts = 0;
    HTMLMediaElement.prototype.play = function () {
      if (++attempts === 1)
        return Promise.reject(new DOMException("Gesture required", "NotAllowedError"));
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
  });
  let requests = 0;
  await page.route(mediaPath, (route) => {
    requests++;
    return route.fulfill({ json: ready });
  });
  await page.goto("/dev/ui/study?view=review");
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page
    .getByRole("button", { name: "Hear pronunciation of wear and tear", exact: true })
    .click();
  const audio = page.locator('audio[aria-label="Pronunciation of wear and tear"]');
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute("controls", "");
  await expect(page.getByRole("status").filter({ hasText: "Press Play" })).toBeVisible();
  expect(requests).toBe(1);
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  expect(requests).toBe(1);
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeEnabled();
});

test("AC-D46-03 an unresolved asset is checked again without another generation request", async ({
  page,
}) => {
  await fixtures(page);
  const keys: string[] = [];
  await page.route(mediaPath, (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    return route.fulfill({ json: { ...ready, state: "needs_input" } });
  });
  let checks = 0;
  await page.route(
    (url) => url.pathname === `/api/media/${mediaId}`,
    (route) => {
      checks++;
      return route.fulfill({ json: { ...ready, state: "needs_input" } });
    },
  );
  await page.goto("/dev/ui/study?view=review");
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page
    .getByRole("button", { name: "Hear pronunciation of wear and tear", exact: true })
    .click();
  await expect(page.getByRole("alert").filter({ hasText: "Pronunciation" })).toContainText(
    "contact support",
  );
  await page
    .getByRole("button", { name: "Retry pronunciation of wear and tear", exact: true })
    .click();
  await expect.poll(() => checks).toBe(1);
  expect(keys).toHaveLength(1);
  expect(keys[0]).not.toBe("");
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remembered", exact: true })).toBeEnabled();
});

test("AC-D46-01 pronunciation pauses the current listening attachment while leaving unrelated audio alone", async ({
  page,
}) => {
  await fixtures(page);
  const listeningId = "10000000-0000-4000-8000-000000000097";
  await page.route("**/api/review?*", (route) => {
    const value = queue();
    const first = value.cards[0];
    if (!first) throw new Error("Synthetic listening card must exist");
    return route.fulfill({
      json: {
        ...value,
        cards: [
          { ...first, card: { ...first.card, template: "listening", frontMediaId: listeningId } },
        ],
      },
    });
  });
  await page.route(`**/api/media/${listeningId}`, (route) =>
    route.fulfill({ json: { ...ready, id: listeningId } }),
  );
  await page.route(`**/api/media/${listeningId}/read`, (route) =>
    route.fulfill({ json: { url: "/synthetic-pronunciation.wav#listening-front" } }),
  );
  await page.route(mediaPath, (route) => route.fulfill({ json: ready }));
  await page.goto("/dev/ui/study?view=review");
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page.getByRole("button", { name: "Remembered", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Listen and recall", exact: true })).toBeVisible();
  const listening = page.locator('audio[src$="#listening-front"]');
  await expect(listening).toBeVisible();
  await listening.evaluate((element: HTMLAudioElement) => element.play());
  await page.evaluate(async () => {
    const outside = document.createElement("audio");
    outside.id = "synthetic-unrelated-audio";
    outside.src = "/synthetic-pronunciation.wav#outside-study";
    document.body.append(outside);
    await outside.play();
  });
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await page
    .getByRole("button", { name: "Hear pronunciation of wear and tear", exact: true })
    .click();
  await expect(page.locator('audio[aria-label="Pronunciation of wear and tear"]')).toHaveCount(1);
  const playback = await page.evaluate(
    () =>
      (window as unknown as { pronunciationEvents: Array<{ kind: string; src: string }> })
        .pronunciationEvents,
  );
  const listeningPlay = playback.findIndex(
    (event) => event.kind === "play" && event.src.endsWith("#listening-front"),
  );
  const listeningPause = playback.findIndex(
    (event, index) =>
      index > listeningPlay && event.kind === "pause" && event.src.endsWith("#listening-front"),
  );
  const pronunciationPlay = playback.findIndex(
    (event, index) =>
      index > listeningPause &&
      event.kind === "play" &&
      event.src.endsWith("synthetic-pronunciation.wav"),
  );
  expect(listeningPlay).toBeGreaterThanOrEqual(0);
  expect(listeningPause).toBeGreaterThan(listeningPlay);
  expect(pronunciationPlay).toBeGreaterThan(listeningPause);
  expect(
    playback.some((event) => event.kind === "pause" && event.src.endsWith("#outside-study")),
  ).toBe(false);
});
