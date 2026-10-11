import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import { renderClassNotesHtml } from "@recalino/core/study-render";
import { referenceStudyModel } from "../../../packages/core/test/reference-study-fixture";

const sessionId = "10000000-0000-4000-8000-000000000001";
const mediaId = "10000000-0000-4000-8000-000000000099";
const mediaPath = `**/api/classes/${sessionId}/media`;
const ready = { id: mediaId, kind: "tts", state: "ready", mimeType: "audio/mpeg", synthetic: true };
const revisionId = "reference-revision";
const frameSelector = 'iframe[title^="Session notes:"]';

interface SubmittedSpeech {
  body: unknown;
  key: string | undefined;
}

async function fixtures(page: Page, blockAutoplay = false) {
  await page.addInitScript(
    ({ blockAutoplay }) => {
      const events: Array<{ kind: string; src: string }> = [];
      Object.assign(window, { pronunciationEvents: events });
      let blocked = false;
      HTMLMediaElement.prototype.play = function () {
        if (blockAutoplay && !blocked) {
          blocked = true;
          events.push({ kind: "blocked", src: this.src });
          return Promise.reject(new DOMException("Gesture required", "NotAllowedError"));
        }
        events.push({ kind: "play", src: this.src });
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        events.push({ kind: "pause", src: this.src });
        this.dispatchEvent(new Event("pause"));
      };
    },
    { blockAutoplay },
  );
  // Every API request is local and mocked, including unexpected requests from the frame.
  const unrelatedWrites: string[] = [];
  await page.route("**/api/**", (route) => {
    if (route.request().method() !== "GET") unrelatedWrites.push(route.request().url());
    return route.fulfill({
      status: 422,
      json: { error: { code: "validation_failed", message: "Synthetic fixture only" } },
    });
  });
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
  await page.route("**/synthetic-notes-pronunciation.wav*", (route) =>
    route.fulfill({ contentType: "audio/wav", body: wav }),
  );
  await page.route("**/api/media/*/read", (route) =>
    route.fulfill({
      json: {
        url: `/synthetic-notes-pronunciation.wav?id=${route.request().url().split("/").at(-2)}`,
      },
    }),
  );
  return unrelatedWrites;
}

function hear(frame: FrameLocator, target = "wear and tear") {
  return frame.getByRole("button", { name: `Hear pronunciation of ${target}`, exact: true });
}
async function readySpeech(page: Page, target = "wear and tear") {
  await expect(page.locator(`audio[aria-label="Pronunciation of ${target}"]`)).toHaveCount(1);
  await expect(
    page.getByRole("status").filter({ hasText: "Synthetic British pronunciation" }),
  ).toBeVisible();
}

async function events(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { pronunciationEvents: Array<{ kind: string; src: string }> })
        .pronunciationEvents,
  );
}

