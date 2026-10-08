// The pieces of a database password change that never sends the password anywhere (T10).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** Postgres's default for SCRAM-SHA-256 (scram_iterations). */
export const SCRAM_ITERATIONS = 4096;

/**
 * Where the tools keep the cloud connection string: outside the repository, on this computer only.
 * Deleted by the owner once the value is in Vercel (docs/runbooks/SECRETS.md).
 */
export const URL_FILE = join(homedir(), ".recalino", "database-url.txt");

/** The cloud app role through the transaction pooler (ADR-0002); host checked 2026-10-02. */
export const CLOUD_TARGET = {
  role: "recalino_app",
  user: "recalino_app.twowhuzhvyuzjrpraikm",
  host: "aws-0-eu-west-2.pooler.supabase.com",
  port: 6543,
  database: "postgres",
} as const;

/** 32 random bytes as base64url: 43 characters a URL carries as they are. */
export function generatePassword(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802, RFC 7677), in the form
 * `alter role ... password` keeps as it is: SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>.
 * Only printable ASCII is accepted, which SASLprep leaves unchanged.
 */
export function scramVerifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations = SCRAM_ITERATIONS,
): string {
  if (!/^[\x21-\x7e]+$/.test(password)) throw new Error("password must be printable ASCII");
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const base64 = (bytes: Buffer) => bytes.toString("base64");
  return `SCRAM-SHA-256$${iterations}:${base64(salt)}$${base64(storedKey)}:${base64(serverKey)}`;
}

/** The statement for the Supabase SQL Editor. It holds the verifier, never the password. */
export function alterRoleStatement(role: string, verifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("unexpected role name");
  if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) {
    throw new Error("not a SCRAM-SHA-256 verifier");
  }
  return `alter role ${role} with password '${verifier}';`;
}

export function connectionString(
  password: string,
  target: { user: string; host: string; port: number; database: string } = CLOUD_TARGET,
): string {
  const { user, host, port, database } = target;
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}
