import { loadEnvFile } from "node:process";
import { createDatabase } from "@recalino/core/db";
import { readRunTimes, summarize } from "@recalino/core/ops";
import { workspacePath } from "./paths";

/**
 * Usage: pnpm --filter @recalino/ops-cli timings -- --since <ISO date> [--until <ISO date>]
 *   [--env <explicit-env-file>] [--runs]
 * Prints per-stage p50/p95 seconds of class runs (NFR-07); `--runs` adds each run's stages.
 * Read-only; requires DATABASE_URL. Never prints class content or connection details.
 */
async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  let since: Date | undefined;
  let until = new Date();
  let runs = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--runs") {
      runs = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("invalid_arguments");
    if (flag === "--since") since = new Date(value);
    else if (flag === "--until") until = new Date(value);
    else if (flag === "--env") loadEnvFile(workspacePath(value));
    else throw new Error("invalid_arguments");
  }
  if (!since || Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until)
    throw new Error("invalid_arguments");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("database_url_required");
  const database = createDatabase(url, { maxConnections: 1 });
  try {
    const report = summarize(await readRunTimes(database, since, until));
    process.stdout.write(
      `${JSON.stringify(
        {
          since: since.toISOString(),
          until: until.toISOString(),
          runs: report.runs,
          stages: report.stages,
          ...(runs ? { perRun: report.perRun } : {}),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await database.destroy();
  }
}
main().catch((error: unknown) => {
  const code =
    error instanceof Error && ["invalid_arguments", "database_url_required"].includes(error.message)
      ? error.message
      : "timings_failed";
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  process.exitCode = 1;
});
