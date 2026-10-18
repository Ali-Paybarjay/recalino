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

describe("OPS-08 data-loss scan inside dollar-quoted bodies", () => {
  it.each([
    "do $$ begin delete from x; end $$;",
    "DO $$ BEGIN DELETE FROM x; END $$;",
    "do $body$ begin delete from x; end $body$;",
    "do language plpgsql $$ begin delete from x; end $$;",
    "do $$ begin delete from x; end $$ language plpgsql;",
    "do $$ begin truncate plt.job; end $$;",
    "do $$ begin drop table src.asset; end $$;",
    "do $$ begin drop schema anki cascade; end $$;",
    "do $$ begin alter table src.asset drop column duration_ms; end $$;",
    "do $$ begin update org.class_session set title = null; end $$;",
    "do $$ declare r record; begin for r in select 1 loop update org.class_session set title = null; end loop; end $$;",
    "do $$ begin if exists (select 1 from pg_class) then delete from x where id = 1; end if; end $$;",
    "do $$ begin perform 1; exception when others then delete from x; end $$;",
    "do $$ begin execute 'delete from x'; end $$;",
    "do $$ begin execute format('drop table %I.%I', 's', 't'); end $$;",
    "do $outer$ begin execute $inner$ delete from x $inner$; end $outer$;",
    "create function plt.purge() returns void language plpgsql as $$ begin delete from plt.job; end $$;",
    "create or replace function plt.purge() returns void as $fn$ begin delete from plt.job; end $fn$ language plpgsql;",
    "create procedure plt.purge() language plpgsql as $$ begin truncate plt.job; end $$;",
    "create function plt.purge() returns void language sql as $$ delete from plt.job $$;",
    "create function plt.purge() returns void language sql as 'delete from plt.job';",
    "do $$ begin null; end $$; delete from x;",
    "delete from x; do $$ begin null; end $$;",
  ])("needs the owner's yes: %s", (sql) => {
    expect(findDataLoss(sql)).toHaveLength(1);
  });

  it("names where the finding is", () => {
    expect(findDataLoss("do $$ begin delete from x; end $$;")).toEqual([
      "in do block: delete from x",
    ]);
    expect(
      findDataLoss(
        "create function plt.purge() returns void language sql as $$ truncate plt.job $$;",
      ),
    ).toEqual(["in function body: truncate plt.job"]);
  });

  it("reports each destructive statement of one block", () => {
    expect(findDataLoss("do $$ begin delete from x; truncate y; end $$;")).toHaveLength(2);
  });

  it.each([
    "do $$ begin if not exists (select 1 from pg_roles where rolname = 'x') then create role x; end if; end $$;",
    "do $$ declare item record; begin for item in select 1 loop execute format('alter table %I.%I enable row level security', 's', 't'); end loop; end $$;",
    "do $$ begin insert into a (id, n) values (1, 2) on conflict (id) do update set n = excluded.n; end $$;",
    "do $$ begin update org.class_session set title = 'x' where id = 1; end $$;",
    "do $$ -- delete from x\n begin null; end $$;",
    "do $$ /* truncate x; */ begin null; end $$;",
    "do $$ begin raise notice 'delete from x'; end $$;",
    "do $$ begin alter table src.asset alter column a drop not null; end $$;",
    "create function f() returns trigger language plpgsql as $$ begin raise exception 'cannot delete from x'; end $$;",
    "create function f() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;",
    "create function f() returns void language sql as $$ select 1 $$;",
    "comment on table src.asset is $$delete from x; drop table y$$;",
    "insert into note.template (body) values ($$delete from x$$);",
    "insert into note.template (body) values ($tag$ truncate x; $tag$);",
    "select $1, $2 from t where a = $1;",
    "select a$b$c from t;",
    "select 'it''s -- not a comment', 1; create index a on b (c);",
    "drop index if exists a.b_idx;",
  ])("keeps every row: %s", (sql) => {
    expect(findDataLoss(sql)).toEqual([]);
  });

  it("does not stop at an unterminated body", () => {
    expect(findDataLoss("do $$ begin delete from x; end")).toHaveLength(1);
  });

  it("finds nothing new in the migrations that contain dollar-quoted bodies", () => {
    for (const file of [
      "20260930175238_baseline.sql",
      "20261004045720_note_card_srs.sql",
      "20261005234639_branded_email_snapshots.sql",
    ])
      expect(findDataLoss(readFileSync(resolve(migrations, file), "utf8")), file).toEqual([]);
  });

  it("gives every existing migration the result it had before the scan learned bodies", () => {
    // Recorded 2026-10-18: no migration on main removes data. A new finding here is a real
    // review item (list it and ask the owner), not a reason to loosen the scan.
    const files = readdirSync(migrations).filter((file) => file.endsWith(".sql"));
    const found = files.filter(
      (file) => findDataLoss(readFileSync(resolve(migrations, file), "utf8")).length > 0,
    );
    expect(found).toEqual([]);
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
