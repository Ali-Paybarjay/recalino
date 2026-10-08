// Reproducible runtime configuration for the existing linked Recalino project.
// Credentials travel to the authenticated CLI on stdin, never argv or tool output.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const root = resolve(import.meta.dirname, "..");
const localFile = resolve(root, "apps/web/.env.local");
const project = JSON.parse(await readFile(resolve(root, ".vercel/project.json"), "utf8"));
if (
  project.projectId !== "prj_sexBQckLtPOxFHgqV385Bx1JaxqF" ||
  project.orgId !== "team_8WX5ZTQoGLK3XQim9CHcQ350"
)
  throw new Error("wrong_linked_project");
loadEnvFile(localFile);
try {
  loadEnvFile(resolve(root, ".env.backup.local"));
} catch {}
if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("openrouter_key_missing");
const configuration = {
  OPENROUTER_SETTINGS_JSON: JSON.stringify(
    JSON.parse(await readFile(resolve(root, "config/openrouter-defaults.json"), "utf8")),
  ),
  RECALINO_MEDIA_SETTINGS_JSON: JSON.stringify(
    JSON.parse(await readFile(resolve(root, "config/media-defaults.json"), "utf8")),
  ),
  RECALINO_EXPORT_SETTINGS_JSON: JSON.stringify(
    JSON.parse(await readFile(resolve(root, "config/export-defaults.json"), "utf8")),
  ),
  RECALINO_SPIKE: "0",
  ...((process.argv.includes("--local") || process.argv.includes("--include-backup-key")) &&
  process.env.RECALINO_BACKUP_KEY_ID &&
  process.env.RECALINO_BACKUP_KEY_BASE64
    ? {
        RECALINO_BACKUP_KEY_ID: process.env.RECALINO_BACKUP_KEY_ID,
        RECALINO_BACKUP_KEY_BASE64: process.env.RECALINO_BACKUP_KEY_BASE64,
      }
    : {}),
};
if (process.argv.includes("--local")) {
  let contents = await readFile(localFile, "utf8");
  for (const [key, value] of Object.entries(configuration)) {
    const line = `${key}='${value}'`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.trimEnd()}\n${line}\n`;
  }
  await writeFile(localFile, contents);
  console.log("Local server model, media and export configuration updated.");
}
if (!process.argv.includes("--apply-production")) {
  console.log(
    "Production configuration prepared. Apply with --apply-production and VERCEL_CLI_ENTRY set to the installed CLI entry point.",
  );
} else {
  const cli = process.env.VERCEL_CLI_ENTRY;
  if (!cli) throw new Error("vercel_cli_entry_required");
  for (const [key, value] of Object.entries({
    ...configuration,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  })) {
    const args = [cli, "env", "add", key, "production", "--force", "--yes"];
    if (key === "OPENROUTER_API_KEY" || key === "RECALINO_BACKUP_KEY_BASE64")
      args.push("--sensitive");
    await new Promise((ok, fail) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        windowsHide: true,
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.on("error", () => fail(new Error("environment_update_failed")));
      child.on("exit", (code) =>
        code === 0 ? ok() : fail(new Error("environment_update_failed")),
      );
      child.stdin.end(value);
    });
    console.log(`Production variable configured: ${key}`);
  }
}
