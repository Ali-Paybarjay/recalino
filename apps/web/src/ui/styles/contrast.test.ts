import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A11Y-01 (D99, WCAG 1.4.11): the border of a form control (text field, checkbox, radio, switch)
// has at least 3:1 contrast against every surface it sits on, in both themes. The values are read
// from app.css, which overrides the design tokens; the vendor copies stay untouched.
const css = readFileSync(resolve(import.meta.dirname, "app.css"), "utf8");

/** The custom properties set for one theme in app.css, from every block of that selector. */
function themeTokens(theme: "light" | "dark"): Record<string, string> {
  const tokens: Record<string, string> = {};
  const blocks = new RegExp(`:root\\[data-theme="${theme}"\\]\\s*{([^}]*)}`, "g");
  for (const block of css.matchAll(blocks)) {
    for (const [, name, value] of (block[1] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g))
      tokens[name as string] = (value as string).trim();
  }
  return tokens;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rrggbb colour (WCAG 2.2). */
function luminance(hex: string): number {
  expect(hex, "a six-digit hex colour").toMatch(/^#[0-9a-f]{6}$/i);
  const [r, g, b] = [1, 3, 5].map((at) => channel(Number.parseInt(hex.slice(at, at + 2), 16)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light as number) + 0.05) / ((dark as number) + 0.05);
}

// The page, a card or field, the switch track and selected rows: every fill the token borders.
const SURFACES = ["--color-bg", "--color-surface", "--rc-surface-2", "--rc-primary-tint"];

describe("form control borders (A11Y-01)", () => {
  it("computes contrast as WCAG does", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // The audit's figures for the old light value and the divider.
    expect(contrast("#8c9c91", "#f6f7f2")).toBeCloseTo(2.68, 2);
    expect(contrast("#dce3d9", "#ffffff")).toBeCloseTo(1.31, 2);
  });

  it.each(["light", "dark"] as const)(
    "--rc-border-strong reaches 3:1 on every %s surface",
    (theme) => {
      const tokens = themeTokens(theme);
      const border = tokens["--rc-border-strong"] as string;
      for (const surface of SURFACES) {
        const fill = tokens[surface] as string;
        expect(contrast(border, fill), `${border} on ${surface} ${fill}`).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("keeps the approved values: light darkened in the same hue, dark unchanged (D99)", () => {
    expect(themeTokens("light")["--rc-border-strong"]).toBe("#7a8d80");
    expect(themeTokens("dark")["--rc-border-strong"]).toBe("#7e9685");
  });

  it("draws a text field's border with the token, not the 1.31:1 divider", () => {
    expect(css).toMatch(/\n\.input\s*{\s*border-color:\s*var\(--rc-border-strong\);\s*}/);
  });
});
