// Applies merged migrations to the Recalino cloud project from a cloud session (D77):
//
//   pnpm db:apply                  # dry run: pending migrations, data-loss findings, access check
//   pnpm db:apply --apply          # applies every pending migration, oldest first
//   pnpm db:apply --apply --approve-data-loss 20261101120000   # only after the owner's yes in chat
//
// Migrations come from origin/main only (merged, reviewed files), never the working tree. Every
// call goes to the Supabase Management API for project twowhuzhvyuzjrpraikm. The token is a network
// secret that the environment's proxy adds on that path, so this script never reads or prints it.
// Each migration runs in one transaction with its schema_migrations row (the D68 recording), and
// the history is read back to confirm it.
import { execFileSync } from "node:child_process";
import { setGlobalProxyFromEnv } from "node:http";
import {
  applySql,
  findDataLoss,
  type MigrationFile,
  PROJECT_REF,
  parseMigrationFile,
} from "./plan.ts";

const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const approved = new Set(
  args.flatMap((arg, index) => (arg === "--approve-data-loss" ? [args[index + 1] ?? ""] : [])),
);

// Built-in fetch ignores HTTPS_PROXY unless asked; the cloud environment reaches the API only
// through its proxy, which also adds the token.
if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalProxyFromEnv();

const git = (...gitArgs: string[]) =>
  execFileSync("git", gitArgs, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API}${path}`, init);
  const text = await response.text();
  // Error bodies carry the API's message only; the token never passes through this process.
  if (!response.ok)
    throw new Error(
      `${init?.method ?? "GET"} ${path}: HTTP ${response.status} ${text.slice(0, 300)}`,
    );
  return text ? JSON.parse(text) : null;
}

const query = (sql: string) =>
  api("/database/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });

async function appliedVersions(): Promise<Set<string>> {
  const rows = (await api("/database/migrations")) as Array<{ version: string }>;
  return new Set(rows.map((row) => row.version));
}

git("fetch", "--quiet", "origin", "main");
const merged = git("ls-tree", "--name-only", "origin/main", "supabase/migrations/")
  .split("\n")
  .map((path) => parseMigrationFile(path.replace(/^supabase\/migrations\//, "")))
  .filter((file): file is MigrationFile => file !== null)
  .sort((a, b) => a.version.localeCompare(b.version));

const applied = await appliedVersions();
const latestApplied = [...applied].sort().at(-1) ?? "";
const pending = merged.filter((file) => !applied.has(file.version));
const unknown = [...applied].filter((version) => !merged.some((file) => file.version === version));

// A read-only transaction first, in the same shape as applySql, so a missing Database permission
// or a refused transaction fails before anything is written.
await query("begin;\nset local lock_timeout = '5s';\nselect 1;\nrollback;");
console.log(
  `project ${PROJECT_REF}: ${applied.size} applied, ${merged.length} on origin/main, ${pending.length} pending`,
);
if (unknown.length) console.log(`applied but not on origin/main: ${unknown.join(", ")}`);

let blocked = false;
const plan = pending.map((file) => {
  const sql = git("show", `origin/main:supabase/migrations/${file.file}`);
  const loss = findDataLoss(sql);
  // Like `supabase db push` without --include-all: an older version needs a person to look.
  const outOfOrder = file.version < latestApplied;
  if ((loss.length > 0 && !approved.has(file.version)) || outOfOrder) blocked = true;
  console.log(`- ${file.file}${outOfOrder ? " (older than the latest applied version)" : ""}`);
  for (const statement of loss)
    console.log(
      `    data loss: ${statement} ${approved.has(file.version) ? "(approved)" : `(needs --approve-data-loss ${file.version})`}`,
    );
  return { file, sql };
});

if (!apply || pending.length === 0) {
  console.log(apply ? "nothing to apply" : "dry run: nothing was applied");
  process.exit(0);
}
if (blocked) {
  console.log("not applied: resolve the findings above first");
  process.exit(1);
}
for (const { file, sql } of plan) {
  await query(applySql(file, sql));
  if (!(await appliedVersions()).has(file.version))
    throw new Error(`${file.version} is missing from the history after applying`);
  console.log(`applied ${file.file}`);
}