for (const width of [390, 1440]) {
  test(`AC-D46-NOTE speaker is beside the saved headword and keyboard operable at ${width}px`, async ({
    page,
  }) => {
    const unrelatedWrites = await fixtures(page);
    const browserErrors = new Set<string>();
    page.on("pageerror", (failure) => browserErrors.add(failure.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.add(message.text());
    });
    const submitted: SubmittedSpeech[] = [];
    await page.route(mediaPath, (route) => {
      submitted.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()["idempotency-key"],
      });
      return route.fulfill({ json: ready });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dev/ui/study?view=notes");
    const frame = page.frameLocator(frameSelector);
    const speaker = hear(frame);
    try {
      await expect(speaker).toBeVisible();
    } catch (failure) {
      const document = await page.locator(frameSelector).evaluate((element: HTMLIFrameElement) => {
        const content = new DOMParser().parseFromString(element.srcdoc, "text/html");
        return {
          sandbox: element.getAttribute("sandbox"),
          srcdocChars: element.srcdoc.length,
          metadata: content
            .querySelector('meta[name="recalino-pronunciation"]')
            ?.getAttribute("content"),
          csp: content
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute("content"),
          anchors: [...content.querySelectorAll("[data-learning-item-id]")].map((anchor) =>
            anchor.getAttribute("data-learning-item-id"),
          ),
          scriptCount: content.querySelectorAll("script").length,
        };
      });
      await test.info().attach("notes-frame-runtime.json", {
        body: JSON.stringify({ document, browserErrors: [...browserErrors] }, null, 2),
        contentType: "application/json",
      });
      throw failure;
    }
    expect(submitted).toHaveLength(0);
    expect(unrelatedWrites).toHaveLength(0);
    const heading = frame.locator("#wear-tear h3");
    await expect(
      heading.getByRole("button", { name: "Hear pronunciation of wear and tear", exact: true }),
    ).toHaveCount(1);
    const wordBounds = await heading.locator(".en").boundingBox();
    const speakerBounds = await speaker.boundingBox();
    if (!wordBounds || !speakerBounds)
      throw new Error("Saved headword and speaker must be visible");
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
      await frame.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(page.locator(frameSelector)).toHaveAttribute("sandbox", "allow-scripts");
    await expect(page.locator(frameSelector)).not.toHaveAttribute("sandbox", /allow-same-origin/);
    await speaker.focus();
    await page.keyboard.press("Enter");
    await readySpeech(page);
    await expect(
      frame.getByRole("status").filter({ hasText: "Synthetic British pronunciation" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await heading.locator(".en").boundingBox())?.height ?? Number.POSITIVE_INFINITY,
      )
      .toBeLessThan(48);
    const screenshots = resolve(
      import.meta.dirname,
      "../../../artifacts/verification/pronunciation-screenshots",
    );
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: resolve(screenshots, `class-notes-pronunciation-${width}.png`),
      fullPage: true,
    });
    expect(submitted).toEqual([
      {
        body: {
          kind: "note_pronunciation",
          learningItemId: "wear-tear",
          expectedNotebookRevisionId: revisionId,
        },
        key: expect.any(String),
      },
    ]);
    const audio = page.locator('audio[aria-label="Pronunciation of wear and tear"]');
    await expect(audio).toHaveCount(1);
    await expect(audio).toBeHidden();
    await hear(frame).click();
    await readySpeech(page);
    expect(submitted).toHaveLength(1);
    await expect
      .poll(async () => (await events(page)).filter((event) => event.kind === "play").length)
      .toBe(2);
  });
}

test("AC-D46-NOTE preparation uses one current-item request, polls and leaves other words available", async ({
  page,
}) => {
  await fixtures(page);
  const submitted: SubmittedSpeech[] = [];
  await page.route(mediaPath, (route) => {
    submitted.push({
      body: route.request().postDataJSON(),
      key: route.request().headers()["idempotency-key"],
    });
    return route.fulfill({ json: { ...ready, state: "queued" } });
  });
  let polls = 0;
  let reads = 0;
  await page.route(
    (url) => url.pathname === `/api/media/${mediaId}`,
    (route) => {
      expect(new URL(route.request().url()).searchParams.get("playback")).toBe("1");
      const complete = ++polls > 1;
      return route.fulfill({
        json: {
          ...ready,
          state: complete ? "ready" : "processing",
          ...(complete
            ? {
                playback: {
                  url: `/synthetic-notes-pronunciation.wav?id=${mediaId}`,
                  validUntil: new Date(Date.now() + 60000).toISOString(),
                },
              }
            : {}),
        },
      });
    },
  );
  await page.route(`**/api/media/${mediaId}/read`, (route) => {
    reads++;
    return route.fulfill({ json: { url: `/synthetic-notes-pronunciation.wav?id=${mediaId}` } });
  });
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await hear(frame).click();
  await expect(
    frame.getByRole("button", { name: "Preparing pronunciation of wear and tear", exact: true }),
  ).toBeDisabled();
  await expect(hear(frame, "kit it out")).toBeEnabled();
  await readySpeech(page);
  expect(polls).toBe(2);
  expect(reads).toBe(0);
  expect(submitted).toEqual([
    {
      body: {
        kind: "note_pronunciation",
        learningItemId: "wear-tear",
        expectedNotebookRevisionId: revisionId,
      },
      key: expect.any(String),
    },
  ]);
});

