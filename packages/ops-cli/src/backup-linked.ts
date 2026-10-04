import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { databaseTls } from "@recalino/core/db";

const PROJECT = "twowhuzhvyuzjrpraikm";
const TEMPLATE_SHA256 = "30f9760edfdcb55a58b51a190a16713781ca5499356006aaef542d41204a411b";
const NAMES = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;

/** Parse only the pinned 2.118.0 generator. No generated shell text is ever executed. */
export function parseLinkedSupabaseDryRun(raw: string): string {
  if (Buffer.byteLength(raw) > 32768 || /[^\t\n\r\x20-\x7e]/.test(raw))
    throw new Error("backup_linked_generator_invalid");
  const text = raw.replaceAll("\r\n", "\n").replace(/\n+$/, "");
  const values = new Map<string, string>();
  const redacted = text.replace(
    /^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)="([^"\n]*)"$/gm,
    (_line, name: string, value: string) => {
      if (
        values.has(name) ||
        !value ||
        /[$`\\]/.test(value) ||
        Array.from(value).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      )
        throw new Error("backup_linked_generator_invalid");
      values.set(name, value);
      return `export ${name}="<redacted>"`;
    },
  );
  if (
    NAMES.some((name) => !values.has(name)) ||
    createHash("sha256").update(redacted).digest("hex") !== TEMPLATE_SHA256
  )
    throw new Error("backup_linked_generator_invalid");
  const host = values.get("PGHOST") ?? "",
    user = values.get("PGUSER") ?? "";
  const direct = host === `db.${PROJECT}.supabase.co`;
  const pooled = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host);
  if (
    (!direct && !pooled) ||
    !(pooled ? ["5432", "6543"] : ["5432"]).includes(values.get("PGPORT") ?? "") ||
    values.get("PGDATABASE") !== "postgres" ||
    !(direct
      ? /^cli_login_[a-zA-Z0-9_]{1,100}$/.test(user)
      : new RegExp(`^cli_login_[a-zA-Z0-9_]{1,100}\\.${PROJECT}$`).test(user))
  )
    throw new Error("backup_linked_identity_invalid");
  const url = new URL(`postgresql://${host}:5432/postgres`);
  // The same tenant/temporary role uses the documented session endpoint for one consistent dump.
  url.username = user;
  url.password = values.get("PGPASSWORD") ?? "";
  if (databaseTls(url.href, {}) === false) throw new Error("backup_linked_tls_required");
  return url.href;
}

/** Fresh official CLI temporary credentials per invocation; bounded stdout stays private in memory. */
export async function linkedSupabaseDumpSource(config: {
  workspacePath: string;
  cliPath: string;
  timeoutSeconds: number;
  preferSessionPooler?: boolean;
}): Promise<string> {
  if (
    !isAbsolute(config.workspacePath) ||
    !isAbsolute(config.cliPath) ||
    /\.(cmd|bat|ps1|sh)$/i.test(config.cliPath) ||
    !Number.isInteger(config.timeoutSeconds) ||
    config.timeoutSeconds < 1 ||
    config.timeoutSeconds > 3600
  )
    throw new Error("backup_linked_configuration_invalid");
  if (
    (
      await readFile(join(config.workspacePath, "supabase", ".temp", "project-ref"), "utf8")
    ).trim() !== PROJECT
  )
    throw new Error("backup_linked_identity_invalid");
  const child = spawn(
    config.cliPath,
    ["db", "dump", "--linked", "--dry-run", "--project-ref", PROJECT],
    {
      cwd: config.workspacePath,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SUPABASE_DB_PASSWORD: "",
        SUPABASE_PROJECT_ID: PROJECT,
        SUPABASE_PROJECT_HOST: "supabase.co",
        SUPABASE_POOLER_HOST: "pooler.supabase.com",
      },
    },
  );
  child.stderr.resume();
  let failed = false,
    oversized = false;
  const finished = new Promise<number | null>((resolve) => {
    child.once("error", () => {
      failed = true;
      resolve(null);
    });
    child.once("close", resolve);
  });
  const timer = setTimeout(() => {
    failed = true;
    child.kill();
  }, config.timeoutSeconds * 1000);
  let length = 0;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of child.stdout) {
      length += chunk.length;
      if (length > 32768) {
        oversized = true;
        child.kill();
        break;
      }
      chunks.push(Buffer.from(chunk));
    }
    if ((await finished) !== 0 || failed || oversized)
      throw new Error("backup_linked_cli_unavailable");
    const buffer = Buffer.concat(chunks);
    try {
      const source = parseLinkedSupabaseDryRun(buffer.toString("utf8"));
      return config.preferSessionPooler
        ? sessionPoolerDumpSource(
            source,
            await readFile(join(config.workspacePath, "supabase", ".temp", "pooler-url"), "utf8"),
          )
        : source;
    } finally {
      buffer.fill(0);
    }
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    for (const chunk of chunks) chunk.fill(0);
  }
}

/** Docker may lack direct IPv6. Reuse only linked pooler metadata, never its cached password. */
export function sessionPoolerDumpSource(source: string, cachedPooler: string): string {
  databaseTls(cachedPooler.trim(), {});
  const temporary = new URL(source),
    pooler = new URL(cachedPooler.trim());
  if (
    !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(pooler.hostname) ||
    !["5432", "6543"].includes(pooler.port) ||
    pooler.pathname !== "/postgres" ||
    !pooler.username.endsWith(`.${PROJECT}`) ||
    !(
      temporary.hostname === `db.${PROJECT}.supabase.co` ||
      temporary.username.endsWith(`.${PROJECT}`)
    )
  )
    throw new Error("backup_linked_identity_invalid");
  temporary.hostname = pooler.hostname;
  temporary.port = "5432";
  if (!temporary.username.endsWith(`.${PROJECT}`)) temporary.username += `.${PROJECT}`;
  return temporary.href;
}
