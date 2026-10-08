// Sets a new password for the app role without the password reaching the server, a log, the chat
// or the repository (T10; docs/runbooks/SECRETS.md, "Rotating the database password").
// Run by the product owner in their own terminal:
//
//   pnpm db:new-password
//
// 1. Makes a random password and writes the full connection string to ~/.recalino/database-url.txt.
// 2. Prints only the SQL statement for the Supabase SQL Editor. It carries the SCRAM-SHA-256
//    verifier, which Postgres stores as it is, so the statement log never holds the password.
// The password and the connection string are never printed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  alterRoleStatement,
  CLOUD_TARGET,
  connectionString,
  generatePassword,
  scramVerifier,
  URL_FILE,
} from "./scram.ts";

const password = generatePassword();
mkdirSync(dirname(URL_FILE), { recursive: true, mode: 0o700 });
try {
  // "wx": never overwrite a connection string that may still be needed.
  writeFileSync(URL_FILE, connectionString(password), { flag: "wx", mode: 0o600 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  console.log(`STOPPED: ${URL_FILE} already exists. Delete it first, then run this again.`);
  process.exit(1);
}

console.log(`Wrote the new connection string to ${URL_FILE} (not shown here).`);
console.log("");
console.log("Run this one statement in the Supabase SQL Editor. It has no password, only its");
console.log("SCRAM-SHA-256 verifier:");
console.log("");
console.log(alterRoleStatement(CLOUD_TARGET.role, scramVerifier(password)));
console.log("");
console.log("Then check the new value: pnpm db:url-check");
