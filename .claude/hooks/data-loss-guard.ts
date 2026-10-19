// Claude Code PreToolUse hook (D81; SEC-05, audit 2026-10-18; owner decision 2026-10-19).
//
// .claude/settings.json keeps its allow list, so reads and ordinary writes run without a prompt.
// This hook adds the part the allow list cannot express:
//   - execute_sql (both Supabase connectors) asks first for SQL that can remove or rewrite data
//     or change the schema or grants: drop, truncate, alter, create, grant, revoke, merge, copy,
//     dynamic and scheduled SQL, a delete or update whose where clause keeps every row (none,
//     `true`, `2 = 2`, `id = id`, `… or true`), and an upsert that copies rows from a query.
//     Comments, string literals, E'…', U&'…' and dollar quotes are read the way Postgres reads
//     them; the bodies of `do` and every literal that reads like a statement are checked as SQL;
//   - any Bash command carrying --approve-data-loss, even when quoted or escaped, is denied: the
//     product owner runs data-loss migrations themselves. db:apply runs without a prompt only as
//     `pnpm db:apply` or `pnpm db:apply --apply`; any other db:apply command asks first.
// It is a safety net, not a parser: a function that deletes rows when selected, SQL built from
// pieces at run time, or a where clause that keeps every row in another way (`id > 0`,
// `id in (select id from t)`) is not seen, so the CLAUDE.md rule (explicit permission for
// irreversible data changes) still applies.
// It prints nothing for a call it has no concern with, and never prints the SQL or the command.
// Tests: tools/claude-hooks/data-loss-guard.test.ts.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type HookDecision = { decision: "ask" | "deny"; reason: string } | null;

const SQL_TOOLS = new Set(["mcp__Supabase__execute_sql", "mcp__claude_ai_Supabase__execute_sql"]);
const DENY_DATA_LOSS =
  "Commands carrying --approve-data-loss are not run by Claude: the product owner runs data-loss migrations themselves (D81). Report the migration and the data it removes instead. To search text for the flag, search for data-loss.";
const ASK_APPLY =
  "db:apply runs without a prompt only as `pnpm db:apply` (dry run) or `pnpm db:apply --apply`, alone on the line. Any other argument, pipe or chained command needs the product owner's yes (D81).";
/** The only db:apply commands that keep the allow list's no-prompt run. */
const PLAIN_APPLY = /^\s*pnpm\s+db:apply(?:\s+--apply)?\s*$/;

/** Statements and clauses that change the schema, grants or many rows at once. */
const RISKY_WORDS =
  /\b(drop|truncate|alter|create|grant|revoke|merge|copy|vacuum|cluster|reindex|lock|execute|call|reassign|security\s+label|comment\s+on|import\s+foreign|refresh\s+materialized)\b/;
/** The first word of every Postgres statement: a literal that starts with one is checked as SQL. */
const STATEMENT_START =
  /^(abort|alter|analy[sz]e|begin|call|checkpoint|close|cluster|comment|commit|copy|create|deallocate|declare|delete|discard|do|drop|end|execute|explain|fetch|grant|import|insert|listen|load|lock|merge|move|notify|prepare|reassign|refresh|reindex|release|reset|revoke|rollback|savepoint|security|select|set|show|start|table|truncate|unlisten|update|vacuum|values|with)(?![\w$])/i;
/** Characters that continue a Postgres identifier; every non-ASCII character counts. */
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;
/** Words in a where clause that name no column. */
const CONSTANT_WORDS = new Set(
  "true false null not and or is isnull notnull unknown distinct from in between symmetric like ilike similar to escape any all some array case when then else end collate current_date current_time current_timestamp localtime localtimestamp current_user session_user user current_role".split(
    " ",
  ),
);

/** A keyword as a whole word; `$` continues a word in Postgres. */
const keyword = (words: string) => new RegExp(`(?<![\\w$])(?:${words})(?![\\w$])`);

interface Scanned {
  /** Lower-cased SQL without comments; literal and quoted-identifier contents are blanked. */
  code: string;
  /** Contents of dollar-quoted bodies, of every literal in a `do`, and of literals that read like statements. */
  bodies: string[];
}

/** Index just past the block comment that starts at `i`; block comments nest in Postgres. */
function blockCommentEnd(sql: string, i: number): number {
  let depth = 1;
  let j = i + 2;
  while (j < sql.length && depth > 0) {
    if (sql[j] === "/" && sql[j + 1] === "*") {
      depth++;
      j += 2;
    } else if (sql[j] === "*" && sql[j + 1] === "/") {
      depth--;
      j += 2;
    } else j++;
  }
  return j;
}

