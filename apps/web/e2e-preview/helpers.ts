import { test as base, expect } from "@playwright/test";

export { expect } from "@playwright/test";
export { expectNoAxeViolations, VIEWPORTS } from "../e2e/helpers";

export const SAMPLE_BANNER = "Sample workspace — changes affect this preview only";
export const STORAGE_KEY = "recalino-ui-preview-v1";

type InstrumentedWindow = Window & { __reportPreviewMediaCapture: () => Promise<void> };

/** Fresh contexts may need a deployment-specific Vercel share-link cookie first. */
export const test = base.extend<{ previewIsolation: undefined }>({
  previewIsolation: [
    async ({ page, context, baseURL }, use) => {
      const unexpectedRequests: string[] = [];
      let mediaCalls = 0;
      await context.exposeBinding("__reportPreviewMediaCapture", () => {
        mediaCalls += 1;
      });
      await context.addInitScript(() => {
        const state = window as unknown as InstrumentedWindow;
        if (navigator.mediaDevices) {
          navigator.mediaDevices.getUserMedia = async () => {
            await state.__reportPreviewMediaCapture();
            throw new Error("The synthetic preview must not capture microphone or camera input.");
          };
        }
      });

      const accessURL = process.env.RECALINO_PREVIEW_ACCESS_URL;
      if (accessURL) {
        await page.goto(accessURL);
        await expect(page.getByText(SAMPLE_BANNER, { exact: true })).toBeVisible();
      }

      const health = await context.request.get("/api/health");
      expect(health.ok(), "fixture target must expose its isolated health response").toBe(true);
      expect(await health.json(), "refusing to test a target without the fixture guard").toEqual({
        status: "ok",
        mode: "ui-preview",
      });

      const origin = new URL(baseURL ?? "http://localhost").origin;
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (!["http:", "https:"].includes(url.protocol)) return;
        // Deployment protection may inject its own feedback toolbar.
        if (url.hostname === "vercel.live") return;
        if (url.origin !== origin || /^\/(?:api|auth)(?:\/|$)/.test(url.pathname)) {
          // Query strings can contain protection credentials; retain the path only.
          unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
        }
      });

      await use(undefined);

      expect(unexpectedRequests, "fixture UI requested a real backend or external service").toEqual(
        [],
      );
      expect(mediaCalls, "fixture UI requested real microphone or camera capture").toBe(0);
      expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"))).toEqual(
        [],
      );
    },
    { auto: true },
  ],
});
