import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// P11-02 AC-14, AC-15 and AC-17 (E321, E322-R, E334-R): the test-only JobContext marker never
// reaches production. Every non-test file under packages/** and apps/** is searched; a reference
// to the marker, its symbol key or its helper module turns this red, except the one read site
// (READ_SITE), which may only read it. Only the files of the closed list may set it.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SEARCHED = ["packages", "apps"];
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  "coverage",
]);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** The helper module that sets the marker (test code only). */
const MARKER_MODULE = "packages/core/test/test-only-job-context.ts";
/** The one production file that reads the marker, through its one exported read function. */
const READ_SITE = "packages/core/src/plt/storage.ts";
/** Anything that names the marker: its module or symbol key, its setter, or its key constant. */
const MARKER_REFERENCE = /test-only-job-context|\btestOnlyJobContext\b|\bTEST_ONLY_JOB_CONTEXT\b/;

/** Support files that are test code although neither *.test.ts nor under packages/core/test. */
const TEST_SUPPORT_FILES = ["apps/web/src/server/audio-audit-support.ts"];

/** AC-17: the closed list of files that may set the marker on a hand-made JobContext. */
const CLOSED_LIST = [
  "apps/web/src/server/audio-audit-support.ts",
  "apps/web/src/server/audio-retry-audit.int.test.ts",
  "apps/web/src/server/audio-upload-audit.int.test.ts",
  "apps/web/src/server/automatic-learning.int.test.ts",
  "apps/web/src/server/privacy-composition.int.test.ts",
  "apps/web/src/server/upload-batch-recovery.int.test.ts",
  "packages/core/src/eval/lesson-review-service.int.test.ts",
  "packages/core/src/plt/notifications.int.test.ts",
  "packages/core/src/priv/media.int.test.ts",
  "packages/core/src/priv/org-cleanup.int.test.ts",
  "packages/core/src/proc/capture-transcription.int.test.ts",
  "packages/core/src/proc/knowledge-repair.int.test.ts",
  "packages/core/src/proc/knowledge-study-repair.int.test.ts",
  "packages/core/src/proc/knowledge-translation.int.test.ts",
  "packages/core/src/proc/recovery.int.test.ts",
  "packages/core/src/proc/study-output-guard.int.test.ts",
  "packages/core/src/proc/transcription-parallel.int.test.ts",
  "packages/core/src/proc/processing.int.test.ts",
  "packages/core/src/proc/knowledge-input.int.test.ts",
  "packages/core/src/proc/knowledge-response-budget.int.test.ts",
  "packages/core/src/proc/transcription-timing.int.test.ts",
  "packages/core/src/proc/audio-charged-material.int.test.ts",
  "packages/core/src/proc/steps/runtime.test.ts",
  "packages/core/src/proc/steps/study-output.test.ts",
  "packages/core/test/processing-run.ts",
  "packages/core/test/processing-jobs.ts",
];

interface SourceFile {
  path: string;
  text: string;
}

function sourceFiles(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name));
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        const absolute = join(directory, entry.name);
        files.push({
          path: relative(ROOT, absolute).split("\\").join("/"),
          text: readFileSync(absolute, "utf8"),
        });
      }
    }
  };
  for (const top of SEARCHED) walk(join(ROOT, top));
  return files;
}

/** A test file: *.test.ts (and *.int.test.ts), anything under packages/core/test, or a support file. */
function isTestFile(path: string): boolean {
  return (
    /\.test\.tsx?$/.test(path) ||
    path.startsWith("packages/core/test/") ||
    TEST_SUPPORT_FILES.includes(path)
  );
}

/** The non-test files that name the marker, other than the read site. */
function productionReferences(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => !isTestFile(file.path) && file.path !== READ_SITE)
    .filter((file) => MARKER_REFERENCE.test(file.text))
    .map((file) => file.path)
    .sort();
}

/** The read site only reads: one symbol key, no import of the helper, no setter, no write. */
function readSiteProblems(text: string): string[] {
  const problems: string[] = [];
  const keys = text.match(/Symbol\.for\("recalino\.test-only-job-context"\)/g) ?? [];
  if (keys.length !== 1) problems.push(`symbol key ${keys.length} times`);
  if (/from\s+["'][^"']*test-only-job-context["']/.test(text)) problems.push("imports the helper");
  if (/\btestOnlyJobContext\b/.test(text)) problems.push("names the setter");
  if (/\[\s*TEST_ONLY_JOB_CONTEXT\s*\]\s*=(?!=)/.test(text)) problems.push("assigns the marker");
  if (/defineProperty|Reflect\.set|Object\.assign/.test(text)) problems.push("may set a property");
  if (/export\s+(?:const|let|var)\s+TEST_ONLY_JOB_CONTEXT/.test(text))
    problems.push("exports the key");
  return problems;
}

/** Test files that set the marker but are not in the closed list (the helper module aside). */
function unlistedTestUsers(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => isTestFile(file.path) && file.path !== MARKER_MODULE)
    .filter((file) => /\btestOnlyJobContext\b|test-only-job-context/.test(file.text))
    .map((file) => file.path)
    .filter((path) => !CLOSED_LIST.includes(path))
    .sort();
}

describe("P11-02 the test-only JobContext marker stays out of production", () => {
  const files = sourceFiles();

  it("searches the packages and apps sources, including the read site and the helper", () => {
    const paths = new Set(files.map((file) => file.path));
    expect(files.length).toBeGreaterThan(100);
    expect(paths.has(READ_SITE)).toBe(true);
    expect(paths.has(MARKER_MODULE)).toBe(true);
  });

  it("no non-test file names the marker or imports its module, except the one read site", () => {
    expect(productionReferences(files)).toEqual([]);
  });

  it("the read site only reads the marker, through one exported read function", () => {
    const readSite = files.find((file) => file.path === READ_SITE);
    expect(readSiteProblems(readSite?.text ?? "")).toEqual([]);
    expect(readSite?.text).toMatch(/export function isTestOnlyJobContext\(/);
  });

  it("only the files of the closed list set the marker", () => {
    expect(unlistedTestUsers(files)).toEqual([]);
  });

  it("each test support file outside *.test.ts is imported by test files only", () => {
    for (const support of TEST_SUPPORT_FILES) {
      const name = support.slice(support.lastIndexOf("/") + 1).replace(/\.ts$/, "");
      const importers = files
        .filter((file) => file.path !== support && !isTestFile(file.path))
        .filter((file) => new RegExp(`["'][^"']*/${name}(?:\\.ts)?["']`).test(file.text))
        .map((file) => file.path);
      expect(importers, support).toEqual([]);
    }
  });

  it("turns red on a production use of the marker", () => {
    const fabricated: SourceFile[] = [
      ...files,
      {
        path: "packages/core/src/proc/fabricated.ts",
        text: 'import { testOnlyJobContext } from "../../test/test-only-job-context";\n',
      },
      {
        path: "apps/web/src/server/fabricated.ts",
        text: 'Symbol.for("recalino.test-only-job-context")',
      },
    ];
    expect(productionReferences(fabricated)).toEqual([
      "apps/web/src/server/fabricated.ts",
      "packages/core/src/proc/fabricated.ts",
    ]);
    expect(
      readSiteProblems("export function isTestOnlyJobContext(job: object) { return true; }"),
    ).toEqual(["symbol key 0 times"]);
    expect(
      unlistedTestUsers([
        { path: "packages/core/src/anki/fabricated.int.test.ts", text: "testOnlyJobContext({})" },
      ]),
    ).toEqual(["packages/core/src/anki/fabricated.int.test.ts"]);
  });
});
