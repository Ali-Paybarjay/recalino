import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseLinkedSupabaseDryRun, sessionPoolerDumpSource } from "./backup-linked";

const ref = "twowhuzhvyuzjrpraikm";
async function generated(overrides: Record<string, string> = {}) {
  const fixture = await readFile(
    new URL("./supabase-dryrun-2.118.0.fixture.txt", import.meta.url),
    "utf8",
  );
  const fields: Record<string, string> = {
    PGHOST: `db.${ref}.supabase.co`,
    PGPORT: "5432",
    PGUSER: "cli_login_synthetic_123",
    PGPASSWORD: "synthetic-password-123",
    PGDATABASE: "postgres",
    ...overrides,
  };
  return fixture.replace(
    /^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)="<redacted>"$/gm,
    (_line, name: string) => `export ${name}="${fields[name]}"`,
  );
}
it("parses only the exact pinned generator and selects the verified session connection", async () => {
  const direct = new URL(parseLinkedSupabaseDryRun(await generated()));
  expect(direct.hostname).toBe(`db.${ref}.supabase.co`);
  expect(direct.username).toBe("cli_login_synthetic_123");
  const pooled = new URL(
    parseLinkedSupabaseDryRun(
      await generated({
        PGHOST: "aws-0-eu-west-2.pooler.supabase.com",
        PGPORT: "6543",
        PGUSER: `cli_login_synthetic_123.${ref}`,
      }),
    ),
  );
  expect(pooled.port).toBe("5432");
  expect(pooled.password).toBe("synthetic-password-123");
});
it("uses only fixed-tenant cached pooler metadata and preserves fresh credentials", async () => {
  const source = parseLinkedSupabaseDryRun(await generated());
  const result = new URL(
    sessionPoolerDumpSource(
      source,
      `postgresql://postgres.${ref}:ignored-old-password@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`,
    ),
  );
  expect(result.password).toBe("synthetic-password-123");
  expect(result.port).toBe("5432");
  expect(result.username).toBe(`cli_login_synthetic_123.${ref}`);
  expect(() =>
    sessionPoolerDumpSource(
      source,
      "postgresql://postgres.foreign:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres",
    ),
  ).toThrow();
});
it("rejects changed scripts, shell expansions, extra fields, stale credentials and foreign projects without execution", async () => {
  const script = await generated();
  for (const altered of [
    `${script}\ntouch /tmp/never-executed`,
    script.replace("set -euo pipefail", "set +e"),
    script.replace("export PGHOST=", 'export PGOPTIONS="-c role=postgres"\nexport PGHOST='),
    script.replace("synthetic-password-123", "$(echo stolen)"),
    script.replace("synthetic-password-123", "`echo stolen`"),
    await generated({ PGUSER: "postgres" }),
    await generated({ PGHOST: "db.foreignproject.supabase.co" }),
    await generated({
      PGUSER: "cli_login_synthetic_123.foreignproject",
      PGHOST: "aws-0-eu-west-2.pooler.supabase.com",
    }),
    await generated({ PGPORT: "9999" }),
    await generated({ PGDATABASE: "other" }),
  ])
    expect(() => parseLinkedSupabaseDryRun(altered)).toThrow();
});
