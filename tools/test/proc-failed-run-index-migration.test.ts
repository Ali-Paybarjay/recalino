import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P2-02: the failed-run count of the health check (packages/core/src/proc/run-health.ts) filters
// proc.processing_run on state = 'failed' and a finished_at range. This test only reads the text of
// the migration that adds the supporting partial index; it never runs SQL or changes a file.

const root = resolve(import.meta.dirname, "../..");
const MIGRATION = "supabase/migrations/20261104130000_proc_failed_run_finished_at_index.sql";

/** The migration without `--` comments, with whitespace collapsed and lower-cased. */
function migrationStatements(): string[] {
  const text = readFileSync(resolve(root, MIGRATION), "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return text
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

describe("migration 20261104130000_proc_failed_run_finished_at_index", () => {
  it("has exactly one statement: a partial create index if not exists on proc.processing_run (finished_at) where state = 'failed'", () => {
    const statements = migrationStatements();
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /^create index if not exists [a-z_][a-z0-9_]* on proc\.processing_run \(finished_at\) where state = 'failed'$/,
    );
  });

  it("has no destructive, concurrent, permission or data statement", () => {
    const raw = readFileSync(resolve(root, MIGRATION), "utf8").toLowerCase();
    for (const word of [
      "drop",
      "alter",
      "truncate",
      "delete",
      "update",
      "insert",
      "grant",
      "revoke",
      "concurrently",
    ]) {
      expect(raw, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});
