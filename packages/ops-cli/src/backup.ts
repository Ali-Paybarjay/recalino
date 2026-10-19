import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createDatabase, createOperatorDatabase, type Database } from "@recalino/core/db";
import {
  backupEncryptionKey,
  backupSettingsSchema,
  createDatabaseBackup,
  decryptBackupArchive,
  readDatabaseBackup,
  readEncryptedDeletionJournals,
  recordBackupRestoreDrill,
} from "@recalino/core/ops";
import { VercelBlobStore } from "@recalino/core/plt/vercel-blob";
import { linkedSupabaseDumpSource } from "./backup-linked";
import { backupToolsSchema, isolatedRestoreDrill, nativeDatabaseDump } from "./backup-native";
import { replayRestoredDeletionJournals } from "./backup-replay";

let stage = "arguments";
const safeErrors = new Set([
  "backup_arguments_invalid",
  "backup_configuration_required",
  "backup_linked_configuration_invalid",
  "backup_linked_identity_invalid",
  "backup_linked_generator_invalid",
  "backup_linked_tls_required",
  "backup_linked_cli_unavailable",
  "backup_native_failed",
  "backup_native_timeout",
  "backup_catalog_invalid",
  "backup_recovery_key_required",
  "backup_integrity_failed",
  "restore_local_target_required",
  "restore_admin_database_required",
  "restore_constraints_invalid",
  "journal_integrity_failed",
  "journal_recovery_key_required",
  "backup_archive_invalid",
  "backup_size_limit",
  "backup_key_invalid",
  "backup_native_server_version",
  "backup_native_permission_denied",
  "backup_native_tls_failed",
  "backup_native_connection_failed",
  "backup_native_dns_failed",
  "backup_native_auth_failed",
  "backup_native_connection_refused",
  "backup_native_network_timeout",
  "backup_native_network_unreachable",
  "backup_native_tenant_failed",
]);

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (!args.length || args.includes("--help")) {
    process.stdout.write(
      "Usage: pnpm --filter @recalino/ops-cli backup --command create|drill --env <explicit-env-file> --actor <operator> --reason <purpose> [--backup-id <UUID>] [--linked-supabase]\nbackup needs DATABASE_URL (or --linked-supabase plus RECALINO_SUPABASE_CLI_PATH), RECALINO_BACKUP_KEY_BASE64, RECALINO_BACKUP_SETTINGS_JSON, RECALINO_BACKUP_TOOLS_JSON and private Blob credentials. create additionally needs BACKUP_DATABASE_URL unless linked; drill needs LOCAL_RESTORE_DATABASE_URL and backup id. Remote restore is refused. No plaintext archive is saved or printed.\n",
    );
    return;
  }
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; ) {
    if (args[i] === "--linked-supabase") {
      if (flags.has("--linked-supabase")) throw new Error("backup_arguments_invalid");
      flags.set("--linked-supabase", "true");
      i += 1;
      continue;
    }
    const name = args[i],
      value = args[i + 1];
    if (
      !name ||
      !value ||
      value.startsWith("--") ||
      !["--command", "--env", "--actor", "--reason", "--backup-id"].includes(name) ||
      flags.has(name)
    )
      throw new Error("backup_arguments_invalid");
    flags.set(name, value);
    i += 2;
  }
  const file = flags.get("--env");
  stage = "environment_file";
  if (file) loadEnvFile(file);
  stage = "configuration";
  const command = flags.get("--command");
  if (!["create", "drill"].includes(command ?? "")) throw new Error("backup_arguments_invalid");
  const actor = { actorId: flags.get("--actor") ?? "", reason: flags.get("--reason") ?? "" };
  const url = process.env.DATABASE_URL,
    keyText = process.env.RECALINO_BACKUP_KEY_BASE64;
  const linked = flags.has("--linked-supabase");
  if ((!url && !linked) || !keyText) throw new Error("backup_configuration_required");
  stage = "settings_validation";
  const settings = backupSettingsSchema.parse(
    JSON.parse(process.env.RECALINO_BACKUP_SETTINGS_JSON ?? "null"),
  );
  stage = "tools_validation";
  const tools = backupToolsSchema.parse(
    JSON.parse(process.env.RECALINO_BACKUP_TOOLS_JSON ?? "null"),
  );
  stage = "key_validation";
  const key = backupEncryptionKey(keyText),
    // PERF-05: one archive upload may take as long as the backup's own time limit.
    store = new VercelBlobStore({ timeoutMs: settings.timeoutSeconds * 1000 });
  let db: Database | undefined;
  try {
    stage = "linked_credentials";
    const linkedSource = linked
      ? await linkedSupabaseDumpSource({
          cliPath: process.env.RECALINO_SUPABASE_CLI_PATH ?? "",
          workspacePath:
            process.env.RECALINO_BACKUP_LINKED_WORKSPACE ??
            fileURLToPath(new URL("../../../", import.meta.url)),
          timeoutSeconds: settings.timeoutSeconds,
          preferSessionPooler: tools.mode === "docker",
        })
      : undefined;
    stage = "manifest_connection";
    db = linkedSource
      ? createOperatorDatabase(linkedSource)
      : createDatabase(url ?? "", { maxConnections: 3 });
    if (command === "create") {
      const source = linkedSource ?? process.env.BACKUP_DATABASE_URL;
      if (!source) throw new Error("backup_configuration_required");
      stage = "archive_and_manifest";
      const output = await createDatabaseBackup(
        db,
        store,
        nativeDatabaseDump(tools, source, settings.timeoutSeconds, { assumePostgresRole: linked }),
        {
          settings,
          key,
          operationKey: `daily-backup:${new Date().toISOString().slice(0, 10)}`,
          operator: actor,
        },
      );
      process.stdout.write(`${JSON.stringify(output)}\n`);
    } else {
      const id = flags.get("--backup-id"),
        localUrl = process.env.LOCAL_RESTORE_DATABASE_URL;
      if (!id || !localUrl) throw new Error("backup_configuration_required");
      const encrypted = await readDatabaseBackup(db, store, id, actor);
      stage = "journal_read";
      if (encrypted.keyId !== settings.keyId) throw new Error("backup_recovery_key_required");
      const journals = await readEncryptedDeletionJournals(store, new Map([[settings.keyId, key]]));
      const archive = decryptBackupArchive(encrypted.ciphertext, key, encrypted.keyId);
      try {
        stage = "isolated_restore";
        const metadata = await isolatedRestoreDrill(
          tools,
          localUrl,
          archive,
          settings.timeoutSeconds,
          (isolatedUrl) =>
            replayRestoredDeletionJournals(isolatedUrl, journals).then(() => undefined),
        );
        await recordBackupRestoreDrill(db, id, metadata, actor);
        process.stdout.write(`${JSON.stringify({ backupId: id, ...metadata })}\n`);
      } finally {
        archive.fill(0);
      }
    }
  } finally {
    key.fill(0);
    await db?.destroy();
  }
}
main().catch((failure: unknown) => {
  // The driver, native tools and env parser can contain credentials/private SQL in errors.
  const code =
    failure instanceof Error && safeErrors.has(failure.message)
      ? failure.message
      : "backup_operator_action_failed";
  process.stderr.write(`${JSON.stringify({ error: code, stage })}\n`);
  process.exitCode = 1;
});
