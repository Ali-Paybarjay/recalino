// SEC-05 (audit 2026-10-18), D81: the PreToolUse hook in .claude/hooks keeps the allow list of
// .claude/settings.json fast for reads, but asks before SQL that can remove or rewrite data and
// denies every command that carries --approve-data-loss.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decide, riskySql } from "../../.claude/hooks/data-loss-guard.ts";

const script = fileURLToPath(new URL("../../.claude/hooks/data-loss-guard.ts", import.meta.url));
const sql = (query: string, tool = "mcp__claude_ai_Supabase__execute_sql") =>
  decide({
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: { project_id: "twowhuzhvyuzjrpraikm", query },
  });
const bash = (command: string) =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

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
  ])("asks first: %s", (query) => {
    expect(sql(query)?.decision).toBe("ask");
    expect(sql(query, "mcp__Supabase__execute_sql")?.decision).toBe("ask");
  });

  it("asks when the query is missing", () => {
    expect(
      decide({ tool_name: "mcp__Supabase__execute_sql", tool_input: { project_id: "p" } })
        ?.decision,
    ).toBe("ask");
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
    "pnpm exec supabase db push",
    "git status",
    "grep -rn approve-data-loss docs",
  ])("leaves the normal permission flow: %s", (command) => {
    expect(bash(command)).toBeNull();
  });

  it.each([
    "pnpm db:apply --apply --approve-data-loss 20261101120000",
    "pnpm db:apply -- --apply --approve-data-loss=20261101120000",
    "node tools/db-apply/apply.ts --approve-data-loss 1",
    "cd /x && pnpm db:apply --apply --approve-data-loss 1",
  ])("denies a data-loss approval: %s", (command) => {
    const result = bash(command);
    expect(result?.decision).toBe("deny");
    expect(result?.reason).toMatch(/product owner runs/);
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
      run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "x --approve-data-loss 1" } })),
    );
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("prints nothing for a safe call, and asks when the input cannot be read", () => {
    expect(
      run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } })),
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