/** Index of the quote that closes the literal or identifier opened at `i`. */
function closingQuote(sql: string, i: number, quote: string, backslash: boolean): number {
  let end = i + 1;
  while (end < sql.length) {
    if (backslash && sql[end] === "\\") end += 2;
    else if (sql[end] === quote && sql[end + 1] === quote) end += 2;
    else if (sql[end] === quote) return end;
    else end++;
  }
  return sql.length;
}

/** True when the `$` at `i` continues an identifier such as `a$b`, so it opens no dollar quote. */
function inIdentifier(sql: string, i: number): boolean {
  let start = i;
  while (start > 0 && IDENT_CHAR.test(sql[start - 1] as string)) start--;
  return start < i && IDENT_START.test(sql[start] as string);
}

function codePoint(hex: string): string {
  try {
    return String.fromCodePoint(Number.parseInt(hex, 16));
  } catch {
    return "";
  }
}

/** The text of an E'…' literal, with its backslash escapes applied. */
function decodeEscapes(raw: string): string {
  return raw.replace(
    /''|\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|[\s\S])/g,
    (_all: string, sequence: string | undefined) => {
      if (sequence === undefined) return "'";
      const kind = sequence[0] as string;
      if (sequence.length > 1 && /[xuU]/.test(kind)) return codePoint(sequence.slice(1));
      if (/[0-7]/.test(kind)) return String.fromCharCode(Number.parseInt(sequence, 8));
      return { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[kind] ?? kind;
    },
  );
}

/** The text of a U&'…' literal, with its Unicode escapes applied. */
function decodeUnicode(raw: string, escapeChar: string): string {
  const e = escapeChar.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
  return raw.replace(
    new RegExp(`''|${e}(${e}|\\+[0-9a-fA-F]{6}|[0-9a-fA-F]{4})`, "g"),
    (_all: string, value: string | undefined) => {
      if (value === undefined) return "'";
      if (value === escapeChar) return escapeChar;
      return codePoint(value.replace("+", ""));
    },
  );
}

/** True when `text`, after leading blanks, `(`, `;` and comments, starts like a statement. */
function startsLikeStatement(text: string): boolean {
  let rest = text;
  for (;;) {
    rest = rest.replace(/^[\s(;]+/, "");
    if (rest.startsWith("--")) {
      const end = rest.search(/[\n\r]/);
      rest = end === -1 ? "" : rest.slice(end);
    } else if (rest.startsWith("/*")) rest = rest.slice(blockCommentEnd(rest, 0));
    else return STATEMENT_START.test(rest);
  }
}

/** Removes comments and sets literals aside, the way Postgres reads them. */
function scan(sql: string): Scanned {
  const parts: string[] = [];
  const bodies: string[] = [];
  // The first characters of the current statement, to recognise a `do` statement.
  let head = "";
  const push = (text: string) => {
    parts.push(text);
    if (head.length < 3) head = (head + text).trimStart();
  };
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] as string;
    const next = sql[i + 1];
    if (char === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
      push(" ");
    } else if (char === "/" && next === "*") {
      i = blockCommentEnd(sql, i);
      push(" ");
    } else if (char === '"') {
      i = closingQuote(sql, i, char, false) + 1;
      push('""');
    } else if (char === "'") {
      // E'…' and U&'…' only when the prefix starts a token: in `name'…'` the e ends an identifier.
      const escapes = /[eE]/.test(sql[i - 1] ?? "") && !IDENT_CHAR.test(sql[i - 2] ?? "");
      const unicode =
        sql[i - 1] === "&" && /[uU]/.test(sql[i - 2] ?? "") && !IDENT_CHAR.test(sql[i - 3] ?? "");
      const end = closingQuote(sql, i, char, escapes);
      const raw = sql.slice(i + 1, end);
      const content = escapes
        ? decodeEscapes(raw)
        : unicode
          ? decodeUnicode(raw, /^\s*uescape\s*'([^'])'/i.exec(sql.slice(end + 1))?.[1] ?? "\\")
          : raw.replaceAll("''", "'");
      if (/^do(?![\w$])/i.test(head) || startsLikeStatement(content)) bodies.push(content);
      push("''");
      i = end + 1;
    } else if (char === "$" && !inIdentifier(sql, i)) {
      const tag = DOLLAR_TAG.exec(sql.slice(i))?.[0];
      if (!tag) {
        push(char);
        i++;
        continue;
      }
      const close = sql.indexOf(tag, i + tag.length);
      bodies.push(sql.slice(i + tag.length, close === -1 ? sql.length : close));
      push("$$");
      i = close === -1 ? sql.length : close + tag.length;
    } else {
      push(char);
      if (char === ";") head = "";
      i++;
    }
  }
  // Non-ASCII characters continue identifiers in Postgres, so they never separate words here.
  const code = parts
    .join("")
    .replace(/[\u0080-\uffff]/g, "_")
    .replace(/\s+/g, " ");
  return { code: code.toLowerCase(), bodies };
}

