import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repository = process.cwd();
const powershell = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const windowsOnly = { skip: process.platform !== "win32" };

function invoke(file, args) {
  return spawnSync(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "RemoteSigned",
      "-File",
      path.join(repository, "tools/backup", file),
      ...args,
    ],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 30000,
    },
  );
}

function fixture() {
  const parent = realpathSync(path.join(repository, ".vercel"));
  const folder = mkdtempSync(path.join(parent, "backup-test-"));
  for (const child of [".vercel", "supabase/.temp", "packages/ops-cli/src"])
    mkdirSync(path.join(folder, child), { recursive: true });
  writeFileSync(path.join(folder, "supabase/.temp/project-ref"), "twowhuzhvyuzjrpraikm");
  writeFileSync(
    path.join(folder, "packages/ops-cli/src/backup.ts"),
    "// Isolated fixture; never runs a database backup.\n",
  );
  const cli = path.join(folder, "fake-pnpm.cjs");
  writeFileSync(
    cli,
    `
if (process.argv.includes('--env')) throw new Error('fixture_unexpected_plaintext_env');
if (process.env.RECALINO_BACKUP_KEY_BASE64 !== '${Buffer.alloc(32, 7).toString("base64")}') throw new Error('fixture_decryption_missing');
process.stderr.write('synthetic-secret-marker');
process.stdout.write(JSON.stringify({id:'11111111-1111-4111-8111-111111111111',state:'ready',keyId:'fixture-key',encryptedBytes:256,unexpectedSecret:'synthetic-secret-marker'}));
`,
  );
  const config = {
    RECALINO_BACKUP_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    RECALINO_BACKUP_KEY_ID: "fixture-key",
    RECALINO_BACKUP_SETTINGS_JSON: JSON.stringify({
      version: "1",
      keyId: "fixture-key",
      maxEncryptedBytes: 1024,
      timeoutSeconds: 30,
    }),
    RECALINO_BACKUP_TOOLS_JSON: JSON.stringify({ mode: "docker", container: "fixture-only" }),
    RECALINO_SUPABASE_CLI_PATH: cli,
    RECALINO_BACKUP_LINKED_WORKSPACE: folder,
    BLOB_READ_WRITE_TOKEN: "synthetic-blob-token-not-a-credential",
  };
  const env = path.join(folder, ".env.fixture.local");
  writeFileSync(
    env,
    Object.entries(config)
      .map(([name, value]) => `${name}='${value}'`)
      .join("\n"),
  );
  const cipher = path.join(folder, ".vercel/protected-config.json");
  const protectedResult = invoke("protect-config.ps1", [
    "-OperatorEnvFile",
    env,
    "-OutputPath",
    cipher,
  ]);
  assert.equal(protectedResult.status, 0, protectedResult.stderr);
  assert.ok(!protectedResult.stdout.includes(config.RECALINO_BACKUP_KEY_BASE64));
  return {
    folder,
    cipher,
    env,
    run(extra = ["-LinkedSupabase"]) {
      return invoke("run-daily.ps1", [
        "-WorkspacePath",
        folder,
        "-OperatorEnvFile",
        cipher,
        "-ActorId",
        "fixture-only",
        "-NodeDirectory",
        path.dirname(process.execPath),
        "-PnpmCliPath",
        cli,
        "-DpapiConfig",
        ...extra,
      ]);
    },
    status() {
      return JSON.parse(
        readFileSync(path.join(folder, ".vercel/backup-task-runtime.json"), "utf8"),
      );
    },
    cleanup() {
      const resolved = realpathSync(folder);
      if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith("backup-test-"))
        throw new Error("fixture_cleanup_target_invalid");
      rmSync(resolved, { recursive: true, force: true });
    },
  };
}

