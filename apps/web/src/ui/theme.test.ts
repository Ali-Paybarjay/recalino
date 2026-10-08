import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_COLORS, THEME_SCRIPT } from "./theme";

const tokens = readFileSync(resolve(import.meta.dirname, "styles/app.css"), "utf8");

function colorBg(selector: string): string | undefined {
  const start = tokens.indexOf(selector);
  const block = tokens.slice(start, tokens.indexOf("}", start));
  return /--color-bg:\s*(#[0-9a-f]{6})/i.exec(block)?.[1];
}

type Listener = () => void;

function runThemeScript(prefersDark: boolean) {
  const attributes = new Map<string, string>();
  let listener: Listener | undefined;
  const media = {
    matches: prefersDark,
    addEventListener: (_: string, fn: Listener) => {
      listener = fn;
    },
  };
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
  };
  const window = { matchMedia: () => media };
  new Function("window", "document", THEME_SCRIPT)(window, document);
  return { attributes, media, change: () => listener?.() };
}

describe("theme", () => {
  it("uses the page background colours of the current redesign", () => {
    expect(colorBg(':root[data-theme="light"]')).toBe(THEME_COLORS.light);
    expect(colorBg(':root[data-theme="dark"]')).toBe(THEME_COLORS.dark);
  });

  it("follows the OS colour scheme and its later changes", () => {
    const light = runThemeScript(false);
    expect(light.attributes.get("data-theme")).toBe("light");

    const dark = runThemeScript(true);
    expect(dark.attributes.get("data-theme")).toBe("dark");
    dark.media.matches = false;
    dark.change();
    expect(dark.attributes.get("data-theme")).toBe("light");
  });

  it("falls back to light when the browser cannot tell", () => {
    const attributes = new Map<string, string>();
    const document = {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    };
    new Function("window", "document", THEME_SCRIPT)({}, document);
    expect(attributes.get("data-theme")).toBe("light");
  });
});
