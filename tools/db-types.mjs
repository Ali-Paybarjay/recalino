// Generates packages/core/src/db/types.ts from the local database (ADR-0002, rule 3).
// Only module schemas from the capability map are included, never Supabase's own schemas.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const map = JSON.parse(readFileSync(new URL("./capability-map.json", import.meta.url), "utf8"));
const schemas = Object.keys(map.modules);

// Introspection needs to see every module schema, so it uses the local superuser.
// These are the public default credentials of the local Supabase stack, not a secret.
const url = process.env.DB_TYPES_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const result = spawnSync(
  "kysely-codegen",
  [
    "--dialect",
    "postgres",
    "--url",
    url,
    "--include-pattern",
    `{${schemas.join(",")}}.*`,
    "--out-file",
    "packages/core/src/db/types.ts",
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
