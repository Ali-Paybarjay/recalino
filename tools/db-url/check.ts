// Checks the cloud DATABASE_URL before it goes into Vercel (T10; CLOUD_SETUP step 3, SECRETS.md):
//
//   pnpm db:url-check
//
// Reads ~/.recalino/database-url.txt (written by `pnpm db:new-password`), never argv or the
// environment. Prints yes/no findings, each part of the URL only when it is the expected value,
// and the app's own validation. Then it connects with the app's own settings (packages/core/src/db,
// the same TLS) and prints the TLS evidence. Neither the connection string nor the password is
// ever printed.
import { readFileSync } from "node:fs";
import { databaseTls, probeDatabase, readDatabaseEnv } from "./core.ts";
import { CLOUD_TARGET, URL_FILE } from "./scram.ts";

const BOM = String.fromCodePoint(0xfeff);
// Straight and curly quotes, as a word processor or chat app may add them.
const QUOTES = [
  '"',
  "'",
  "`",
  ...[0x201c, 0x201d, 0x2018, 0x2019].map((c) => String.fromCodePoint(c)),
];

let raw: string;
try {
  raw = readFileSync(URL_FILE, "utf8");
} catch {
  console.log(`RESULT: no file at ${URL_FILE}. Run pnpm db:new-password first.`);
  process.exit(1);
}
// Notepad can save a byte order mark; it is part of the file, not of what gets pasted.
const hasBom = raw.startsWith(BOM);
const value = hasBom ? raw.slice(1) : raw;

const problems: string[] = [];
const check = (ok: boolean, problem: string) => {
  if (!ok) problems.push(problem);
};
let password = "";
let urlPassword = "";
/**
 * Text from outside this tool (error messages, server answers) is shown only if it holds no trace
 * of the password, raw or percent-encoded; otherwise all of it is hidden. Masking inside the text
 * would show where a short password sits. The tool's own fixed text needs no such check.
 */
function outside(text: unknown): string {
  const out = String(text);
  const leaks = [password, urlPassword].some((secret) => secret.length > 0 && out.includes(secret));
  return leaks ? "(hidden: it contained the password)" : out;
}
const show = (label: string, shown: unknown) => console.log(`${label}:`, String(shown));
function finish(): never {
  if (problems.length === 0) {
    console.log("RESULT: OK. Paste this exact file content into Vercel.");
    process.exit(0);
  }
  console.log("RESULT: fix before pasting into Vercel:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}

// These print only yes or no, so they are safe for any file content.
const findings: Record<string, boolean> = {
  "byte order mark": hasBom,
  "space anywhere": /\s/.test(value),
  "line break anywhere": /[\r\n]/.test(value),
  quotes: QUOTES.some((quote) => value.includes(quote)),
  "square brackets": value.includes("[") || value.includes("]"),
  "YOUR-PASSWORD placeholder": value.toUpperCase().includes("YOUR-PASSWORD"),
  "control, invisible or non-ASCII characters": [...value].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || code > 0x7e;
  }),
};
console.log(`file: ${URL_FILE} (${value.length} characters)`);
for (const [name, found] of Object.entries(findings)) {
  console.log(`  ${name}: ${found ? "FOUND" : "none"}`);
  check(!found, name);
}

// The app's own checks; their messages never quote the value.
for (const [name, run] of [
  ["app validation (readDatabaseEnv)", () => readDatabaseEnv({ DATABASE_URL: value })],
  ["TLS policy on Vercel production", () => databaseTls(value, { VERCEL_ENV: "production" })],
] as const) {
  try {
    run();
    console.log(`${name}: OK`);
  } catch (error) {
    console.log(`${name}: REJECTED, ${outside((error as Error).message)}`);
    problems.push(name);
  }
}

// Nothing more is parsed or printed unless the file is a URL.
let url: URL;
try {
  url = new URL(value);
} catch {
  console.log("structure: not a URL; nothing more is shown");
  problems.push("not a URL");
  finish();
}
urlPassword = url.password;
try {
  password = decodeURIComponent(url.password);
} catch {
  password = url.password;
}
const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};
// A part is shown only when it is exactly what is expected. Anything else may hold a password that
// landed in the wrong place in a hand-edited file, so only its length is shown.
function part(label: string, actual: string, expected: readonly string[]) {
  const ok = expected.includes(actual);
  show(
    label,
    ok ? JSON.stringify(actual) : `(not as expected, hidden: ${actual.length} characters)`,
  );
  check(ok, `${label} is not ${expected.join(" or ")}`);
}
part("scheme", url.protocol, ["postgresql:", "postgres:"]);
part("host", url.hostname, [CLOUD_TARGET.host]);
part("port (transaction pooler)", url.port, [String(CLOUD_TARGET.port)]);
part("user", decode(url.username), [CLOUD_TARGET.user]);
part("database", decode(url.pathname.slice(1)), [CLOUD_TARGET.database]);
show("password length", password.length);
show("query parameters", [...url.searchParams].length);
check(password.length > 0, "password is empty");
if (problems.length > 0) finish();

try {
  const probe = await probeDatabase(value);
  show("connect", `ok in ${probe.milliseconds} ms, with the app's connection settings`);
  if (probe.tls) {
    show("  TLS version", probe.tls.protocol);
    show(
      "  certificate verified (Supabase Root 2021 CA and host name)",
      probe.tls.certificateVerified ? "yes" : "NO",
    );
    show("  server certificate", outside(`${probe.tls.serverName}, issued by ${probe.tls.issuer}`));
  } else {
    show("  TLS", "NONE");
  }
  show("current_user", outside(JSON.stringify(probe.currentUser)));
  check(
    probe.tls?.certificateVerified === true,
    "the connection is not TLS with a verified certificate",
  );
  check(probe.currentUser === CLOUD_TARGET.role, `current_user is not ${CLOUD_TARGET.role}`);
} catch (error) {
  const failure = error as { code?: string; message?: string };
  show("connect", "FAILED");
  show("  code", outside(failure.code ?? "(none)"));
  show("  message", outside(failure.message ?? String(error)));
  if (failure.code === "28P01") {
    console.log(
      "  The pooler may still hold the previous password for a short time after a change.",
    );
    console.log("  Wait a minute and run this check once more before changing anything.");
  }
  problems.push("connection failed");
}
finish();
