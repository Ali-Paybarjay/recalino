// SPIKE-05 only (M4-A1): checks a cloud DATABASE_URL before it is entered in Vercel. Removed with
// the spike code (T6). The connection string is read only from a file, never from argv or the
// environment, and neither it nor the password is ever printed.
//
//   node tools/spikes/db-url-check.mjs
//
// File: ~/.recalino-spike/database-url.txt, written by the owner in Notepad
// (docs/plans/M4_QUEUE_STORAGE.md). Prints the masked structure and any character that breaks a
// pasted value, then connects the way the app does (apps/web/src/server/db.ts: pg.Pool, max 3)
// and runs "select current_user".
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const FILE = join(homedir(), ".recalino-spike", "database-url.txt");
const EXPECTED_USER = "recalino_app.twowhuzhvyuzjrpraikm";
const SAFE_PARAMS = new Set(["sslmode", "pgbouncer", "application_name", "connection_limit"]);
const TIMEOUT_MS = 20_000;
const BOM = String.fromCodePoint(0xfeff);
// Straight and curly quotes, as a word processor or chat app may add them.
const QUOTES = [
  '"',
  "'",
  "`",
  ...[0x201c, 0x201d, 0x2018, 0x2019].map((c) => String.fromCodePoint(c)),
];

let raw;
try {
  raw = readFileSync(FILE, "utf8");
} catch {
  console.log(`RESULT: no file at ${FILE}. Save it there first (Ctrl+S in Notepad).`);
  process.exit(1);
}
// Notepad can save a byte order mark; it is part of the file, not of what gets pasted.
const hasBom = raw.startsWith(BOM);
const value = hasBom ? raw.slice(1) : raw;

const problems = [];
const check = (ok, problem) => {
  if (!ok) problems.push(problem);
};

function finish() {
  if (problems.length === 0) {
    console.log("RESULT: OK. Paste this exact file content into Vercel.");
  } else {
    console.log("RESULT: fix before pasting into Vercel:");
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exitCode = 1;
  }
}

// These checks print only yes or no, so they are safe for any file content.
const findings = {
  "byte order mark": hasBom,
  "leading whitespace": /^\s/.test(value),
  "trailing whitespace": /\s$/.test(value),
  "space anywhere": value.includes(" "),
  "tab anywhere": value.includes("\t"),
  "line break anywhere": value.includes("\n") || value.includes("\r"),
  quotes: QUOTES.some((quote) => value.includes(quote)),
  "square brackets": value.includes("[") || value.includes("]"),
  "YOUR-PASSWORD placeholder": value.toUpperCase().includes("YOUR-PASSWORD"),
  "control or non-ASCII characters": [...value].some(
    (ch) => ch.codePointAt(0) < 0x20 || ch.codePointAt(0) > 0x7e,
  ),
};
console.log(`file: ~/.recalino-spike/database-url.txt (${value.length} characters)`);
for (const [name, found] of Object.entries(findings)) {
  console.log(`  ${name}: ${found ? "FOUND" : "none"}`);
  check(!found, name);
}

// pg falls back to reading a non-URL as a database name, which would echo the whole text,
// so nothing more is parsed or printed unless the file is a URL.
let url;
let params;
try {
  url = new URL(value);
  params = new pg.Client({ connectionString: value }).connectionParameters;
} catch {
  console.log("structure: not a URL; nothing more is shown");
  problems.push("not a URL");
  finish();
  process.exit();
}

const password = typeof params.password === "string" ? params.password : "";

/** Last line of defence: nothing printed may contain the password, raw or percent-encoded. */
function redact(text) {
  let out = String(text);
  for (const secret of [password, url.password]) {
    if (secret.length > 0) out = out.split(secret).join("***");
  }
  return out;
}
const show = (label, shown) => console.log(`${label}:`, redact(shown));
const safe = (text, pattern) =>
  pattern.test(text) ? JSON.stringify(text) : `(hidden: ${text.length} characters)`;

const user = String(params.user ?? "");
const host = String(params.host ?? "");
const database = String(params.database ?? "");
const query = [...url.searchParams];

show("scheme", url.protocol);
show("host", safe(host, /^[a-z0-9.-]+$/i));
show("port", params.port);
// A role.project name never holds a base64url password (which has no dot), so it is safe to show.
show("user", safe(user, /^\s*[a-z_]+\.[a-z0-9-]+\s*$/));
show("database", safe(database, /^[a-z0-9_-]+$/i));
show("password length", password.length);
show(
  "query parameters",
  query.length === 0
    ? "none"
    : query.map(([k, v]) => (SAFE_PARAMS.has(k) ? `${k}=${v}` : `${k}=<${v.length} chars>`)),
);

check(/^postgres(ql)?:$/.test(url.protocol), "scheme is not postgresql:");
check(/\.pooler\.supabase\.com$/.test(host), "host is not a Supabase pooler");
check(host.includes("eu-west-2"), "host is not in eu-west-2");
check(Number(params.port) === 6543, "port is not 6543 (transaction pooler)");
check(user === EXPECTED_USER, `user is not ${EXPECTED_USER}`);
check(database === "postgres", "database is not postgres");
check(password.length > 0, "password is empty");

const pool = new pg.Pool({ connectionString: value, max: 3 });
const started = performance.now();
let timer;
try {
  const result = await Promise.race([
    pool.query("select current_user"),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    }),
  ]);
  show("connect", `ok in ${Math.round(performance.now() - started)} ms`);
  show("current_user", JSON.stringify(result.rows[0]?.current_user));
  check(result.rows[0]?.current_user === "recalino_app", "current_user is not recalino_app");
} catch (error) {
  show("connect", `FAILED after ${Math.round(performance.now() - started)} ms`);
  show("  code", error?.code ?? "(none)");
  show("  message", error?.message ?? String(error));
  problems.push("connection failed");
} finally {
  clearTimeout(timer);
  await pool.end().catch(() => {});
}
finish();
