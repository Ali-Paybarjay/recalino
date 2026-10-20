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

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  expect(hex, "a six-digit hex colour").toMatch(/^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as Rgb;
}

/** Relative luminance of a #rrggbb colour or an sRGB triple (WCAG 2.2). */
function luminance(colour: string | Rgb): number {
  const [r, g, b] = (typeof colour === "string" ? rgb(colour) : colour).map(channel);
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string | Rgb, b: string | Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light as number) + 0.05) / ((dark as number) + 0.05);
}

/** `color-mix(in srgb, a weight%, b)`: the browser mixes the encoded sRGB channels. */
function mix(a: string, weight: number, b: string): Rgb {
  const [from, to] = [rgb(a), rgb(b)];
  return from.map((value, at) => value * weight + (to[at] as number) * (1 - weight)) as Rgb;
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

// D101 (owner decision 2026-10-20, A11Y-01 follow-up): the base layer's hover border is 45% of the
// text colour over the field (vendor/nocturne-base.css), which in the light theme is lighter than the
// 3:1 border token, so pointing at a field faded its edge (2.62:1 on white). app.css mixes the same
// share of the text colour into the border token instead, in the light theme only.
describe("a hovered text field's border (A11Y-01, D101)", () => {
  const vendor = readFileSync(resolve(import.meta.dirname, "vendor/nocturne-base.css"), "utf8");
  const light = themeTokens("light");
  const token = (name: string) => light[name] as string;
  const HOVER =
    /:where\(:root\[data-theme="light"\]\) \.input:hover:where\(:not\(:focus-visible\)\)\s*{\s*border-color:\s*color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\);\s*}/;

  /** The colour a hovered field's border shows in the light theme. */
  function hoverBorder(): Rgb {
    const own = css.match(HOVER);
    if (own) return mix(token(own[1] as string), Number(own[2]) / 100, token(own[3] as string));
    // Without a rule in app.css the base layer's hover applies, laid over the field's surface.
    const base = vendor.match(
      /\.input:hover\s*{\s*border-color:\s*color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, transparent\);/,
    );
    expect(base, "the base layer's hover rule").not.toBeNull();
    const [, text, share] = base as RegExpMatchArray;
    return mix(token(text as string), Number(share) / 100, token("--color-surface"));
  }

  it("records why: the base layer's hover is lighter than the border token in the light theme", () => {
    const base = mix(token("--color-text"), 0.45, token("--color-surface"));
    expect(contrast(base, token("--color-surface"))).toBeCloseTo(2.62, 2);
    expect(luminance(base)).toBeGreaterThan(luminance(token("--rc-border-strong")));
  });

  it("is at least as dark as the normal border, and 3:1 on every light surface", () => {
    const hover = hoverBorder();
    expect(luminance(hover)).toBeLessThanOrEqual(luminance(token("--rc-border-strong")));
    for (const surface of SURFACES) {
      const fill = token(surface);
      expect(contrast(hover, fill), `hover border on ${surface} ${fill}`).toBeGreaterThanOrEqual(
        contrast(token("--rc-border-strong"), fill),
      );
      expect(contrast(hover, fill)).toBeGreaterThanOrEqual(3);
    }
  });

  it("mixes 45% of the text colour into the border token, in the light theme only", () => {
    expect(css.match(HOVER)?.slice(1, 4)).toEqual(["--color-text", "45", "--rc-border-strong"]);
    expect(css).not.toMatch(/data-theme="dark"[^{]*\.input:hover/);
  });

  it("keeps the base layer's specificity, so focus and an invalid field still win", () => {
    const hover = css.search(HOVER);
    const invalid = css.indexOf('.input[aria-invalid="true"]');
    expect(hover).toBeGreaterThan(-1);
    expect(hover).toBeLessThan(invalid);
  });
});
