import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// R-29 (RR-30, ARCH-F-11): runtime server code never imports a value from the UI layer.
// Interim stand-in for the depcruise rule `web-server-not-to-ui` until it lands in
// .dependency-cruiser.cjs. Only `import type` / `export type` may cross the line: under
// verbatimModuleSyntax an import whose specifiers are all inline `type` still loads the module.
const server = import.meta.dirname;
const ui = resolve(server, "../ui");
const SOURCE = /\.(?:ts|tsx|mts|mjs|js|cjs)$/;

/** Test files and test support are exempt, by explicit rule (relative to src/server, "/" separated). */
const EXCEPTIONS: { rule: string; pattern: RegExp }[] = [
  { rule: "*.test.ts (includes *.int.test.ts)", pattern: /\.test\.ts$/ },
  { rule: "*-support.ts", pattern: /-support\.ts$/ },
  { rule: "cross-account/**", pattern: /^cross-account\// },
];

function exception(path: string): string | null {
  return EXCEPTIONS.find(({ pattern }) => pattern.test(path))?.rule ?? null;
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return SOURCE.test(entry.name) ? [relative(server, path).split(sep).join("/")] : [];
  });
}

/** Blank out comments while keeping line numbers. */
function withoutComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (_, lead) => lead);
}

function intoUi(from: string, specifier: string): boolean {
  if (specifier === "@/ui" || specifier.startsWith("@/ui/")) return true;
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(from), specifier);
  return target === ui || target.startsWith(ui + sep);
}

/** Value (runtime) import edges from `from` (absolute path) into src/ui, with 1-based line numbers. */
function valueUiImports(from: string, source: string): { line: number; specifier: string }[] {
  const code = withoutComments(source);
  const found: { line: number; specifier: string }[] = [];
  const patterns = [
    // import x from / import { a } from / export { a } from / export * from — `type` keyword marks type-only.
    /^[ \t]*(?:import|export)\s+(type\s+)?(?:[^"'`;]*?\bfrom\s*)?["']([^"']+)["']/gm,
    // dynamic import(), require(); `typeof import()` is a type position.
    /(typeof\s+)?\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2];
      if (match[1] || !specifier || !intoUi(from, specifier)) continue;
      found.push({ line: code.slice(0, match.index).split("\n").length, specifier });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

describe("server never imports a value from ui (R-29)", () => {
  const all = walk(server);
  const scanned = all.filter((path) => exception(path) === null);

  it("scans the runtime server files, nested folders included, and skips only listed exceptions", () => {
    expect(scanned).toEqual(
      expect.arrayContaining([
        "recording-routes.ts",
        "automatic-learning.ts",
        "admin-routes.ts",
        "auth/flow.ts",
        "voice-engine-worker.mjs",
      ]),
    );
    expect(scanned.some((path) => path.endsWith(".test.ts"))).toBe(false);
    expect(scanned.some((path) => path.startsWith("cross-account/"))).toBe(false);
    for (const { rule, pattern } of EXCEPTIONS) {
      expect(
        all.some((path) => pattern.test(path)),
        `exception ${rule} matches nothing`,
      ).toBe(true);
    }
  });

  it.each(scanned.map((path) => [path]))("%s imports no value from ui", (path) => {
    const absolute = join(server, path);
    expect(valueUiImports(absolute, readFileSync(absolute, "utf8"))).toEqual([]);
  });

  it("catches a synthetic value import and lets type-only imports through", () => {
    const from = join(server, "synthetic.ts");
    const nested = join(server, "auth/synthetic.ts");
    const source = [
      'import type { Recording } from "../ui/recording/store";',
      'export type { AdminResult } from "../ui/admin/contracts";',
      'type Lazy = typeof import("../ui/workspace/api");',
      '// import { gone } from "../ui/commented";',
      'import { uploadCopy } from "../ui/workspace/upload-copy";',
      'import { type AudioUploadReason } from "../ui/workspace/upload-problems";',
      "import {",
      "  systemHealthCopy,",
      '} from "@/ui/admin/copy";',
      'import "../ui/side-effect";',
      'export * from "../ui/workspace/session-state";',
      'const later = await import("../ui/workspace/automatic-learning");',
      'import { allowed } from "../shared/upload-copy";',
      'import { uiLike } from "./ui/not-the-layer";',
    ].join("\n");
    expect(valueUiImports(from, source)).toEqual([
      { line: 5, specifier: "../ui/workspace/upload-copy" },
      { line: 6, specifier: "../ui/workspace/upload-problems" },
      { line: 7, specifier: "@/ui/admin/copy" },
      { line: 10, specifier: "../ui/side-effect" },
      { line: 11, specifier: "../ui/workspace/session-state" },
      { line: 12, specifier: "../ui/workspace/automatic-learning" },
    ]);
    expect(valueUiImports(nested, 'import { flow } from "../../ui/auth/flow";')).toEqual([
      { line: 1, specifier: "../../ui/auth/flow" },
    ]);
    expect(valueUiImports(nested, 'import type { Flow } from "../../ui/auth/flow";')).toEqual([]);
  });
});
