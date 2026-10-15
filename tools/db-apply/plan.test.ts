import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applySql, findDataLoss, PROJECT_REF, parseMigrationFile } from "./plan.ts";

const migrations = resolve(import.meta.dirname, "../../supabase/migrations");

describe("D77 migration files", () => {
  it("reads version and name, and ignores other files", () => {
    expect(parseMigrationFile("20261014120000_anki_export_duplicate_indexes.sql")).toEqual({
      version: "20261014120000",
      name: "anki_export_duplicate_indexes",
      file: "20261014120000_anki_export_duplicate_indexes.sql",
    });
    expect(parseMigrationFile("README.md")).toBeNull();
    expect(parseMigrationFile("2026_bad.sql")).toBeNull();
    expect(parseMigrationFile("20261014120000_Bad-Name.sql")).toBeNull();
  });

  it("parses every migration in the repository", () => {
    const files = readdirSync(migrations).filter((file) => file.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(parseMigrationFile(file), file).not.toBeNull();
  });

  it("targets only the Recalino project", () => {
    expect(PROJECT_REF).toBe("twowhuzhvyuzjrpraikm");
  });
});

describe("D75/D77 data-loss scan", () => {
  it.each([
    "drop table src.asset;",
    "drop schema anki cascade;",
    "truncate plt.job;",
    "delete from note.notebook where true;",
    "update org.class_session set title = null;",
    "alter table src.asset drop column duration_ms;",
    "alter table src.asset drop duration_ms;",
    "alter table src.asset add column x int, drop column y;",
    "drop index anki.some_idx cascade;",
    "drop type public.state;",
  ])("needs the owner's yes: %s", (sql) => {
    expect(findDataLoss(sql)).toHaveLength(1);
  });

  it.each([
    "drop index if exists anki.export_artifact_expires_at_idx;",
    "drop policy owner_read on note.notebook;",
    "drop function if exists plt.claim();",
    "drop trigger touch on org.class_session;",
    "drop view if exists ops.summary;",
    "alter table src.audio_upload alter column reservation_id drop not null;",
    "alter table org.class_session alter column title drop default;",
    "alter table src.asset drop constraint asset_kind_check;",
    "update org.class_session set title = 'x' where id = '00000000-0000-0000-0000-000000000000';",
    "-- drop table src.asset;\ncreate index a on b (c);",
    "comment on table src.asset is 'never drop table here';",
  ])("keeps every row: %s", (sql) => {
    expect(findDataLoss(sql)).toEqual([]);
  });

  it("does not flag the index cleanup or the nullable column from 2026-10-13", () => {
    for (const file of [
      "20261014120000_anki_export_duplicate_indexes.sql",
      "20261012230000_src_capture_staged_audio.sql",
    ])
      expect(findDataLoss(readFileSync(resolve(migrations, file), "utf8")), file).toEqual([]);
  });
});

describe("D77 apply transaction", () => {
  const migration = {
    version: "20261101120000",
    name: "example_change",
    file: "20261101120000_example_change.sql",
  };

  it("runs the file and its history row in one transaction with short lock waits", () => {
    const sql = applySql(migration, "create index a on b (c);\n-- trailing comment");
    expect(sql.startsWith("begin;\nset local lock_timeout = '5s';")).toBe(true);
    expect(sql).toContain("-- trailing comment\n;");
    expect(sql).toContain(
      "values ('20261101120000', 'example_change', array[$migration$create index a on b (c);",
    );
    expect(sql.endsWith("commit;")).toBe(true);
  });

  it("chooses a quoting tag the file does not contain", () => {
    expect(applySql(migration, "select $migration$x$migration$;")).toContain("$migration_$");
  });

  it("refuses a version or name it cannot quote safely", () => {
    expect(() => applySql({ ...migration, name: "x'); drop table y; --" }, "select 1;")).toThrow();
    expect(() => applySql({ ...migration, version: "2026" }, "select 1;")).toThrow();
  });
});
