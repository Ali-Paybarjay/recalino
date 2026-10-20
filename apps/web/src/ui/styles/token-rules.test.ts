import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Audit 2026-10-18 (UI-01, UI-02, UI-03, UI-04, UI-06): the app's own CSS stays on the design
// tokens. The vendor copies are checked byte for byte in vendor.test.ts; app/recovery.module.css
// is deliberately independent of the tokens (it must render when the app cannot).
const src = resolve(import.meta.dirname, "../..");
const INDEPENDENT = new Set(["app/recovery.module.css"]);

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "vendor" ? [] : cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}
const files = cssFiles(src)
  .map((path) => ({ name: relative(src, path), text: readFileSync(path, "utf8") }))
  .filter((file) => !INDEPENDENT.has(file.name));

function offenders(pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(file.text)).map((file) => file.name);
}
function read(name: string): string {
  const file = files.find((candidate) => candidate.name === name);
  if (!file) throw new Error(`Missing ${name}`);
  return file.text;
}

describe("design token rules", () => {
  it("finds the CSS it checks", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("UI-02 keeps type at or above --rc-text-xs (12px)", () => {
    expect(offenders(/font-size:\s*(?:\d|10|11)px/)).toEqual([]);
  });

  it("UI-02 maps the parallel 13/15/18px scale to --rc-text-sm/md/read (D99)", () => {
    expect(offenders(/font-size:\s*(?:13|15|18)px/)).toEqual([]);
  });

  it("UI-04 takes shadows from the --shadow-* tokens, not a fixed black", () => {
    expect(offenders(/rgba?\(\s*0(?:\s+|\s*,\s*)0(?:\s+|\s*,\s*)0/)).toEqual([]);
  });

  it("UI-04 uses logical properties, so right-to-left text indents on the right side", () => {
    expect(offenders(/(?:padding|margin|border)-(?:left|right)\s*:/)).toEqual([]);
  });

  it("UI-04 draws one 2px focus ring", () => {
    expect(offenders(/outline:\s*(?:[3-9]|\d\d)px/)).toEqual([]);
  });

  it("UI-01 gives secondary and danger buttons a hover and an active state", () => {
    const css = read("ui/styles/app.css");
    expect(css).toMatch(
      /\[data-theme\] \.btn-secondary:hover\s*{\s*background:\s*color-mix\(in srgb, var\(--color-text\) 7%, var\(--color-surface\)\);/,
    );
    expect(css).toMatch(
      /\[data-theme\] \.btn-secondary:active\s*{\s*background:\s*color-mix\(in srgb, var\(--color-text\) 14%, var\(--color-surface\)\);/,
    );
  });

  it("UI-06 gives a small segmented option the touch-target token", () => {
    expect(read("ui/components/SegmentedControl.module.css")).toMatch(
      /\.small \.option\s*{\s*min-height:\s*var\(--rc-target\);/,
    );
  });

  it("UI-03 sizes the recording controls with --rc-target-lg and the clock with --rc-text-timer", () => {
    const css = read("ui/recording/Recording.module.css");
    expect(css).toMatch(/\.control:global\(\.btn\.rc-btn-lg\)\s*{[^}]*var\(--rc-target-lg\)/);
    expect(css).toMatch(/\.timer\s*{[^}]*var\(--rc-text-timer\)/);
  });
});
