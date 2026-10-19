import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// QUA-02 (docs/audit/2026-10-18-project-audit.md): every environment variable name the shipped code
// reads must be listed, as a name only, in `.env.example` (PROJECT_SPEC §8), unless it is on the
// documented exception list below. A new variable therefore cannot reach production unlisted.

const root = resolve(import.meta.dirname, "..");
const scannedDirectories = ["apps/web/src", "packages/core/src", "tools"];
const sourceFile = /\.(?:[cm]?[jt]s|tsx)$/;

/** Not shipped code: tests, test helpers, fixtures, generated output and the dependency tree. */
function skipped(path: string): boolean {
  const parts = path.split(sep);
  return (
    /\.test\.[cm]?[jt]sx?$/.test(path) ||
    path.endsWith(".d.ts") ||
    parts.some((part) =>
      ["node_modules", ".next", "test", "tests", "fixture", "fixtures"].includes(part),
    )
  );
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (skipped(relative(root, path))) continue;
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (sourceFile.test(entry.name)) found.push(path);
  }
  return found;
}

/** Names read from `process.env`, from an `env` parameter, or declared in a zod env schema. */
const readers = [
  /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g,
  /\bprocess\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
  /\benv\??\.([A-Z][A-Z0-9_]{2,})\b/g,
  /\benv\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
  /^\s*([A-Z][A-Z0-9_]{2,}):\s*z\./gm,
];

function namesRead(): Map<string, string> {
  const names = new Map<string, string>();
  for (const directory of scannedDirectories) {
    for (const file of sourceFiles(join(root, directory))) {
      const text = readFileSync(file, "utf8");
      for (const reader of readers)
        for (const match of text.matchAll(reader))
          if (!names.has(match[1] as string)) names.set(match[1] as string, relative(root, file));
    }
  }
  return names;
}

/** `NAME=` lines of `.env.example`; comments, including commented-out names, do not count. */
function namesListed(): Set<string> {
  const text = readFileSync(join(root, ".env.example"), "utf8");
  return new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] as string));
}

/**
 * Names the code reads that `.env.example` deliberately does not list. Keep this short: a name
 * belongs here only when a developer never sets it in `apps/web/.env.local` or in Vercel by hand.
 */
const exceptions: Record<string, string> = {
  // Set by Node, Next.js, the CI runner or the host, never by the operator.
  NODE_ENV: "set by Node and Next.js",
  CI: "set by GitHub Actions and most CI runners",
  HTTPS_PROXY: "standard proxy variable, read by tools/db-apply for the cloud environment",
  https_proxy: "standard proxy variable (lower case form)",
  // Operator tools run from a terminal, not application configuration.
  VERCEL_CLI_ENTRY: "tools/configure-runtime-env.mjs: path of the installed Vercel CLI entry point",
  DB_TYPES_URL: "tools/db-types.mjs: optional override of the local database used for db:types",
  // Local test switch: only honoured outside Vercel (apps/web/src/server/local-test-policy.ts).
  RECALINO_TEST_JOURNAL: "local end-to-end test switch; never set in a deployed environment",
};
/** Host-provided family: every Vercel system variable. */
const exceptionPrefixes = ["VERCEL"];

const isException = (name: string) =>
  name in exceptions || exceptionPrefixes.some((prefix) => name.startsWith(prefix));

describe("QUA-02 .env.example lists every variable the code reads", () => {
  it("finds the variables it is meant to guard", () => {
    const names = namesRead();
    // Guards the scanner itself: if a pattern stops matching, the comparison below passes vacuously.
    for (const expected of [
      "SUPABASE_URL",
      "RATE_LIMIT_IP_KEY",
      "OPENROUTER_API_KEY",
      "BLOB_READ_WRITE_TOKEN",
      "VOICE_SETTINGS_JSON",
      "RECALINO_CAPTURE_EARLY_UPLOAD",
    ])
      expect(names.has(expected), expected).toBe(true);
  });

  it("has an entry for every name read in shipped code", () => {
    const listed = namesListed();
    const missing = [...namesRead()]
      .filter(([name]) => !listed.has(name) && !isException(name))
      .map(([name, file]) => `${name} (read in ${file})`);
    expect(missing, "add the name to .env.example with a one-line comment").toEqual([]);
  });

  it("lists each name once and never writes a value", () => {
    const text = readFileSync(join(root, ".env.example"), "utf8");
    const lines = [...text.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)];
    const names = lines.map((line) => line[1]);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    expect(lines.filter((line) => (line[2] ?? "").trim() !== "").map((line) => line[1])).toEqual(
      [],
    );
  });
});