test(
  "same-user DPAPI supplies the child environment and persists only safe result fields",
  windowsOnly,
  () => {
    const f = fixture();
    try {
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!result.stdout.includes("synthetic-secret-marker"));
      assert.ok(!result.stderr.includes("synthetic-secret-marker"));
      const status = f.status();
      assert.equal(status.exitCode, 0);
      assert.deepEqual(status.result, {
        id: "11111111-1111-4111-8111-111111111111",
        state: "ready",
        keyId: "fixture-key",
        encryptedBytes: 256,
      });
      assert.ok(!JSON.stringify(status).includes("synthetic-secret-marker"));
    } finally {
      f.cleanup();
    }
  },
);

test(
  "a failed child retains only fixed diagnostic enums and drops arbitrary private fields",
  windowsOnly,
  () => {
    const f = fixture();
    try {
      writeFileSync(
        path.join(f.folder, "fake-pnpm.cjs"),
        `process.stderr.write(JSON.stringify({error:'backup_native_dns_failed',stage:'archive_and_manifest',detail:'synthetic-secret-marker'}) + '\\n');
process.stderr.write(JSON.stringify({error:'synthetic-secret-marker',stage:'linked_credentials'}) + '\\n');
process.exitCode = 1;`,
      );
      const result = f.run();
      assert.equal(result.status, 1);
      const status = f.status();
      assert.equal(status.error, "backup_schedule_execution_failed");
      assert.deepEqual(status.childFailure, {
        stage: "archive_and_manifest",
        error: "backup_native_dns_failed",
      });
      assert.ok(!JSON.stringify(status).includes("synthetic-secret-marker"));
      assert.ok(!result.stdout.includes("synthetic-secret-marker"));
      assert.ok(!result.stderr.includes("synthetic-secret-marker"));
    } finally {
      f.cleanup();
    }
  },
);

test(
  "a different declared Windows owner is refused before decrypting or starting a child",
  windowsOnly,
  () => {
    const f = fixture();
    try {
      const value = JSON.parse(readFileSync(f.cipher, "utf8"));
      value.ownerSid = "S-1-5-18";
      writeFileSync(f.cipher, JSON.stringify(value));
      assert.equal(f.run().status, 1);
      assert.equal(f.status().error, "backup_protected_identity_invalid");
      assert.equal(f.status().result, null);
    } finally {
      f.cleanup();
    }
  },
);

test(
  "ciphertext tampering produces a fixed error without disclosing ciphertext or config",
  windowsOnly,
  () => {
    const f = fixture();
    try {
      const value = JSON.parse(readFileSync(f.cipher, "utf8"));
      const bytes = Buffer.from(value.protectedConfig, "base64");
      bytes[bytes.length - 1] ^= 1;
      value.protectedConfig = bytes.toString("base64");
      writeFileSync(f.cipher, JSON.stringify(value));
      const result = f.run();
      assert.equal(result.status, 1);
      assert.equal(f.status().stage, "protected_config");
      assert.equal(f.status().error, "backup_schedule_preflight_failed");
      assert.ok(!result.stdout.includes(value.protectedConfig));
      assert.ok(!result.stderr.includes(value.protectedConfig));
    } finally {
      f.cleanup();
    }
  },
);

test(
  "DPAPI scheduling cannot fall back to a local or unspecified database target",
  windowsOnly,
  () => {
    const f = fixture();
    try {
      assert.equal(f.run([]).status, 1);
      assert.equal(f.status().stage, "arguments");
      assert.equal(f.status().error, "backup_protected_linked_required");
    } finally {
      f.cleanup();
    }
  },
);

test(
  "protecting config again refuses replacement and preserves the existing ciphertext",
  windowsOnly,
  () => {
    const f = fixture();
    try {
      const previous = readFileSync(f.cipher);
      const result = invoke("protect-config.ps1", [
        "-OperatorEnvFile",
        f.env,
        "-OutputPath",
        f.cipher,
      ]);
      assert.equal(result.status, 1);
      assert.deepEqual(readFileSync(f.cipher), previous);
    } finally {
      f.cleanup();
    }
  },
);
