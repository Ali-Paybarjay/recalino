// SEC-05 (audit 2026-10-18), D81: the PreToolUse hook in .claude/hooks keeps the allow list of
// .claude/settings.json fast for reads, but asks before SQL that can remove or rewrite data and
// denies every command that carries --approve-data-loss.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decide, MAX_SQL_LENGTH, riskySql } from "../../.claude/hooks/data-loss-guard.ts";

const script = fileURLToPath(new URL("../../.claude/hooks/data-loss-guard.ts", import.meta.url));
const sql = (query: string, tool = "mcp__claude_ai_Supabase__execute_sql") =>
  decide({
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: { project_id: "twowhuzhvyuzjrpraikm", query },
  });
const bash = (command: string) =>
  decide({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });

describe("execute_sql", () => {
  it.each([
    "select * from acc.profile limit 5",
    "SELECT count(*) FROM srs.review_event WHERE created_at > now() - interval '1 day'",
    "select updated_at, last_update from plt.job where id = '1'",
    "delete from x where id = 1",
    "DELETE FROM plt.job WHERE id = 'a' RETURNING id",
    "update acc.profile set display_name = 'A' where user_id = '1'",
    "update t set a = (select b from u limit 1) where t.id = 2",
    "insert into plt.audit_event (action) values ('x') on conflict do update set action = 'y'",
    "select * from plt.job where id = 1 for update",
    "select * from plt.job for no key update",
    "select * from t where note like '%drop table%'",
    "-- a comment that says drop table\nselect 1",
    "do $$ begin delete from x where id = 1; end $$",
    "delete from x where (id = 1)",
    "delete from x where id = 1 and (true)",
    "update t set x = u.x from u where t.id = u.id",
    "update t set x = 1 where id between 1 and 2",
    "insert into t (a) values (1), (2) on conflict (a) do update set a = excluded.a",
    "select e'it\\'s', 'it''s', $é$ text $é$",
    "select * from cron.job",
    "select 'Select a card' as hint",
    // Row locks change no row (review 2026-10-19, round 2).
    "select * from t for update of t nowait",
    "select * from t for no key update skip locked",
    "select * from t order by id for update limit 1",
    "select * from (select * from t for update) s where id = 1",
    "do $$ declare r record; begin select * into r from t where id = 1 for update; end $$",
    "do $$ declare c refcursor; begin open c for update t set x = 1 where id = 1; end $$",
    "delete from t where exists (select 1 from u where u.t_id = t.id)",
  ])("runs without a prompt: %s", (query) => {
    expect(sql(query)).toBeNull();
  });

  it.each([
    "drop table x",
    "DROP TABLE acc.profile CASCADE",
    "truncate plt.job",
    "alter table acc.profile drop column email",
    "create table t (id int)",
    "grant delete on all tables in schema acc to anon",
    "revoke select on acc.profile from authenticated",
    "update x set a=1",
    "UPDATE acc.profile SET display_name = 'A'",
    "delete from x",
    "delete from x -- where id = 1",
    "delete from x /* where id = 1 */",
    "delete from x returning 'where'",
    'delete from x returning "where"',
    "update x set a = 1 where true",
    "delete from x where 1=1",
    "update t set a = (select b from u where u.id = 1)",
    "with d as (delete from x returning id) select * from d where id = 1",
    "select 1; delete from x",
    "do $$ begin delete from x; end $$",
    "do $$ begin execute 'drop table ' || 'x'; end $$",
    "select dblink_exec('drop table x')",
    "merge into t using u on t.id = u.id when matched then delete",
    "copy acc.profile to program 'curl example.com'",
    // Postgres reads these differently from a naive lexer (review 2026-10-19).
    "select 1; -- note\rdrop table t",
    "select name'abc\\'; drop table t; --'",
    "select $é$ ' $é$; drop table t; -- '",
    "select 1$a$ ' $a$; drop table t; -- '",
    "delete from t\u00a0where id = 1",
    "set standard_conforming_strings = off; select 'x\\'' ; drop table t; --'",
    // Quoted bodies that Postgres runs as SQL.
    "do 'begin drop table t; end'",
    "do language plpgsql 'declare n int; begin truncate t; end'",
    "do e'begin \\x64rop table t; end'",
    "select cron.schedule('j','* * * * *','/* x */ drop table t')",
    "select cron.schedule('j','* * * * *',' (select 1); drop table t')",
    "select cron.schedule('j', '* * * * *', 'dr' || 'op table t')",
    "select x(e'\\x64rop table t')",
    "select x('; drop table t')",
    "select x(u&'\\0064rop table t')",
    "select x(u&'!0064rop table t' uescape '!')",
    // Where clauses that keep every row, and mass upserts.
    "delete from t where 2=2",
    "delete from t where id = id",
    "delete from t where t.id = t.id returning id",
    "update t set x = 1 where true or false",
    "delete from t where (true)",
    "delete from t where (1 = 1)",
    "delete from t where id = 1 or 1 = 1",
    "update t set x = 1 where not (1 = 0)",
    "delete from t where id is not distinct from id",
    "insert into t (id,x) select id,0 from t on conflict (id) do update set x = excluded.x",
    "with s as (select id from t) insert into t (id) table s on conflict (id) do update set id = excluded.id",
    // An update that follows `for` in plpgsql (`open cur for update …`) is an update, not a lock.
    "do $$ declare c refcursor; r record; begin open c for update t set x = 1 returning 1; fetch c into r; end $$",
    "do 'declare c refcursor; r record; begin open c for update t set x = 1 returning 1; fetch c into r; end'",
    "do $$ declare c refcursor; begin open c for update only acc.profile * as p set x = 1; end $$",
    'do $$ declare c refcursor; begin open c for no key update "T" set x = 1; end $$',
    "do $$ declare c refcursor; begin open c for update of set x = 1; end $$",
    "do $$ declare c refcursor; begin open c for update only (t) set x = 1; end $$",
    // Where clauses that keep every row through a constant subquery.
    "delete from t where exists (select 1)",
    "delete from t where (select true)",
    "update t set x = 1 where exists (select 1)",
  ])("asks first: %s", (query) => {
    expect(sql(query)?.decision).toBe("ask");
    expect(sql(query, "mcp__Supabase__execute_sql")?.decision).toBe("ask");
  });

  it("asks when the query is missing", () => {
    expect(
      decide({
        tool_name: "mcp__Supabase__execute_sql",
        tool_input: { project_id: "p" },
      })?.decision,
    ).toBe("ask");
  });

  describe("bounded work: a slow check would let the call run when the hook times out", () => {
    const timed = (query: string) => {
      const start = performance.now();
      const result = sql(query);
      return { result, ms: performance.now() - start };
    };

    it.each([
      [
        "a 200,000-character identifier of $ before a drop",
        `select a${"$".repeat(200_000)}; drop table t`,
      ],
      [
        "a 90,000-character identifier of $ before a drop",
        `select a${"$".repeat(90_000)}; drop table t`,
      ],
      [
        "20,000 nested parentheses in a delete's where clause",
        `delete from t where ${"(".repeat(20_000)}true${")".repeat(20_000)}`,
      ],
      [
        "45,000 nested parentheses in a delete's where clause",
        `delete from t where ${"(".repeat(45_000)}true${")".repeat(45_000)}`,
      ],
      [
        "a deep chain of nested or",
        `delete from t where ${"(id = 1 or ".repeat(8_000)}id = 1${")".repeat(8_000)}`,
      ],
      [
        "many upserts in one insert",
        `insert into t values (1) on conflict do update set a = 1${" do update set a = 1".repeat(4_900)}`,
      ],
      [
        "many row locks before a delete",
        `select * from t${" for update".repeat(9_000)}; delete from t`,
      ],
      [
        "many nested updates",
        `update t set x = 1 where id = ${"(update t set x = 1 where id = ".repeat(3_000)}1${")".repeat(3_000)}`,
      ],
      ["many dollar signs", `select ${"$ ".repeat(49_000)}; drop table t`],
      ["many quoted bodies", `select ${"'select 1', ".repeat(8_000)}1; drop table t`],
    ])("asks within 2 s for %s", (_label, query) => {
      const { result, ms } = timed(query);
      expect(result?.decision).toBe("ask");
      expect(ms).toBeLessThan(2_000);
    });

    it("asks with a fixed reason for a query just over the length limit", () => {
      const query = `select 1 from t where note = '${"x".repeat(MAX_SQL_LENGTH)}'`;
      expect(query.length).toBeGreaterThan(MAX_SQL_LENGTH);
      const { result, ms } = timed(query);
      expect(result?.decision).toBe("ask");
      expect(result?.reason).toMatch(/too long/);
      expect(result?.reason).not.toContain("xxx");
      expect(ms).toBeLessThan(2_000);
    });

    it("still checks a long ordinary query just under the limit", () => {
      const rows = Array.from({ length: 4_000 }, (_, i) => `(${i}, 'name ${i}')`).join(", ");
      const query = `insert into t (id, name) values ${rows}`;
      expect(query.length).toBeLessThan(MAX_SQL_LENGTH);
      const { result, ms } = timed(query);
      expect(result).toBeNull();
      expect(ms).toBeLessThan(2_000);
    });
  });

  it("names what it found without echoing the query", () => {
    const found = riskySql("delete from acc.profile -- secret text");
    expect(found).toMatch(/delete/);
    expect(found).not.toContain("secret text");
    expect(sql("delete from acc.profile")?.reason).not.toContain("acc.profile");
  });
});

