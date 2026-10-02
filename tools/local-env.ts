// Writes the local Supabase connection into apps/web/.env.local after `pnpm db:start`, keeping
// any other values already there (for example PILOT_OPERATOR_EMAIL). Local and CI only: the
// keys of the local stack are public development defaults, never the cloud project's.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "apps/web/.env.local");

const status = JSON.parse(
  execSync("pnpm exec supabase status -o json", {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as Record<string, string>;

const values = new Map<string, string>();
if (existsSync(TARGET)) {
  for (const line of readFileSync(TARGET, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) values.set(match[1], match[2] ?? "");
  }
}

// The app connects as the least-privilege role; its local password is set in supabase/seed.sql.
values.set(
  "DATABASE_URL",
  "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres",
);
values.set("SUPABASE_URL", status.API_URL ?? "");
values.set("SUPABASE_PUBLISHABLE_KEY", status.PUBLISHABLE_KEY ?? "");
values.set("SUPABASE_SECRET_KEY", status.SECRET_KEY ?? "");
if (!values.get("RATE_LIMIT_IP_KEY")) {
  values.set("RATE_LIMIT_IP_KEY", randomBytes(36).toString("base64url"));
}

const body = [...values].map(([key, value]) => `${key}=${value}`).join("\n");
writeFileSync(
  TARGET,
  `# Local development only; written by \`pnpm db:env\`. Never commit.\n${body}\n`,
);
console.log(`Wrote ${[...values.keys()].join(", ")} to apps/web/.env.local`);
