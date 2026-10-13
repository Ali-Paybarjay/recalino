import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Notebook } from "@recalino/core/note";
import { referenceStudyModel } from "../../../packages/core/test/reference-study-fixture";
import { expectNoAxeViolations } from "./helpers";

const output = resolve(import.meta.dirname, "../../../artifacts/verification/session-notes-reader");
const sessionId = "10000000-0000-4000-8000-000000000001";
const frameSelector = 'iframe[title^="Session notes:"]';
const title = "Binomials + Hype & Scams";

async function isolated(page: Page) {
  const unexpected: string[] = [];
  await page.route("**/api/**", async (route) => {
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({
      status: 501,
      json: { error: { code: "fixture_only", message: "Unexpected fixture request." } },
    });
  });
  await page.route(`**/api/classes/${sessionId}/lesson-review?*`, (route) => {
    expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).searchParams.get("versionId")).toBe(
      "reference-knowledge",
    );
    return route.fulfill({ json: null });
  });
  await page.route("**/sessions/**", (route) => route.abort());
  await page.route("**/courses/**", (route) => route.abort());
  return unexpected;
}

for (const width of [390, 1440]) {
  test(`session notes open as a focused independent reader from a scrolled session at ${width}px`, async ({
    page,
  }) => {
    const unexpected = await isolated(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dev/ui/study?view=reader-session");
    const open = page.getByRole("link", { name: "Open session notes", exact: true });
    await open.scrollIntoViewIfNeeded();
    const priorScroll = await page.evaluate(() =>
      Math.max(window.scrollY, document.querySelector("main")?.scrollTop ?? 0),
    );
    expect(priorScroll).toBeGreaterThan(100);
    await open.click();
    await expect(page).toHaveURL(/view=reader$/);
    const heading = page.getByRole("heading", { name: title, level: 1, exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator("[data-session-reader]")).toHaveCount(1);
    await expect(
      page.getByRole("navigation", { name: "Your learning space", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Synthetic session", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("region", { name: "Session progress", exact: true })).toHaveCount(
      0,
    );
    await expect(
      page
        .getByRole("navigation", { name: "Notes navigation", exact: true })
        .getByRole("link", { name: "Back to session", exact: true }),
    ).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Edit notes", exact: true })).toBeVisible();

    const frame = page.frameLocator(frameSelector);
    await expect(frame.locator("#core .entry")).toHaveCount(3);
    await expect(page.locator(frameSelector)).toHaveAttribute("sandbox", "allow-scripts");
    await expect(page.locator(frameSelector)).not.toHaveAttribute("sandbox", /allow-same-origin/);
    // The frame reports its document height asynchronously and measures again after late layout
    // (observers, loads, fonts). Under full-suite load that layout can still grow after a first
    // read, so each check reads the content height afresh instead of comparing with one sample.
    const frameElement = page.locator(frameSelector);
    const frameSize = async () => {
      const [box, content] = await Promise.all([
        frameElement.boundingBox(),
        frame.locator("html").evaluate((element) => element.scrollHeight),
      ]);
      return { height: box?.height ?? 0, content };
    };
    await expect
      .poll(async () => {
        const { height, content } = await frameSize();
        return height - content;
      })
      .toBeGreaterThan(-5);
    // Settled: 16 consecutive frames at one height that still covers the current content. A
    // resize loop or runaway growth never gives such a window, so this fails on either; it only
    // waits out late layout rather than sampling one fixed moment.
    await expect(async () => {
      const heights = await frameElement.evaluate(async (element) => {
        const values: number[] = [];
        for (let frame = 0; frame < 16; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          values.push(element.getBoundingClientRect().height);
        }
        return values;
      });
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2);
      const { height, content } = await frameSize();
      expect(height).toBeGreaterThan(content - 5);
    }).toPass({ timeout: 10_000 });
    expect((await frameSize()).content).toBeGreaterThan(2000);
    await mkdir(output, { recursive: true });
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(frame.locator("html")).toHaveAttribute("data-theme", theme);
      await page.screenshot({
        path: resolve(output, `reader-${width}-${theme}.png`),
        fullPage: false,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await frame
          .locator("html")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await page.evaluate(() => window.scrollTo({ top: 1800, behavior: "instant" }));
    const readingPosition = await page.evaluate(() => window.scrollY);
    expect(readingPosition).toBeGreaterThan(1500);
    const priorChannel = await frame
      .locator('meta[name="recalino-notes-reader"]')
      .getAttribute("content");
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(frame.locator('meta[name="recalino-notes-reader"]')).not.toHaveAttribute(
      "content",
      priorChannel ?? "",
    );
    const positions = await page.evaluate(async () => {
      const values: number[] = [];
      for (let frame = 0; frame < 8; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        values.push(window.scrollY);
      }
      return values;
    });
    expect(
      Math.max(...positions.map((position) => Math.abs(position - readingPosition))),
    ).toBeLessThan(3);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expectNoAxeViolations(page);
    await frame.locator('nav a[href="#gap"]').click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await expect(frame.locator("#gap h2")).toBeInViewport();
    expect(await frame.locator("body").evaluate(() => window.scrollY)).toBe(0);
    const collapsedHeight = (await page.locator(frameSelector).boundingBox())?.height ?? 0;
    await frame.locator("#gap ol.gaps details summary").first().click();
    await expect(frame.locator("#gap ol.gaps details").first()).toHaveJSProperty("open", true);
    await expect
      .poll(async () => (await page.locator(frameSelector).boundingBox())?.height ?? 0)
      .toBeGreaterThan(collapsedHeight);
    await frame.locator("#gap .top").click();
    await expect(frame.locator("nav")).toBeInViewport();
    expect(await frame.locator("body").evaluate(() => window.scrollY)).toBe(0);
    await page
      .getByRole("navigation", { name: "Notes navigation", exact: true })
      .getByRole("link", { name: "Back to session", exact: true })
      .click();
    await expect(page).toHaveURL(/view=reader-session$/);
    expect(unexpected).toEqual([]);
  });
}

test("a saved read-only revision fits the reader without pronunciation or editing controls", async ({
  page,
}) => {
  const unexpected = await isolated(page);
  await page.goto("/dev/ui/study?view=reader-readonly");
  const frame = page.frameLocator(frameSelector);
  await expect(frame.locator("#core .entry")).toHaveCount(3);
  await expect(page.locator(frameSelector)).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame.locator('meta[name="recalino-pronunciation"]')).toHaveCount(0);
  await expect(frame.getByRole("button", { name: /pronunciation/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit notes", exact: true })).toHaveCount(0);
  const height = await frame.locator("html").evaluate((element) => element.scrollHeight);
  await expect
    .poll(async () => (await page.locator(frameSelector).boundingBox())?.height ?? 0)
    .toBeGreaterThan(height - 5);
  await frame.locator('nav a[href="#gap"]').click();
  await expect(frame.locator("#gap h2")).toBeInViewport();
  expect(await frame.locator("body").evaluate(() => window.scrollY)).toBe(0);
  expect(unexpected).toEqual([]);
});

test("independent reader preserves pronunciation and saved edits through an in-place refresh", async ({
  page,
}) => {
  const unexpected = await isolated(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    let blocked = false;
    HTMLMediaElement.prototype.play = function () {
      if (!blocked) {
        blocked = true;
        return Promise.reject(new DOMException("Gesture required", "NotAllowedError"));
      }
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dispatchEvent(new Event("pause"));
    };
  });
  const mediaId = "10000000-0000-4000-8000-000000000099";
  const speech: unknown[] = [];
  await page.route(`**/api/classes/${sessionId}/media`, (route) => {
    speech.push(route.request().postDataJSON());
    return route.fulfill({
      json: { id: mediaId, kind: "tts", state: "ready", mimeType: "audio/mpeg", synthetic: true },
    });
  });
  let reads = 0;
  await page.route(`**/api/media/${mediaId}/read`, (route) => {
    reads++;
    return route.fulfill({
      json: {
        url: "/synthetic-reader-audio.wav",
        validUntil: new Date(Date.now() + 60000).toISOString(),
      },
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
  await page.route("**/synthetic-reader-audio.wav", (route) =>
    route.fulfill({ contentType: "audio/wav", body: wav }),
  );
  const saves: unknown[] = [];
  await page.route(`**/api/classes/${sessionId}/notes`, async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON();
    saves.push(body);
    const model = referenceStudyModel();
    if (model.classNotes?.mistakes) model.classNotes.mistakes.speechStatus = "unverified";
    const first = model.learningItems[0];
    if (!first) throw new Error("Expected synthetic item");
    first.back = body.edits.items[first.id].back;
    const notebook: Notebook = {
      id: "reference-notebook",
      sessionId,
      proposedKnowledgeVersionId: null,
      current: {
        id: "reference-revision-2",
        notebookId: "reference-notebook",
        sessionId,
        number: 2,
        knowledgeVersionId: "reference-knowledge",
        model,
        edits: { claims: {}, items: body.edits.items },
        createdAt: "2026-10-05T13:00:00.000Z",
      },
    };
    await route.fulfill({ json: notebook });
  });
  await page.goto("/dev/ui/study?view=reader");
  const frame = page.frameLocator(frameSelector);
  const speaker = frame.getByRole("button", {
    name: "Hear pronunciation of wear and tear",
    exact: true,
  });
  await speaker.scrollIntoViewIfNeeded();
  const readingPosition = await page.evaluate(() => window.scrollY);
  await speaker.click();
  const playback = page.getByRole("complementary", { name: "Pronunciation playback", exact: true });
  const audio = playback.locator('audio[aria-label="Pronunciation of wear and tear"]');
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute("controls", "");
  await expect(audio).toBeInViewport({ ratio: 1 });
  await expect(playback.getByRole("status").filter({ hasText: "Press Play" })).toBeVisible();
  const positions = await page.evaluate(async () => {
    const values: number[] = [];
    for (let frame = 0; frame < 8; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      values.push(window.scrollY);
    }
    return values;
  });
  expect(
    Math.max(...positions.map((position) => Math.abs(position - readingPosition))),
  ).toBeLessThan(4);
  expect(speech).toEqual([
    {
      kind: "note_pronunciation",
      learningItemId: "wear-tear",
      expectedNotebookRevisionId: "reference-revision",
    },
  ]);
  await playback.getByRole("button", { name: "Close pronunciation", exact: true }).click();
  await expect(playback).toHaveCount(0);
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(speaker).toBeEnabled();
  await expect(speaker).toHaveAttribute("aria-busy", "false");
  await speaker.click();
  await expect(page.locator('audio[aria-label="Pronunciation of wear and tear"]')).toHaveCount(1);
  await expect(
    frame.getByRole("status").filter({ hasText: "Synthetic British pronunciation" }),
  ).toBeVisible();
  expect(speech).toHaveLength(1);
  expect(reads).toBe(1);
  await page.getByRole("button", { name: "Edit notes", exact: true }).click();
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.locator(frameSelector)).toHaveCount(0);
  await page.getByRole("button", { name: "Edit answer", exact: true }).first().click();
  await page.getByLabel("Your text", { exact: true }).fill("A saved synthetic answer");
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect(page.getByText("A saved synthetic answer", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Note version 2 ·/)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Notes saved." })).toBeVisible();
  expect(saves).toEqual([
    {
      expectedRevisionId: "reference-revision",
      edits: { items: { "wear-tear": { back: "A saved synthetic answer" } } },
    },
  ]);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await expect(page.locator(frameSelector)).toBeVisible();
  await expect(page.getByRole("heading", { name: title, level: 1, exact: true })).toHaveCount(1);
  expect(speech).toHaveLength(1);
  await speaker.click();
  await expect(
    frame.getByRole("status").filter({ hasText: "Synthetic British pronunciation" }),
  ).toBeVisible();
  expect(speech).toHaveLength(2);
  expect(speech[1]).toEqual({
    kind: "note_pronunciation",
    learningItemId: "wear-tear",
    expectedNotebookRevisionId: "reference-revision-2",
  });
  expect(reads).toBe(2);
  expect(unexpected).toEqual([]);
});