describe("Bash", () => {
  it.each([
    "pnpm db:apply",
    "pnpm db:apply --apply",
    "  pnpm db:apply --apply  ",
    "pnpm exec supabase db push",
    "git status",
    "grep -rn data-loss docs",
  ])("leaves the normal permission flow: %s", (command) => {
    expect(bash(command)).toBeNull();
  });

  it.each([
    "pnpm db:apply --apply --approve-data-loss 20261101120000",
    "pnpm db:apply -- --apply --approve-data-loss=20261101120000",
    "node tools/db-apply/apply.ts --approve-data-loss 1",
    "cd /x && pnpm db:apply --apply --approve-data-loss 1",
    "pnpm db:apply --apply --approve-data-'loss' 20261101120000",
    "pnpm db:apply --apply --approve-data-l\\oss 20261101120000",
    "pnpm db:apply --apply $'\\x2d-approve-data-loss' 20261101120000",
    "pnpm db:apply --apply --APPROVE-DATA-LOSS 1",
    "grep -rn approve-data-loss docs",
  ])("denies a data-loss approval: %s", (command) => {
    const result = bash(command);
    expect(result?.decision).toBe("deny");
    expect(result?.reason).toMatch(/product owner runs/);
    expect(result?.reason).toMatch(/search for data-loss/);
  });

  it.each([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion, not a template
    "pnpm db:apply --apply --approve-data-${X:-loss} 20261101120000",
    "pnpm db:apply --apply $(printf x)",
    "pnpm db:apply --apply 2>&1 | tail -n 30",
    "pnpm db:apply --apply; echo done",
    "node tools/db-apply/apply.ts --apply",
    "cd /x && pnpm db:apply --apply",
  ])("asks before db:apply with anything else on the line: %s", (command) => {
    expect(bash(command)?.decision).toBe("ask");
  });
});