/** `text` with the inside of every parenthesis blanked, so its indexes still line up. */
function topLevel(text: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (char === "(") {
      out += depth === 0 ? char : " ";
      depth++;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
      out += depth === 0 ? char : " ";
    } else out += depth === 0 ? char : " ";
  }
  return out;
}

/** The statement that starts at `start`, up to its `;` or the `)` that closes its level. */
function statementFrom(code: string, start: number): string {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const char = code[i];
    if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) return code.slice(start, i);
      depth--;
    } else if (char === ";" && depth === 0) return code.slice(start, i);
  }
  return code.slice(start);
}

/** Where the statement around index `at` starts: after its `;` or the `(` that opens its level. */
function statementStart(code: string, at: number): number {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const char = code[i];
    if (char === ")") depth++;
    else if (char === "(") {
      if (depth === 0) return i + 1;
      depth--;
    } else if (char === ";" && depth === 0) return i + 1;
  }
  return 0;
}

/** Splits `text` where `separator` matches outside parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const pieces: string[] = [];
  let from = 0;
  for (const match of topLevel(text).matchAll(new RegExp(keyword(separator).source, "g"))) {
    pieces.push(text.slice(from, match.index));
    from = match.index + match[0].length;
  }
  pieces.push(text.slice(from));
  return pieces;
}

/** `text` without the parentheses that wrap all of it. */
function unwrap(text: string): string {
  let inner = text.trim();
  while (inner.startsWith("(") && topLevel(inner).indexOf(")") === inner.length - 1)
    inner = inner.slice(1, -1).trim();
  return inner;
}

/** True when `text` names a column: an identifier that is not a keyword, a function or a type. */
function namesColumn(text: string): boolean {
  for (const match of text.matchAll(/(?<![\w$])(?:""|[a-z_][\w$]*)/g)) {
    const before = text.slice(0, match.index).trimEnd();
    const after = text.slice(match.index + match[0].length).trimStart();
    // A type after `::`, a function call, or the prefix of a typed literal such as date '…'.
    if (before.endsWith("::") || after.startsWith("(") || after.startsWith("'")) continue;
    if (match[0] === '""' || !CONSTANT_WORDS.has(match[0])) return true;
  }
  return false;
}

function same(left: string, right: string): boolean {
  const a = unwrap(left).replace(/\s+/g, "");
  return a !== "" && a === unwrap(right).replace(/\s+/g, "");
}

