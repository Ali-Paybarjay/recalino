import { describe, expect, it } from "vitest";
import { directionOf } from "./direction";

describe("directionOf", () => {
  it.each(["fa", "ar", "ur", "he", "ps", "fa-IR", "AR-eg"])("%s is right-to-left", (lang) => {
    expect(directionOf(lang)).toBe("rtl");
  });

  it.each(["en", "ru", "ja", "zh-Hans", "zh-Hant", "es-MX", "uk", "ro", "de", "it"])(
    "%s is left-to-right",
    (lang) => {
      expect(directionOf(lang)).toBe("ltr");
    },
  );

  it("follows an explicit script subtag", () => {
    expect(directionOf("pa-Arab")).toBe("rtl");
    expect(directionOf("az-Latn")).toBe("ltr");
    expect(directionOf("ku-Arab-IQ")).toBe("rtl");
  });
});
