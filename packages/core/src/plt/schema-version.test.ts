// OPS-05 (audit 2026-10-18): the runner does no work on a database that lacks a migration the
// code needs, and says so; equal or newer schemas, and an unreadable version, change nothing.
import { describe, expect, it } from "vitest";
import type { Database } from "../db";
import { compareSchemaVersions, createSchemaGuard } from "./schema-version";

const EXPECTED = "20261015120000";
const db = {} as Database;

function guard(applied: string | null | Error, raised: boolean[] = []) {
  const lines: Record<string, unknown>[] = [];
  let reads = 0;
  let clock = 0;
  const instance = createSchemaGuard({
    expected: EXPECTED,
    log: (level, event, fields) => lines.push({ level, event, ...fields }),
    now: () => clock,
    read: async () => {
      reads += 1;
      if (applied instanceof Error) throw applied;
      return applied;
    },
    raise: async () => {
      raised.push(true);
      return raised.length === 1;
    },
  });
  return {
    instance,
    lines,
    reads: () => reads,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("OPS-05 schema version guard", () => {
  it("compares 14-digit migration versions", () => {
    expect(compareSchemaVersions(EXPECTED, EXPECTED)).toBe("current");
    expect(compareSchemaVersions(EXPECTED, "20261016000000")).toBe("ahead");
    expect(compareSchemaVersions(EXPECTED, "20261014120000")).toBe("behind");
    expect(compareSchemaVersions(EXPECTED, null)).toBe("unknown");
    expect(compareSchemaVersions(EXPECTED, "not-a-version")).toBe("unknown");
  });

  it("refuses work on a database that is behind, logs schema_behind and alerts once", async () => {
    const raised: boolean[] = [];
    const { instance, lines, advance } = guard("20261014120000", raised);
    expect(await instance.allowsWork(db)).toBe(false);
    advance(60_000);
    expect(await instance.allowsWork(db)).toBe(false);
    expect(lines.filter((line) => line.event === "schema_behind")).toEqual([
      expect.objectContaining({
        level: "warn",
        schema_expected: EXPECTED,
        schema_applied: "20261014120000",
      }),
      expect.objectContaining({ level: "warn" }),
    ]);
    expect(lines.filter((line) => line.event === "schema_behind_alert")).toHaveLength(1);
    expect(raised).toHaveLength(2);
  });

  it.each([EXPECTED, "20261020000000"])(
    "lets the runner work when the database has %s",
    async (v) => {
      const { instance, lines } = guard(v);
      expect(await instance.allowsWork(db)).toBe(true);
      expect(lines).toEqual([]);
    },
  );

  it("fails open with one warning when the version cannot be read (missing grant)", async () => {
    const denied = Object.assign(new Error("permission denied for schema supabase_migrations"), {
      code: "42501",
    });
    const { instance, lines, advance } = guard(denied);
    expect(await instance.allowsWork(db)).toBe(true);
    advance(60_000);
    expect(await instance.allowsWork(db)).toBe(true);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "schema_version_unreadable",
        pg_code: "42501",
        schema_expected: EXPECTED,
      }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("permission denied");
  });

  it("reads the database at most once per cache period", async () => {
    const { instance, reads, advance } = guard(EXPECTED);
    await instance.check(db);
    await instance.check(db);
    expect(reads()).toBe(1);
    advance(30_000);
    await instance.check(db);
    expect(reads()).toBe(2);
  });
});
