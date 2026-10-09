import { expect, test } from "@playwright/test";
import type { VoiceProfileView } from "@recalino/core/voice-contracts";

const notes = "/classes/10000000-0000-4000-8000-000000000001/notes";
const profile: VoiceProfileView = {
  enabled: false,
  consentVersion: null,
  enrolled: false,
  sampleDurationMs: null,
  modelVersion: null,
  confirmedLessons: 0,
  engineAvailable: true,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me/voice", (route) => route.fulfill({ json: profile }));
});

test("voice settings opened from class notes offers a return to those notes (FR-VOC-001)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dev/ui/voice?returnTo=${encodeURIComponent(notes)}`);
  await expect(
    page.getByRole("link", { name: "Back to session notes", exact: true }),
  ).toHaveAttribute("href", notes);
  await expect(page.getByRole("link", { name: "Back to settings", exact: true })).toHaveCount(0);
});

test("voice settings opened from the account returns to account settings (FR-VOC-001)", async ({
  page,
}) => {
  await page.goto("/dev/ui/voice");
  await expect(page.getByRole("link", { name: "Back to settings", exact: true })).toHaveAttribute(
    "href",
    "/me",
  );
  await expect(page.getByRole("link", { name: "Back to session notes", exact: true })).toHaveCount(
    0,
  );
});

test("untrusted voice settings return destinations fall back to account settings (FR-VOC-001)", async ({
  page,
}) => {
  await page.goto(`/dev/ui/voice?returnTo=${encodeURIComponent("https://elsewhere.example")}`);
  await expect(page.getByRole("link", { name: "Back to settings", exact: true })).toHaveAttribute(
    "href",
    "/me",
  );
});