it("leaves other tools alone", () => {
  expect(decide({ tool_name: "Read", tool_input: { file_path: "/x" } })).toBeNull();
});

describe("as a Claude Code hook", () => {
  const run = (input: string) => execFileSync(process.execPath, [script], { input }).toString();

  it("prints a PreToolUse permission decision", () => {
    const output = JSON.parse(
      run(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "mcp__Supabase__execute_sql",
          tool_input: { query: "truncate plt.job" },
        }),
      ),
    );
    expect(output.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
    });
    const denied = JSON.parse(
      run(
        JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "x --approve-data-loss 1" },
        }),
      ),
    );
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("still decides when the project path is a symlink", () => {
    const parent = mkdtempSync(join(tmpdir(), "recalino-hook-"));
    const link = join(parent, "hooks");
    // A junction needs no Developer Mode on Windows; elsewhere the type is ignored.
    symlinkSync(dirname(script), link, "junction");
    try {
      const viaLink = (input: object) =>
        JSON.parse(
          execFileSync(process.execPath, [join(link, "data-loss-guard.ts")], {
            input: JSON.stringify(input),
          }).toString(),
        ).hookSpecificOutput.permissionDecision;
      expect(
        viaLink({
          tool_name: "mcp__Supabase__execute_sql",
          tool_input: { query: "drop table x" },
        }),
      ).toBe("ask");
      expect(
        viaLink({
          tool_name: "Bash",
          tool_input: {
            command: "pnpm db:apply --apply --approve-data-loss 1",
          },
        }),
      ).toBe("deny");
    } finally {
      unlinkSync(link);
      rmdirSync(parent);
    }
  });

  it("prints nothing for a safe call, and asks when the input cannot be read", () => {
    expect(
      run(
        JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "git status" },
        }),
      ),
    ).toBe("");
    expect(JSON.parse(run("not json")).hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("is registered for Bash and both execute_sql tools, next to the unchanged allow list", () => {
    const settings = JSON.parse(
      readFileSync(new URL("../../.claude/settings.json", import.meta.url), "utf8"),
    );
    const [entry] = settings.hooks.PreToolUse;
    const matcher = new RegExp(`^(?:${entry.matcher})$`);
    for (const tool of [
      "Bash",
      "mcp__Supabase__execute_sql",
      "mcp__claude_ai_Supabase__execute_sql",
    ])
      expect(matcher.test(tool), tool).toBe(true);
    expect(matcher.test("Read")).toBe(false);
    expect(entry.hooks[0].command).toContain(".claude/hooks/data-loss-guard.ts");
    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining([
        "Bash(pnpm db:apply:*)",
        "mcp__Supabase__execute_sql",
        "mcp__claude_ai_Supabase__execute_sql",
      ]),
    );
  });
});
