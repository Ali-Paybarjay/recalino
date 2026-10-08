import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, databaseTls } from "@recalino/core/db";
import { sql } from "kysely";
import { z } from "zod";

export const backupToolsSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("native"),
    dumpPath: z.string().min(1),
    restorePath: z.string().min(1),
  }),
  z.strictObject({
    mode: z.literal("docker"),
    container: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),
  }),
]);
export type BackupTools = z.infer<typeof backupToolsSchema>;
const SCHEMAS = [
  "acc",
  "quota",
  "org",
  "src",
  "lkm",
  "proc",
  "note",
  "html",
  "media",
  "card",
  "srs",
  "anki",
  "pers",
  "priv",
  "plt",
  "ops",
  "eval",
  "auth",
  "supabase_migrations",
];

export function assertLocalRestoreTarget(value: string): URL {
  // databaseTls also rejects URI query overrides, escapes, invalid schemes and control characters.
  if (databaseTls(value, {}) !== false) throw new Error("restore_local_target_required");
  const url = new URL(value);
  if (!url.username || url.pathname !== "/postgres")
    throw new Error("restore_admin_database_required");
  return url;
}
async function connectionEnv(value: string, tools: BackupTools) {
  const tls = databaseTls(value, {}),
    url = new URL(value);
  const local = tls === false;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: local ? "disable" : "verify-full",
    PGCONNECT_TIMEOUT: "20",
    PGAPPNAME: "recalino-encrypted-backup",
    PGSSLCERT: undefined,
    PGSSLKEY: undefined,
    PGSERVICE: undefined,
    PGSERVICEFILE: undefined,
    PGPASSFILE: undefined,
    PGOPTIONS: undefined,
  };
  if (local && tools.mode === "docker") {
    env.PGHOST = "127.0.0.1";
    env.PGPORT = "5432";
  }
  let cleanup = async () => {};
  if (tls !== false) {
    const folder = await mkdtemp(join(tmpdir(), "recalino-backup-ca-"));
    const cert = join(folder, "supabase-root.crt");
    await writeFile(cert, tls.ca, { mode: 0o600, flag: "wx" });
    if (tools.mode === "docker") {
      const remote = `/tmp/recalino-backup-ca-${randomUUID()}.crt`;
      try {
        await quietProcess("docker", ["cp", cert, `${tools.container}:${remote}`], env, 30);
      } catch (failure) {
        await unlink(cert);
        await rmdir(folder);
        throw failure;
      }
      env.PGSSLROOTCERT = remote;
      cleanup = async () => {
        try {
          await quietProcess("docker", ["exec", tools.container, "rm", "--", remote], env, 30);
        } finally {
          await unlink(cert);
          await rmdir(folder);
        }
      };
    } else {
      env.PGSSLROOTCERT = cert;
      cleanup = async () => {
        await unlink(cert);
        await rmdir(folder);
      };
    }
  } else env.PGSSLROOTCERT = undefined;
  return { env, cleanup };
}
function nativeCommand(tools: BackupTools, binary: "pg_dump" | "pg_restore", args: string[]) {
  if (tools.mode === "native")
    return { executable: binary === "pg_dump" ? tools.dumpPath : tools.restorePath, args };
  const vars = [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "PGSSLMODE",
    "PGSSLROOTCERT",
    "PGCONNECT_TIMEOUT",
    "PGAPPNAME",
  ];
  // Docker inherits the value from our child's environment; no secret appears in argv.
  return {
    executable: "docker",
    args: [
      "exec",
      "-i",
      ...vars.flatMap((name) => ["--env", name]),
      tools.container,
      binary,
      ...args,
    ],
  };
}
async function* processOutput(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  seconds: number,
  stdin?: Uint8Array,
): AsyncGenerator<Uint8Array> {
  const child = spawn(executable, args, {
    env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Classify only fixed known failure categories; diagnostic text remains private and bounded.
  let diagnostic = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (diagnostic.length < 32768)
      diagnostic += chunk.toString("utf8").slice(0, 32768 - diagnostic.length);
  });
  let processError = false,
    timedOut = false;
  const finished = new Promise<number | null>((resolve) => {
    child.once("error", () => {
      processError = true;
      resolve(null);
    });
    child.once("close", (code) => resolve(code));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, seconds * 1000);
  child.stdin.on("error", () => {
    /* The exit code reports a broken native input pipe. */
  });
  child.stdin.end(stdin);
  try {
    for await (const bytes of child.stdout) yield new Uint8Array(bytes);
    const code = await finished;
    if (processError || timedOut || code !== 0) {
      const category = /server version.*pg_dump version|server version mismatch/i.test(diagnostic)
        ? "backup_native_server_version"
        : /permission denied|must be.*owner|must be.*superuser/i.test(diagnostic)
          ? "backup_native_permission_denied"
          : /could not translate host|name resolution/i.test(diagnostic)
            ? "backup_native_dns_failed"
            : /password authentication failed|authentication failed/i.test(diagnostic)
              ? "backup_native_auth_failed"
              : /connection refused/i.test(diagnostic)
                ? "backup_native_connection_refused"
                : /timeout expired|connection timed out/i.test(diagnostic)
                  ? "backup_native_network_timeout"
                  : /network is unreachable|no route to host/i.test(diagnostic)
                    ? "backup_native_network_unreachable"
                    : /tenant or user not found/i.test(diagnostic)
                      ? "backup_native_tenant_failed"
                      : /certificate|SSL error|TLS/i.test(diagnostic)
                        ? "backup_native_tls_failed"
                        : /connection.*failed|could not connect|could not translate host|password authentication failed/i.test(
                              diagnostic,
                            )
                          ? "backup_native_connection_failed"
                          : "backup_native_failed";
      throw new Error(timedOut ? "backup_native_timeout" : category);
    }
  } finally {
    diagnostic = "";
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}
async function quietProcess(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  seconds: number,
  stdin?: Uint8Array,
) {
  for await (const _chunk of processOutput(executable, args, env, seconds, stdin)) {
    /* metadata-only caller */
  }
}
/** One pg_dump snapshot includes schema, constraints, sequences, identities and migration history. */
export async function* nativeDatabaseDump(
  tools: BackupTools,
  sourceUrl: string,
  timeoutSeconds: number,
  options: { assumePostgresRole?: boolean } = {},
): AsyncGenerator<Uint8Array> {
  const { env, cleanup } = await connectionEnv(sourceUrl, tools);
  try {
    const catalog = createDatabase(sourceUrl, { maxConnections: 1 });
    let transientAuth: string[];
    try {
      const tables = await sql<{
        name: string;
      }>`select c.relname as name from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind in ('r','p')`.execute(
        catalog,
      );
      transientAuth = tables.rows
        .map((table) => table.name)
        .filter((name) => !["users", "identities", "schema_migrations"].includes(name));
      if (transientAuth.some((name) => !/^[a-z_][a-z0-9_]*$/.test(name)))
        throw new Error("backup_catalog_invalid");
    } finally {
      await catalog.destroy();
    }
    const args = [
      "--format=custom",
      "--compress=6",
      "--no-owner",
      "--no-password",
      "--serializable-deferrable",
      ...(options.assumePostgresRole ? ["--role=postgres"] : []),
      ...SCHEMAS.map((schema) => `--schema=${schema}`),
      ...transientAuth.map((table) => `--exclude-table-data=auth.${table}`),
    ];
    const command = nativeCommand(tools, "pg_dump", args);
    yield* processOutput(command.executable, command.args, env, timeoutSeconds);
  } finally {
    await cleanup();
  }
}
/** Creates only a new disposable loopback database. This API has no production restore mode. */
export async function isolatedRestoreDrill(
  tools: BackupTools,
  localAdminUrl: string,
  archive: Uint8Array,
  timeoutSeconds: number,
  replay?: (isolatedDatabaseUrl: string) => Promise<void>,
) {
  const base = assertLocalRestoreTarget(localAdminUrl);
  const name = `recalino_restore_${randomUUID().replaceAll("-", "")}`;
  if (!/^recalino_restore_[0-9a-f]{32}$/.test(name))
    throw new Error("restore_database_name_invalid");
  const admin = createDatabase(base.href, { maxConnections: 1 });
  let created = false;
  const started = performance.now();
  const restoredUrl = new URL(base.href);
  restoredUrl.pathname = `/${name}`;
  try {
    await sql.raw(`create database "${name}" template template0`).execute(admin);
    created = true;
    const { env, cleanup } = await connectionEnv(restoredUrl.href, tools);
    const command = nativeCommand(tools, "pg_restore", [
      "--dbname",
      name,
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-acl",
      "--disable-triggers",
      "--no-password",
    ]);
    try {
      await quietProcess(command.executable, command.args, env, timeoutSeconds, archive);
    } finally {
      await cleanup();
    }
    await replay?.(restoredUrl.href);
    const restored = createDatabase(restoredUrl.href, { maxConnections: 1 });
    try {
      const invalid = await sql<{
        count: string;
      }>`select count(*)::text as count from pg_catalog.pg_constraint where not convalidated`.execute(
        restored,
      );
      if (Number(invalid.rows[0]?.count) !== 0) throw new Error("restore_constraints_invalid");
      const tables = await sql<{
        count: string;
      }>`select count(*)::text as count from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname = any(${SCHEMAS}::text[])`.execute(
        restored,
      );
      return {
        isolatedLocal: true as const,
        tables: Number(tables.rows[0]?.count ?? 0),
        constraintsValidated: true as const,
        milliseconds: Math.round(performance.now() - started),
        publicServiceOpened: false as const,
      };
    } finally {
      await restored.destroy();
    }
  } finally {
    try {
      if (created) await sql.raw(`drop database "${name}" with (force)`).execute(admin);
    } finally {
      await admin.destroy();
    }
  }
}