test("AC-D46-NOTE switching back reuses ready pronunciation and renews only an expired playback link", async ({
  page,
}) => {
  await fixtures(page);
  const now = Date.now(),
    validUntil = now + 60000;
  await page.clock.install({ time: new Date(now) });
  const secondId = "10000000-0000-4000-8000-000000000098";
  const requests: string[] = [],
    reads: string[] = [],
    statusChecks: string[] = [];
  await page.route(mediaPath, (route) => {
    const itemId = route.request().postDataJSON().learningItemId;
    requests.push(itemId);
    const id = itemId === "kit-out" ? secondId : mediaId;
    return route.fulfill({
      json: {
        ...ready,
        id,
        playback: {
          url: `/synthetic-notes-pronunciation.wav?id=${id}&lease=1`,
          validUntil: new Date(validUntil).toISOString(),
        },
      },
    });
  });
  await page.route(
    (url) => [mediaId, secondId].some((id) => url.pathname === `/api/media/${id}`),
    (route) => {
      statusChecks.push(new URL(route.request().url()).pathname);
      return route.fulfill({ json: ready });
    },
  );
  await page.route("**/api/media/*/read", (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      json: {
        url: `/synthetic-notes-pronunciation.wav?id=${mediaId}&lease=2`,
        validUntil: new Date(validUntil + 120000).toISOString(),
      },
    });
  });
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await hear(frame).click();
  await readySpeech(page);
  await hear(frame, "kit it out").click();
  await readySpeech(page, "kit it out");
  await hear(frame).click();
  await readySpeech(page);
  await expect(page.locator("audio")).toHaveAttribute("src", /lease=1$/);
  expect(requests).toEqual(["wear-tear", "kit-out"]);
  expect(reads).toEqual([]);
  expect(statusChecks).toEqual([]);
  await expect
    .poll(async () => (await events(page)).filter((event) => event.kind === "play").length)
    .toBe(3);

  await hear(frame, "kit it out").click();
  await readySpeech(page, "kit it out");
  await page.clock.setSystemTime(new Date(validUntil + 1000));
  await hear(frame).click();
  await readySpeech(page);
  await expect(page.locator("audio")).toHaveAttribute("src", /lease=2$/);
  expect(requests).toEqual(["wear-tear", "kit-out"]);
  expect(reads).toEqual([`/api/media/${mediaId}/read`]);
  expect(statusChecks).toEqual([]);
  await expect
    .poll(async () => (await events(page)).filter((event) => event.kind === "play").length)
    .toBe(5);
});

test("AC-D46-NOTE switching words discards the late request and stops earlier audio", async ({
  page,
}) => {
  await fixtures(page);
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const itemIds: string[] = [];
  const secondId = "10000000-0000-4000-8000-000000000098";
  await page.route(mediaPath, async (route) => {
    const { learningItemId } = route.request().postDataJSON();
    itemIds.push(learningItemId);
    if (learningItemId === "wear-tear" && itemIds.length === 1) await pending;
    await route
      .fulfill({ json: { ...ready, id: learningItemId === "kit-out" ? secondId : mediaId } })
      .catch(() => {});
  });
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await hear(frame).click();
  await expect(
    frame.getByRole("button", { name: "Preparing pronunciation of wear and tear", exact: true }),
  ).toBeDisabled();
  await hear(frame, "kit it out").click();
  await readySpeech(page, "kit it out");
  release?.();
  await expect(page.locator("audio")).toHaveAttribute("aria-label", "Pronunciation of kit it out");
  expect((await events(page)).filter((event) => event.kind === "play")).toHaveLength(1);
  await hear(frame).click();
  await readySpeech(page);
  const played = await events(page);
  const firstPlay = played.findIndex(
    (event) => event.kind === "play" && event.src.includes(secondId),
  );
  const stopOld = played.findIndex(
    (event, index) => index > firstPlay && event.kind === "pause" && event.src.includes(secondId),
  );
  const nextPlay = played.findIndex(
    (event, index) => index > stopOld && event.kind === "play" && event.src.includes(mediaId),
  );
  expect(firstPlay).toBeGreaterThanOrEqual(0);
  expect(stopOld).toBeGreaterThan(firstPlay);
  expect(nextPlay).toBeGreaterThan(stopOld);
  expect(itemIds).toEqual(["wear-tear", "kit-out", "wear-tear"]);
});

