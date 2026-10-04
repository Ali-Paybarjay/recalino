import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@recalino/core/db";
import { executeOperatorRequest, operatorRequestSchema } from "@recalino/core/ops";
import { AppError } from "@recalino/core/plt";
import { workspacePath } from "./paths";

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.length === 0 || args.includes("--help")) {
    process.stdout.write(
      "Usage: pnpm ops -- --input <request.json> [--env <explicit-env-file>]\nCommands in JSON: pilot.grant, quota.grant, quota.adjust, quota.close, cost.configure, source.configure, stats.\nRequires DATABASE_URL. Requests require version 1, actorId, reason, operationKey and input.\nPilot grants require an approved policy, a real account UUID, a persisted startsAt and operationKey pilot:<pilotId>:<userId>:initial.\nNo database target, commercial capacity or price is assumed.\n",
    );
    return;
  }
  let inputFile: string | undefined;
  let envFile: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const value = args[++index];
    if (!value || value.startsWith("--") || !["--input", "--env"].includes(flag ?? ""))
      throw new Error("invalid_arguments");
    if (flag === "--input" && !inputFile) inputFile = value;
    else if (flag === "--env" && !envFile) envFile = value;
    else throw new Error("invalid_arguments");
  }
  if (!inputFile) throw new Error("input_required");
  if (envFile) loadEnvFile(workspacePath(envFile));
  const requestBytes = await readFile(workspacePath(inputFile));
  if (requestBytes.length > 65536) throw new Error("input_too_large");
  const request = operatorRequestSchema.parse(JSON.parse(requestBytes.toString("utf8")));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("database_url_required");
  const database = createDatabase(url, { maxConnections: 2 });
  try {
    const output = await executeOperatorRequest(database, request);
    process.stdout.write(
      `${JSON.stringify({ command: request.command, operationKey: request.operationKey, result: output }, null, 2)}\n`,
    );
  } finally {
    await database.destroy();
  }
}
main().catch((error: unknown) => {
  // Raw driver/config errors may contain a connection string or private values: never print them.
  const code =
    error instanceof AppError
      ? error.code
      : error instanceof Error &&
          [
            "invalid_arguments",
            "input_required",
            "input_too_large",
            "database_url_required",
          ].includes(error.message)
        ? error.message
        : "operator_request_failed";
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  process.exitCode = 1;
});