/** True when a where clause keeps every row: no column, `id = id`, or a disjunct like that. */
function keepsEveryRow(clause: string): boolean {
  const text = unwrap(clause);
  if (!text) return true;
  const ors = splitTopLevel(text, "or");
  if (ors.length > 1) return ors.some(keepsEveryRow);
  const ands = splitTopLevel(text, "and");
  if (ands.length > 1) return ands.every(keepsEveryRow);
  if (!namesColumn(text)) return true;
  const top = topLevel(text);
  const notDistinct = keyword("is\\s+not\\s+distinct\\s+from").exec(top);
  if (notDistinct)
    return same(
      text.slice(0, notDistinct.index),
      text.slice(notDistinct.index + notDistinct[0].length),
    );
  const comparisons = [...top.matchAll(/[<>=~!@#%^&|`?+\-*/]+/g)].filter((match) =>
    ["=", "<=", ">=", "<>", "!=", "<", ">"].includes(match[0]),
  );
  const [only] = comparisons;
  return (
    comparisons.length === 1 &&
    only !== undefined &&
    ["=", "<=", ">="].includes(only[0]) &&
    same(text.slice(0, only.index), text.slice(only.index + only[0].length))
  );
}

/** True when the upsert whose `do update` is at `at` takes its rows from a query, not a values list. */
function upsertFromQuery(code: string, at: number): boolean {
  const top = topLevel(code.slice(statementStart(code, at), at));
  const insert = keyword("insert").exec(top);
  if (!insert) return true;
  const own = top.slice(insert.index);
  return /\b(select|table)\b/.test(own) || !keyword("values").test(own);
}

/** A delete or update that can reach every row, or null. */
function unrestricted(code: string): string | null {
  for (const match of code.matchAll(/\b(delete|update)\b/g)) {
    const before = code.slice(0, match.index).trimEnd();
    if (match[1] === "update" && /(?<![\w$])do$/.test(before)) {
      if (upsertFromQuery(code, match.index)) return "an upsert that copies rows from a query";
      continue;
    }
    // `select … for update` and `for no key update` lock rows but change none.
    if (match[1] === "update" && /(?<![\w$])(for|key)$/.test(before)) continue;
    const statement = statementFrom(code, match.index);
    const where = keyword("where").exec(topLevel(statement));
    if (!where) return `${match[1]} without a where clause`;
    let clause = statement.slice(where.index + where[0].length);
    const returning = keyword("returning").exec(topLevel(clause));
    if (returning) clause = clause.slice(0, returning.index);
    if (keepsEveryRow(clause)) return `${match[1]} with a where clause that keeps every row`;
  }
  return null;
}

/** A short description of the first risk in the SQL, or null. Never contains the SQL itself. */
export function riskySql(sql: string, depth = 0): string | null {
  if (depth > 5) return "deeply nested SQL";
  // These settings change how Postgres reads backslashes in literals, which this scan relies on.
  if (/standard_conforming_strings|backslash_quote/i.test(sql)) return "a string-reading setting";
  const { code, bodies } = scan(sql);
  const word = RISKY_WORDS.exec(code)?.[1];
  if (word) return word.replace(/\s+/, " ");
  if (/\bdblink/.test(code)) return "dblink";
  if (/\bcron\s?\.\s?(schedule|schedule_in_database|alter_job)\b/.test(code))
    return "scheduled SQL";
  const rows = unrestricted(code);
  if (rows) return rows;
  for (const body of bodies) {
    const inner = riskySql(body, depth + 1);
    if (inner) return `${inner} (inside a quoted body)`;
  }
  return null;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** The decision for one Bash command; quotes and backslashes cannot hide the flag. */
function decideCommand(command: string): HookDecision {
  const plain = command.replace(/['"\\]/g, "").toLowerCase();
  if (plain.includes("approve-data-loss")) return { decision: "deny", reason: DENY_DATA_LOSS };
  // `$…` expansions, eval, pipes or extra arguments must not ride on the allow-listed prefix.
  if (/db[:-]apply/.test(plain) && !PLAIN_APPLY.test(command))
    return { decision: "ask", reason: ASK_APPLY };
  return null;
}

/** The hook's decision for one tool call; null leaves the normal permission flow. */
export function decide(input: unknown): HookDecision {
  const tool = field(input, "tool_name");
  const toolInput = field(input, "tool_input");
  if (tool === "Bash") {
    const command = field(toolInput, "command");
    return typeof command === "string" ? decideCommand(command) : null;
  }
  if (typeof tool === "string" && SQL_TOOLS.has(tool)) {
    const query = field(toolInput, "query");
    if (typeof query !== "string")
      return {
        decision: "ask",
        reason: "The SQL of this call could not be read.",
      };
    const found = riskySql(query);
    return found
      ? {
          decision: "ask",
          reason: `This SQL can remove or rewrite data or change the schema (${found}). CLAUDE.md needs the product owner's explicit yes for this exact change (D81).`,
        }
      : null;
  }
  return null;
}

function output(decision: NonNullable<HookDecision>): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.decision,
      permissionDecisionReason: decision.reason,
    },
  });
}

/**
 * True when Node runs this file, also through a symlinked project path: argv[1] keeps the
 * symlink, import.meta.url is the real path. import.meta.main needs Node 24.2, engines allow 24.0.
 */
function runAsHook(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runAsHook()) {
  let decision: HookDecision;
  try {
    decision = decide(JSON.parse(readFileSync(0, "utf8")));
  } catch {
    // A guard that cannot read the call asks instead of letting it through silently.
    decision = {
      decision: "ask",
      reason: "The data-loss guard could not read this tool call.",
    };
  }
  if (decision) process.stdout.write(output(decision));
}