test("AC-D46-NOTE configuration/failed output retries preserve or replace only the appropriate key", async ({
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
    return route.fulfill({ json: { ...ready, state: keys.length === 2 ? "failed" : "ready" } });
  });
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await hear(frame).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pronunciation" })).toContainText(
    "not configured",
  );
  await frame
    .getByRole("button", { name: "Retry pronunciation of wear and tear", exact: true })
    .click();
  await expect(page.getByRole("alert").filter({ hasText: "Pronunciation" })).toContainText(
    "could not be prepared",
  );
  await frame
    .getByRole("button", { name: "Retry pronunciation of wear and tear", exact: true })
    .click();
  await readySpeech(page);
  expect(keys[0]).not.toBe("");
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
});

test("AC-D46-NOTE autoplay fallback provides a visible player without a duplicate request", async ({
  page,
}) => {
  await fixtures(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  let submitted = 0;
  await page.route(mediaPath, (route) => {
    submitted++;
    return route.fulfill({ json: ready });
  });
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await hear(frame).click();
  const audio = page.locator('audio[aria-label="Pronunciation of wear and tear"]');
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute("controls", "");
  await expect(page.getByRole("status").filter({ hasText: "Press Play" })).toBeVisible();
  const screenshots = resolve(
    import.meta.dirname,
    "../../../artifacts/verification/pronunciation-screenshots",
  );
  await mkdir(screenshots, { recursive: true });
  const playHit = async () =>
    audio.evaluate((element: HTMLAudioElement) => {
      const bounds = element.getBoundingClientRect();
      const point = { x: bounds.x + 24, y: bounds.y + bounds.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      return {
        point,
        unobstructed: hit === element || element.contains(hit),
        hitTag: hit?.tagName,
      };
    });
  await expect.poll(async () => (await playHit()).unobstructed).toBe(true);
  const audioBounds = await audio.boundingBox();
  const wordBounds = await hear(frame).boundingBox();
  const viewport = page.viewportSize();
  const hitTest = await playHit();
  const bottomNavigation = await page
    .getByRole("navigation", { name: "Your learning space", exact: true })
    .boundingBox();
  const geometry = {
    audioBounds,
    wordBounds,
    viewport,
    hitTest,
    bottomNavigation,
    playerWithinViewport:
      !!audioBounds &&
      !!viewport &&
      audioBounds.y >= 0 &&
      audioBounds.y + audioBounds.height <= viewport.height,
  };
  await writeFile(
    resolve(screenshots, "class-notes-autoplay-fallback-390.json"),
    JSON.stringify(geometry, null, 2),
  );
  await page.screenshot({
    path: resolve(screenshots, "class-notes-autoplay-fallback-390.png"),
    fullPage: false,
  });
  await test.info().attach("class-notes-autoplay-fallback-geometry", {
    body: JSON.stringify(geometry, null, 2),
    contentType: "application/json",
  });
  expect(submitted).toBe(1);
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  expect(submitted).toBe(1);
});

test("AC-D46-NOTE exported notes remain an inert readable document", async ({ page }) => {
  const html = renderClassNotesHtml(referenceStudyModel());
  await page.setContent(html);
  await expect(page.locator("#wear-tear h3")).toContainText("wear and tear");
  await expect(page.getByRole("button", { name: /pronunciation/ })).toHaveCount(0);
  await expect(page.locator("script")).toHaveCount(0);
});

test("AC-D46-NOTE escaped class text cannot become another script in the interactive sandbox", async ({
  page,
}) => {
  await fixtures(page);
  let requests = 0;
  await page.route(mediaPath, (route) => {
    requests++;
    return route.fulfill({ json: ready });
  });
  const model = referenceStudyModel();
  model.title =
    '</h1><script>window.__classTextExecuted=true</script><img src=x onerror="parent.__classTextExecuted=true">';
  const rendered = renderClassNotesHtml(model);
  const escapedHeading = rendered.match(/<h1>[\s\S]*?<\/h1>/)?.[0];
  if (!escapedHeading) throw new Error("The renderer must retain a document heading");
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await expect(hear(frame)).toBeVisible();
  // Replace only a renderer-produced content field. Keep the real frame's bridge and CSP unchanged.
  await page.locator(frameSelector).evaluate((element: HTMLIFrameElement, heading) => {
    element.srcdoc = element.srcdoc.replace(/<h1>[\s\S]*?<\/h1>/, () => heading);
  }, escapedHeading);
  await expect(frame.locator("h1")).toHaveText(model.title);
  await expect(frame.locator("script")).toHaveCount(1);
  await expect(frame.locator("img[onerror]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __classTextExecuted?: boolean }).__classTextExecuted,
    ),
  ).toBeUndefined();
  expect(
    await frame
      .locator("body")
      .evaluate(() => (window as unknown as { __classTextExecuted?: boolean }).__classTextExecuted),
  ).toBeUndefined();
  expect(
    await frame.locator("body").evaluate(() => {
      try {
        void parent.document;
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(requests).toBe(0);
  await hear(frame).click();
  await readySpeech(page);
  expect(requests).toBe(1);
});

test("AC-D46-NOTE foreign windows, stale channels, unknown items and extra payload fields cannot request speech", async ({
  page,
}) => {
  await fixtures(page);
  await page.addInitScript(() => {
    Object.assign(window, { pronunciationProbeAcks: 0 });
    window.addEventListener("message", (event) => {
      if (event.data?.type === "synthetic:pronunciation-probe-ack") {
        const state = window as unknown as { pronunciationProbeAcks: number };
        state.pronunciationProbeAcks++;
      }
    });
  });
  const submitted: unknown[] = [];
  await page.route(mediaPath, (route) => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ json: ready });
  });
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await expect(hear(frame)).toBeVisible();
  const metadata = await frame
    .locator('meta[name="recalino-pronunciation"]')
    .getAttribute("content");
  if (!metadata) throw new Error("The interactive frame needs its per-document channel");
  const { channel } = JSON.parse(metadata) as { channel: string };
  const valid = { type: "recalino:pronunciation", channel, itemId: "wear-tear" };
  await page.evaluate((payload) => {
    window.postMessage(payload, "*");
    window.postMessage({ type: "synthetic:pronunciation-probe-ack" }, "*");
  }, valid);
  await page.waitForFunction(
    () => (window as unknown as { pronunciationProbeAcks: number }).pronunciationProbeAcks === 1,
  );
  expect(submitted).toHaveLength(0);
  // A real sibling Window emits the valid shape/channel. Its source must still be rejected.
  await page.evaluate(() => {
    const other = document.createElement("iframe");
    other.title = "Synthetic unrelated frame";
    other.sandbox.add("allow-scripts");
    other.srcdoc = "<html><body>Unrelated synthetic frame</body></html>";
    document.body.append(other);
  });
  await page
    .frameLocator('iframe[title="Synthetic unrelated frame"]')
    .locator("body")
    .evaluate((_element, payload) => {
      parent.postMessage(payload, "*");
      parent.postMessage({ type: "synthetic:pronunciation-probe-ack" }, "*");
    }, valid);
  await page.waitForFunction(
    () => (window as unknown as { pronunciationProbeAcks: number }).pronunciationProbeAcks === 2,
  );
  expect(submitted).toHaveLength(0);
  const invalid = [
    { ...valid, channel: `${channel}-stale` },
    { ...valid, itemId: "unknown-learning-item" },
    { type: valid.type, channel },
    { ...valid, text: "untrusted arbitrary speech" },
    { ...valid, expectedNotebookRevisionId: "stale-notebook" },
    { ...valid, type: "recalino:another-action" },
  ];
  for (const [index, payload] of invalid.entries()) {
    await frame.locator("body").evaluate((_element, message) => {
      parent.postMessage(message, "*");
      parent.postMessage({ type: "synthetic:pronunciation-probe-ack" }, "*");
    }, payload);
    await page.waitForFunction(
      (expected) =>
        (window as unknown as { pronunciationProbeAcks: number }).pronunciationProbeAcks ===
        expected,
      index + 3,
    );
    expect(submitted).toHaveLength(0);
  }
  await hear(frame).click();
  await readySpeech(page);
  expect(submitted).toEqual([
    {
      kind: "note_pronunciation",
      learningItemId: "wear-tear",
      expectedNotebookRevisionId: revisionId,
    },
  ]);
});

test("AC-D46-NOTE a failed read link retries the existing asset without paying for another generation", async ({
  page,
}) => {
  await fixtures(page);
  let generations = 0;
  await page.route(mediaPath, (route) => {
    generations++;
    return route.fulfill({ json: ready });
  });
  let checks = 0;
  await page.route(
    (url) => url.pathname === `/api/media/${mediaId}`,
    (route) => {
      checks++;
      return route.fulfill({ json: ready });
    },
  );
  let reads = 0;
  await page.route(`**/api/media/${mediaId}/read`, (route) => {
    reads++;
    return reads === 1
      ? route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Synthetic read link unavailable" } },
        })
      : route.fulfill({ json: { url: `/synthetic-notes-pronunciation.wav?id=${mediaId}` } });
  });
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await hear(frame).click();
  await expect(page.getByRole("alert").filter({ hasText: "read link" })).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);
  await frame
    .getByRole("button", { name: "Retry pronunciation of wear and tear", exact: true })
    .click();
  await readySpeech(page);
  expect(generations).toBe(1);
  expect(checks).toBe(0);
  expect(reads).toBe(2);
});

