import { describe, expect, it } from "vitest";
import { voiceSettingsHref, voiceSettingsReturnHref } from "./navigation";

const sessionId = "10000000-0000-4000-8000-000000000001";
const notes = `/classes/${sessionId}/notes`;

describe("voice settings return destination (FR-VOC-001)", () => {
  it("retains the originating class notes through the settings URL", () => {
    const settings = new URL(voiceSettingsHref(sessionId), "https://recalino.example");
    expect(settings.pathname).toBe("/me/voice");
    expect(voiceSettingsReturnHref(settings.searchParams.get("returnTo") ?? undefined)).toBe(notes);
  });

  it.each([
    undefined,
    [notes, "/me"],
    "https://elsewhere.example/notes",
    "//elsewhere.example/notes",
    "javascript:alert(1)",
    "/me/voice",
    `/classes/${sessionId}`,
    `${notes}/../../sources`,
    `${notes}?returnTo=//elsewhere.example`,
  ])("uses ordinary account settings for an invalid return destination: %s", (value) => {
    expect(voiceSettingsReturnHref(value)).toBe("/me");
  });
});
