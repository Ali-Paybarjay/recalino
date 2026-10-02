import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_VERSIONS, DOCUMENTS } from "./documents";
import { FIRST_LANGUAGES, isFirstLanguage, languageTier } from "./languages";
import { profileChangeSchema } from "./profile";
import { DEFAULT_ACC_SETTINGS, readAccSettings } from "./settings";

describe("first languages (D31)", () => {
  it("offer every pilot language, Chinese in both scripts, and not English", () => {
    for (const code of [
      "ru",
      "ja",
      "zh-Hans",
      "zh-Hant",
      "fa",
      "ar",
      "es",
      "de",
      "it",
      "ro",
      "uk",
    ]) {
      expect(isFirstLanguage(code), code).toBe(true);
    }
    expect(isFirstLanguage("en")).toBe(false);
    expect(isFirstLanguage("zh")).toBe(false);
    expect(new Set(FIRST_LANGUAGES).size).toBe(FIRST_LANGUAGES.length);
  });

  it("are experimental until they pass the quality check", () => {
    expect(languageTier("fa", DEFAULT_ACC_SETTINGS.verifiedLanguages)).toBe("experimental");
    expect(languageTier("fa", ["fa"])).toBe("verified");
  });
});

describe("ACC settings", () => {
  it("default to no verified language and a ten-minute sign-in window", () => {
    expect(readAccSettings({})).toEqual({ verifiedLanguages: [], signupIntentTtlSeconds: 600 });
  });

  it("take overrides from ACC_SETTINGS_JSON and refuse bad values", () => {
    expect(readAccSettings({ ACC_SETTINGS_JSON: '{"verifiedLanguages":["fa"]}' })).toEqual({
      verifiedLanguages: ["fa"],
      signupIntentTtlSeconds: 600,
    });
    expect(() => readAccSettings({ ACC_SETTINGS_JSON: '{"signupIntentTtlSeconds":5}' })).toThrow();
  });
});

describe("text versions", () => {
  it("match the version table of docs/legal/consents.md", () => {
    const table = readFileSync(
      resolve(import.meta.dirname, "../../../../docs/legal/consents.md"),
      "utf8",
    );
    for (const document of DOCUMENTS) {
      const row = new RegExp(`\\|\\s*\`${document}\`\\s*\\|\\s*([0-9.]+)\\s*\\|`).exec(table);
      expect(row?.[1], document).toBe(CURRENT_VERSIONS[document]);
    }
  });
});

describe("profile changes", () => {
  it("accept the setup answers and refuse anything else", () => {
    expect(
      profileChangeSchema.safeParse({ field: "level_goal", level: null, goal: "ielts" }).success,
    ).toBe(true);
    expect(
      profileChangeSchema.safeParse({ field: "level_goal", level: "B3", goal: null }).success,
    ).toBe(false);
    expect(
      profileChangeSchema.safeParse({ field: "explanation_language", explanationLanguage: "fa" })
        .success,
    ).toBe(false);
    expect(profileChangeSchema.safeParse({ field: "learning_language", value: "fr" }).success).toBe(
      false,
    );
  });
});