test("AC-D46-NOTE theme reload restores the in-flight item's busy state without another generation", async ({
  page,
}) => {
  await fixtures(page);
  let requests = 0;
  let complete = false;
  await page.route(mediaPath, (route) => {
    requests++;
    return route.fulfill({ json: { ...ready, state: "queued" } });
  });
  await page.route(
    (url) => url.pathname === `/api/media/${mediaId}`,
    (route) => route.fulfill({ json: { ...ready, state: complete ? "ready" : "processing" } }),
  );
  await page.goto("/dev/ui/study?view=notes");
  const frame = page.frameLocator(frameSelector);
  await hear(frame).click();
  const preparing = frame.getByRole("button", {
    name: "Preparing pronunciation of wear and tear",
    exact: true,
  });
  await expect(preparing).toBeDisabled();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(preparing).toBeDisabled();
  await expect(preparing).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(frameSelector)).toHaveAttribute("sandbox", "allow-scripts");
  await expect(hear(frame, "kit it out")).toBeEnabled();
  expect(requests).toBe(1);
  complete = true;
  await readySpeech(page);
  await expect(hear(frame)).toBeEnabled();
  expect(requests).toBe(1);
});

test("AC-D46-NOTE legacy notes share one player, cancel the previous item and disable speech while editing", async ({
  page,
}) => {
  await fixtures(page);
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const submitted: unknown[] = [];
  const secondId = "10000000-0000-4000-8000-000000000098";
  await page.route(mediaPath, async (route) => {
    const body = route.request().postDataJSON();
    submitted.push(body);
    if (body.learningItemId === "wear-tear") await pending;
    await route
      .fulfill({ json: { ...ready, id: body.learningItemId === "kit-out" ? secondId : mediaId } })
      .catch(() => {});
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/ui/study?view=legacy-notes");
  await expect(page.locator(frameSelector)).toHaveCount(0);
  const first = page.getByRole("button", {
    name: "Hear pronunciation of wear and tear",
    exact: true,
  });
  const second = page.getByRole("button", {
    name: "Hear pronunciation of kit it out",
    exact: true,
  });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(submitted).toHaveLength(0);
  await first.click();
  await expect(
    page.getByRole("button", { name: "Preparing pronunciation of wear and tear", exact: true }),
  ).toBeDisabled();
  await second.click();
  await readySpeech(page, "kit it out");
  release?.();
  await expect(page.locator("audio")).toHaveCount(1);
  await expect(page.locator("audio")).toHaveAttribute("aria-label", "Pronunciation of kit it out");
  expect((await events(page)).filter((event) => event.kind === "play")).toHaveLength(1);
  await second.click();
  await expect
    .poll(async () => (await events(page)).filter((event) => event.kind === "play").length)
    .toBe(2);
  expect(submitted).toEqual([
    {
      kind: "note_pronunciation",
      learningItemId: "wear-tear",
      expectedNotebookRevisionId: revisionId,
    },
    {
      kind: "note_pronunciation",
      learningItemId: "kit-out",
      expectedNotebookRevisionId: revisionId,
    },
  ]);
  await page.getByRole("button", { name: "Edit notes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^(?:Hear|Preparing|Retry) pronunciation of/ }),
  ).toHaveCount(0);
  await expect(page.locator("audio")).toHaveCount(0);
  expect(
    (await events(page)).some((event) => event.kind === "pause" && event.src.includes(secondId)),
  ).toBe(true);
  expect(submitted).toHaveLength(2);
});
