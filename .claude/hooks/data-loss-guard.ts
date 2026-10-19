// Claude Code PreToolUse hook (D81; SEC-05, audit 2026-10-18; owner decision 2026-10-19).
//
// .claude/settings.json keeps its allow list, so reads and ordinary writes run without a prompt.
// This hook adds the part the allow list cannot express:
//   - execute_sql (both Supabase connectors) asks first for SQL that can remove or rewrite data
//     or change the schema or grants: drop, truncate, alter, create, grant, revoke, merge, copy,
//     dynamic and scheduled SQL, a delete or update whose where clause keeps every row (none,
//     `true`, `2 = 2`, `id = id`, `… or true`), an upsert that copies rows from a query, and a
//     statement that sets search_path to include cron (`set [local] search_path`, `set_config`),
//     after which cron's functions run without the schema name.
//     Comments, string literals, E'…', U&'…' with its UESCAPE clause (also after a comment), dollar
//     quotes and literals that continue on the next line ('a'<newline>'b' is 'ab') are read the
//     way Postgres reads them, and a UESCAPE it cannot read asks; the bodies of `do` and
//     every literal that reads like a statement are checked as SQL; quoted names such as
//     `"cron"."schedule"` and `"dblink_exec"` count like unquoted ones;
//   - any Bash command carrying --approve-data-loss, even when quoted or escaped, asks first
//     (owner decision 2026-10-19): Claude runs it only after the product owner's explicit yes in
//     chat for that migration version (CLAUDE.md, D77), and the prompt is a second check at run
//     time. db:apply runs without a prompt only as `pnpm db:apply` or `pnpm db:apply --apply`;
//     any other db:apply command asks first.
// It is a safety net, not a parser: a function that changes rows or jobs when selected, SQL built
// from pieces at run time, a where clause that keeps every row in another way (`id > 0`,
// `id in (select id from t)`), or a Bash command that hides both `approve-data-loss` and
// `db-apply` behind a variable or glob is not seen, so the CLAUDE.md rule (explicit permission
// for irreversible data changes) still applies.
// Work is bounded: SQL longer than MAX_SQL_LENGTH, or SQL that needs more than WORK_LIMIT steps
// to check, asks first, so a slow check never runs into the hook timeout (which lets the call run).
// A call it cannot read (no tool name, or a Bash call without a command) asks first.
// It prints nothing for a call it has no concern with, and never prints the SQL or the command.
// Tests: tools/claude-hooks/data-loss-guard.test.ts.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type HookDecision = { decision: "ask"; reason: string } | null;

const SQL_TOOLS = new Set(["mcp__Supabase__execute_sql", "mcp__claude_ai_Supabase__execute_sql"]);
const ASK_DATA_LOSS =
  "This command carries --approve-data-loss. Run it only after the product owner's explicit yes in chat for this exact migration version (CLAUDE.md, D77, D81); without that yes, decline and report the migration and the data it removes. To search text for the flag, search for data-loss.";
const ASK_APPLY =
  "db:apply runs without a prompt only as `pnpm db:apply` (dry run) or `pnpm db:apply --apply`, alone on the line. Any other argument, pipe or chained command needs the product owner's yes (D81).";
const UNREADABLE: NonNullable<HookDecision> = {
  decision: "ask",
  reason: "The data-loss guard could not read this tool call.",
};
/** The only db:apply commands that keep the allow list's no-prompt run. */
const PLAIN_APPLY = /^\s*pnpm\s+db:apply(?:\s+--apply)?\s*$/;
/** Longer SQL asks first without being read: reading it could outlast the 10 s hook timeout. */
export const MAX_SQL_LENGTH = 100_000;
const ASK_TOO_LONG = `This SQL is longer than ${MAX_SQL_LENGTH} characters, too long for the data-loss guard to check. CLAUDE.md needs the product owner's explicit yes before an irreversible data change (D81).`;
/** Characters the checks may visit for one query, across every pass and quoted body. */
const WORK_LIMIT = 10_000_000;
const ASK_TOO_COMPLEX =
  "This SQL is too complex for the data-loss guard to check in time. CLAUDE.md needs the product owner's explicit yes before an irreversible data change (D81).";

/** Statements and clauses that change the schema, grants or many rows at once. */
const RISKY_WORDS =
  /\b(drop|truncate|alter|create|grant|revoke|merge|copy|vacuum|cluster|reindex|lock|execute|call|reassign|security\s+label|comment\s+on|import\s+foreign|refresh\s+materialized)\b/;
/** The first word of every Postgres statement: a literal that starts with one is checked as SQL. */
const STATEMENT_START =
  /(abort|alter|analy[sz]e|begin|call|checkpoint|close|cluster|comment|commit|copy|create|deallocate|declare|delete|discard|do|drop|end|execute|explain|fetch|grant|import|insert|listen|load|lock|merge|move|notify|prepare|reassign|refresh|reindex|release|reset|revoke|rollback|savepoint|security|select|set|show|start|table|truncate|unlisten|update|vacuum|values|with)(?![\w$])/iy;
/** Characters that continue a Postgres identifier; every non-ASCII character counts. */
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y;
/** The UESCAPE keyword, and the one-character literal that names the escape character. */
const UESCAPE = /uescape(?![\w$])/iy;
const UESCAPE_CHAR = /'([^'])'/y;
/** Postgres's whitespace (scan.l `space`); a no-break space continues an identifier instead. */
const PG_SPACE = /[ \t\n\r\f\v]/;
/** Words in a where clause that name no column. */
const CONSTANT_WORDS = new Set(
  "true false null not and or is isnull notnull unknown distinct from in between symmetric like ilike similar to escape any all some array case when then else end collate current_date current_time current_timestamp localtime localtimestamp current_user session_user user current_role select exists".split(
    " ",
  ),
);

/** A keyword as a whole word; `$` continues a word in Postgres. */
const keyword = (words: string, flags = "") =>
  new RegExp(`(?<![\\w$])(?:${words})(?![\\w$])`, flags);
const WHERE = keyword("where");
const RETURNING = keyword("returning");
const INSERT = keyword("insert");
const VALUES = keyword("values");
const OR = keyword("or", "g");
const AND = keyword("and", "g");
const NOT_DISTINCT = keyword("is\\s+not\\s+distinct\\s+from");
const OPERATORS = /[<>=~!@#%^&|`?+\-*/]+/g;
const IDENTIFIER = /(?<![\w$])(?:""|[a-z_][\w$]*)/g;
/** What a row-lock clause (`for update`, `for no key update`) can continue with. */
const LOCK_CLAUSE_GOES_ON =
  /\s*(?:$|[;)]|(?:of|nowait|skip|for|limit|offset|fetch|into)(?![\w$]))/y;
/** `update [only] name[.name] [*] [[as] alias] set`: an update statement, also after `for`. */
const UPDATE_TARGET =
  /\s*(?:only\s+)?(?:""|[a-z_][\w$]*)(?:\s*\.\s*(?:""|[a-z_][\w$]*))*(?:\s*\*)?(?:\s+(?:as\s+)?(?:""|[a-z_][\w$]*))?\s+set(?![\w$])/y;

/** Thrown when one query needs more than WORK_LIMIT steps; the hook then asks. */
class TooMuchWork extends Error {}
let work = 0;
/** Counts `chars` visited; every pass over the SQL pays for its length, so no input runs long. */
function spend(chars: number): void {
  work += chars;
  if (work > WORK_LIMIT) throw new TooMuchWork();
}

interface Scanned {
  /** Lower-cased SQL without comments; literal and quoted-identifier contents are blanked. */
  code: string;
  /** Contents of dollar-quoted bodies, of every literal in a `do`, and of literals that read like statements. */
  bodies: string[];
  /** `code` with the contents of quoted identifiers kept (`""` and U&"…" escapes applied). */
  named: string;
  /**
   * `named` with the contents of literals and dollar quotes kept too, without `;`, quotes or
   * parentheses, so a statement still ends at its own `;`. Only for finding words in a setting.
   */
  valued: string;
  /** True when a UESCAPE clause names its escape character in a way this scan does not read. */
  unreadableEscape: boolean;
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

/**
 * Index of the quote that continues the literal closed at `end`, or -1. Postgres joins two
 * literals when only whitespace with at least one newline separates them; `--` comments may sit
 * in it, block comments may not. Scanned by hand: a regex here could backtrack on runs of `-`.
 */
function continuedAt(sql: string, end: number): number {
  let j = end + 1;
  let newline = false;
  while (j < sql.length) {
    const char = sql[j] as string;
    if (char === "\n" || char === "\r") {
      newline = true;
      j++;
    } else if (char === " " || char === "\t" || char === "\f" || char === "\v") j++;
    else if (char === "-" && sql[j + 1] === "-") {
      while (j < sql.length && sql[j] !== "\n" && sql[j] !== "\r") j++;
    } else break;
  }
  return newline && sql[j] === "'" ? j : -1;
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

/**
 * For every index, 1 when the character belongs to a run of identifier characters that began
 * with a letter or `_`: a `$` right after such a character continues an identifier such as `a$b`
 * and opens no dollar quote. One pass, so a long run of `$` costs no more than its length.
 */
function identifierRuns(sql: string): Uint8Array {
  const runs = new Uint8Array(sql.length);
  let run: "none" | "identifier" | "other" = "none";
  for (let k = 0; k < sql.length; k++) {
    const char = sql[k] as string;
    if (!IDENT_CHAR.test(char)) run = "none";
    else if (run === "none") run = IDENT_START.test(char) ? "identifier" : "other";
    runs[k] = run === "identifier" ? 1 : 0;
  }
  return runs;
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

/** The text of a U&'…' literal or U&"…" identifier, with its Unicode escapes applied. */
function decodeUnicode(raw: string, escapeChar: string, quote: "'" | '"' = "'"): string {
  const e = escapeChar.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
  return raw.replace(
    new RegExp(`${quote}${quote}|${e}(${e}|\\+[0-9a-fA-F]{6}|[0-9a-fA-F]{4})`, "g"),
    (_all: string, value: string | undefined) => {
      if (value === undefined) return quote;
      if (value === escapeChar) return escapeChar;
      return codePoint(value.replace("+", ""));
    },
  );
}

/** Index just past the whitespace and comments at `i`, which Postgres skips between tokens. */
function skipBlanks(sql: string, i: number): number {
  let j = i;
  while (j < sql.length) {
    if (PG_SPACE.test(sql[j] as string)) j++;
    else if (sql.startsWith("--", j)) {
      while (j < sql.length && sql[j] !== "\n" && sql[j] !== "\r") j++;
    } else if (sql.startsWith("/*", j)) j = blockCommentEnd(sql, j);
    else break;
  }
  spend(j - i);
  return j;
}

/**
 * The UESCAPE clause of the U&'…' literal or U&"…" identifier that ends just before `i`: the
 * escape character it names (`\` without a clause) and the index just past the clause. Postgres
 * reads the clause as the next tokens, so comments may sit before and after the keyword, and the
 * clause belongs to the token: `u&"x" uescape '!'.f()` calls x.f. `escapeChar` is undefined when
 * the clause names it in a form this scan does not read (such as E'!' or $$!$$).
 */
function uescapeClause(sql: string, i: number): { escapeChar: string | undefined; end: number } {
  UESCAPE.lastIndex = skipBlanks(sql, i);
  if (!UESCAPE.test(sql)) return { escapeChar: "\\", end: i };
  UESCAPE_CHAR.lastIndex = skipBlanks(sql, UESCAPE.lastIndex);
  const found = UESCAPE_CHAR.exec(sql);
  return found
    ? { escapeChar: found[1], end: UESCAPE_CHAR.lastIndex }
    : { escapeChar: undefined, end: i };
}

/** True when `text`, after leading blanks, `(`, `;` and comments, starts like a statement. */
function startsLikeStatement(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    if (/[\s(;]/.test(text[i] as string)) i++;
    else if (text.startsWith("--", i)) {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
    } else if (text.startsWith("/*", i)) i = blockCommentEnd(text, i);
    else break;
  }
  STATEMENT_START.lastIndex = i;
  return STATEMENT_START.test(text);
}

/** True when the quote at `i` follows a `U&` that starts a token, as in U&'…' and U&"…". */
function unicodePrefix(sql: string, i: number): boolean {
  return sql[i - 1] === "&" && /[uU]/.test(sql[i - 2] ?? "") && !IDENT_CHAR.test(sql[i - 3] ?? "");
}

/** Removes comments and sets literals aside, the way Postgres reads them. */
function scan(sql: string): Scanned {
  spend(sql.length);
  const runs = identifierRuns(sql);
  const parts: string[] = [];
  const bodies: string[] = [];
  // Contents of quoted identifiers, by their index in `parts`.
  const names = new Map<number, string>();
  // Contents of literals and dollar quotes, by their index in `parts`.
  const values = new Map<number, string>();
  let unreadableEscape = false;
  /** The UESCAPE clause after the U& token that ends at `end`, noting one it cannot read. */
  const clauseAfter = (end: number) => {
    const clause = uescapeClause(sql, end + 1);
    if (clause.escapeChar === undefined) unreadableEscape = true;
    return { escapeChar: clause.escapeChar ?? "\\", end: clause.end };
  };
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
      const end = closingQuote(sql, i, char, false);
      const raw = sql.slice(i + 1, end);
      const clause = unicodePrefix(sql, i) ? clauseAfter(end) : undefined;
      names.set(
        parts.length,
        clause ? decodeUnicode(raw, clause.escapeChar, '"') : raw.replaceAll('""', '"'),
      );
      push('""');
      i = clause ? clause.end : end + 1;
    } else if (char === "'") {
      // E'…' and U&'…' only when the prefix starts a token: in `name'…'` the e ends an identifier.
      const escapes = /[eE]/.test(sql[i - 1] ?? "") && !IDENT_CHAR.test(sql[i - 2] ?? "");
      const unicode = unicodePrefix(sql, i);
      // A continued literal keeps the first one's escape mode, as Postgres does.
      let end = closingQuote(sql, i, char, escapes);
      const pieces = [sql.slice(i + 1, end)];
      for (let next = continuedAt(sql, end); next !== -1; next = continuedAt(sql, end)) {
        end = closingQuote(sql, next, char, escapes);
        pieces.push(sql.slice(next + 1, end));
      }
      const clause = unicode ? clauseAfter(end) : undefined;
      // Postgres applies E'…' escapes piece by piece, but U&'…' escapes to the joined text.
      const content = escapes
        ? pieces.map(decodeEscapes).join("")
        : clause
          ? decodeUnicode(pieces.join(""), clause.escapeChar)
          : pieces.join("").replaceAll("''", "'");
      if (/^do(?![\w$])/i.test(head) || startsLikeStatement(content)) bodies.push(content);
      values.set(parts.length, content);
      push("''");
      i = clause ? clause.end : end + 1;
    } else if (char === "$" && runs[i - 1] !== 1) {
      DOLLAR_TAG.lastIndex = i;
      const tag = DOLLAR_TAG.exec(sql)?.[0];
      if (!tag) {
        push(char);
        i++;
        continue;
      }
      const close = sql.indexOf(tag, i + tag.length);
      const body = sql.slice(i + tag.length, close === -1 ? sql.length : close);
      bodies.push(body);
      values.set(parts.length, body);
      push("$$");
      i = close === -1 ? sql.length : close + tag.length;
    } else {
      push(char);
      if (char === ";") head = "";
      i++;
    }
  }
  // Non-ASCII characters continue identifiers in Postgres, so they never separate words here.
  const normalise = (text: string) =>
    text
      .replace(/[\u0080-\uffff]/g, "_")
      .replace(/\s+/g, " ")
      .toLowerCase();
  const code = normalise(parts.join(""));
  const named = normalise(parts.map((part, k) => names.get(k) ?? part).join(""));
  spend(named.length);
  const valued = normalise(
    parts
      .map((part, k) => {
        const value = names.get(k) ?? values.get(k);
        return value === undefined ? part : ` ${value.replace(/[;'"()]/g, " ")} `;
      })
      .join(""),
  );
  spend(valued.length);
  return { code, named, valued, bodies, unreadableEscape };
}

/** `text` with the inside of every parenthesis blanked, so its indexes still line up. */
function topLevel(text: string): string {
  spend(text.length);
  let depth = 0;
  let out = "";
  // Start of the stretch not yet copied: kept as is at depth 0, blanked inside parentheses.
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") {
      if (depth === 0) {
        out += text.slice(from, i + 1);
        from = i + 1;
      }
      depth++;
    } else if (char === ")" && depth > 0) {
      depth--;
      if (depth === 0) {
        out += `${" ".repeat(i - from)})`;
        from = i + 1;
      }
    }
  }
  return out + (depth === 0 ? text.slice(from) : " ".repeat(text.length - from));
}

/** The statement that starts at `start`, up to its `;` or the `)` that closes its level. */
function statementFrom(code: string, start: number): string {
  let depth = 0;
  let end = code.length;
  for (let i = start; i < code.length; i++) {
    const char = code[i];
    if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    } else if (char === ";" && depth === 0) {
      end = i;
      break;
    }
  }
  spend(end - start);
  return code.slice(start, end);
}

/** Where the statement around index `at` starts: after its `;` or the `(` that opens its level. */
function statementStart(code: string, at: number): number {
  let depth = 0;
  let start = 0;
  for (let i = at - 1; i >= 0; i--) {
    const char = code[i];
    if (char === ")") depth++;
    else if (char === "(") {
      if (depth === 0) {
        start = i + 1;
        break;
      }
      depth--;
    } else if (char === ";" && depth === 0) {
      start = i + 1;
      break;
    }
  }
  spend(at - start);
  return start;
}

/** Splits `text` where the global `separator` matches outside parentheses. */
function splitTopLevel(text: string, separator: RegExp): string[] {
  const pieces: string[] = [];
  let from = 0;
  for (const match of topLevel(text).matchAll(separator)) {
    pieces.push(text.slice(from, match.index));
    from = match.index + match[0].length;
  }
  pieces.push(text.slice(from));
  return pieces;
}

/** `text` without the parentheses that wrap all of it; pairs are matched once, in one pass. */
function unwrap(text: string): string {
  const inner = text.trim();
  spend(inner.length);
  if (!inner.startsWith("(")) return inner;
  // closing[i]: index of the `)` that closes the `(` at i, or -1.
  const closing = new Int32Array(inner.length).fill(-1);
  const open: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "(") open.push(i);
    else if (inner[i] === ")") {
      const at = open.pop();
      if (at !== undefined) closing[at] = i;
    }
  }
  let start = 0;
  let end = inner.length - 1;
  while (inner[start] === "(" && closing[start] === end) {
    start++;
    end--;
    while (start <= end && /\s/.test(inner[start] as string)) start++;
    while (end >= start && /\s/.test(inner[end] as string)) end--;
  }
  return inner.slice(start, end + 1);
}

/** True when `text` names a column: an identifier that is not a keyword, a function or a type. */
function namesColumn(text: string): boolean {
  spend(text.length);
  for (const match of text.matchAll(IDENTIFIER)) {
    let before = match.index;
    while (before > 0 && /\s/.test(text[before - 1] as string)) before--;
    let after = match.index + match[0].length;
    while (after < text.length && /\s/.test(text[after] as string)) after++;
    // A type after `::`, a function call, or the prefix of a typed literal such as date '…'.
    if (text.startsWith("::", before - 2) || text[after] === "(" || text[after] === "'") continue;
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
  const ors = splitTopLevel(text, OR);
  if (ors.length > 1) return ors.some(keepsEveryRow);
  const ands = splitTopLevel(text, AND);
  if (ands.length > 1) return ands.every(keepsEveryRow);
  if (!namesColumn(text)) return true;
  const top = topLevel(text);
  const notDistinct = NOT_DISTINCT.exec(top);
  if (notDistinct)
    return same(
      text.slice(0, notDistinct.index),
      text.slice(notDistinct.index + notDistinct[0].length),
    );
  const comparisons = [...top.matchAll(OPERATORS)].filter((match) =>
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
  const insert = INSERT.exec(top);
  if (!insert) return true;
  const own = top.slice(insert.index);
  return /\b(select|table)\b/.test(own) || !VALUES.test(own);
}

/** True when the word just before `at` (one space allowed: blanks are collapsed) is one of `words`. */
function afterWord(code: string, at: number, words: string[]): boolean {
  const end = code[at - 1] === " " ? at - 1 : at;
  return words.some(
    (word) => code.endsWith(word, end) && !/[\w$]/.test(code[end - word.length - 1] ?? ""),
  );
}

/** True when the `update` at `at`, after `for` or `for no key`, is a row lock and changes no row. */
function rowLock(code: string, at: number): boolean {
  const after = at + "update".length;
  // `open cur for update t set …` in plpgsql is an update statement.
  UPDATE_TARGET.lastIndex = after;
  if (UPDATE_TARGET.test(code)) return false;
  LOCK_CLAUSE_GOES_ON.lastIndex = after;
  return LOCK_CLAUSE_GOES_ON.test(code);
}

/** A delete or update that can reach every row, or null. */
function unrestricted(code: string): string | null {
  for (const match of code.matchAll(/\b(delete|update)\b/g)) {
    if (match[1] === "update" && afterWord(code, match.index, ["do"])) {
      if (upsertFromQuery(code, match.index)) return "an upsert that copies rows from a query";
      continue;
    }
    // `select … for update` and `for no key update` lock rows but change none.
    if (match[1] === "update" && afterWord(code, match.index, ["for", "key"])) {
      if (rowLock(code, match.index)) continue;
    }
    const statement = statementFrom(code, match.index);
    const where = WHERE.exec(topLevel(statement));
    if (!where) return `${match[1]} without a where clause`;
    let clause = statement.slice(where.index + where[0].length);
    const returning = RETURNING.exec(topLevel(clause));
    if (returning) clause = clause.slice(0, returning.index);
    if (keepsEveryRow(clause)) return `${match[1]} with a where clause that keeps every row`;
  }
  return null;
}

const SEARCH_PATH = keyword("search_path");
const CRON = keyword("cron");
const SETTER = keyword("set|set_config");

/**
 * True when a statement sets search_path (`set [session | local] search_path`, `set_config` or
 * an update of pg_settings) and names cron: cron's functions then run without the schema name,
 * which the `cron.schedule` check cannot see. Any statement naming search_path, cron and a
 * setter counts, so a value built from an expression still asks.
 */
function searchPathWithCron(valued: string): boolean {
  for (const statement of valued.split(";")) {
    if (SEARCH_PATH.test(statement) && CRON.test(statement) && SETTER.test(statement)) return true;
  }
  return false;
}

export const TOO_COMPLEX = "too complex to check in time";

/**
 * A short description of the first risk in the SQL, or null. Never contains the SQL itself.
 * Returns TOO_COMPLEX when checking it would take more than WORK_LIMIT steps.
 */
export function riskySql(sql: string): string | null {
  work = 0;
  try {
    return findRisk(sql, 0);
  } catch (error) {
    if (error instanceof TooMuchWork) return TOO_COMPLEX;
    throw error;
  }
}

function findRisk(sql: string, depth: number): string | null {
  if (depth > 5) return "deeply nested SQL";
  // These settings change how Postgres reads backslashes in literals, which this scan relies on.
  if (/standard_conforming_strings|backslash_quote/i.test(sql)) return "a string-reading setting";
  const { code, named, valued, bodies, unreadableEscape } = scan(sql);
  if (unreadableEscape) return "a UESCAPE clause the guard cannot read";
  const word = RISKY_WORDS.exec(code)?.[1];
  if (word) return word.replace(/\s+/, " ");
  // Also with quoted names read: `cron."schedule"` and `"dblink_exec"` name the same functions.
  for (const text of [code, named]) {
    if (/\bdblink/.test(text)) return "dblink";
    if (/\bcron\s?\.\s?(schedule|schedule_in_database|alter_job)\b/.test(text))
      return "scheduled SQL";
  }
  if (searchPathWithCron(valued)) return "a search_path that includes cron";
  const rows = unrestricted(code);
  if (rows) return rows;
  for (const body of bodies) {
    const inner = findRisk(body, depth + 1);
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
  if (plain.includes("approve-data-loss")) return { decision: "ask", reason: ASK_DATA_LOSS };
  // `$…` expansions, eval, pipes or extra arguments must not ride on the allow-listed prefix.
  if (/db[:-]apply/.test(plain) && !PLAIN_APPLY.test(command))
    return { decision: "ask", reason: ASK_APPLY };
  return null;
}

/**
 * The hook's decision for one tool call; null leaves the normal permission flow. A call it cannot
 * read asks: if Claude Code renamed a field, a silent guard would leave the allow list unasked.
 */
export function decide(input: unknown): HookDecision {
  const tool = field(input, "tool_name");
  const toolInput = field(input, "tool_input");
  if (typeof tool !== "string") return UNREADABLE;
  if (tool === "Bash") {
    const command = field(toolInput, "command");
    return typeof command === "string" ? decideCommand(command) : UNREADABLE;
  }
  if (SQL_TOOLS.has(tool)) {
    const query = field(toolInput, "query");
    if (typeof query !== "string")
      return {
        decision: "ask",
        reason: "The SQL of this call could not be read.",
      };
    if (query.length > MAX_SQL_LENGTH) return { decision: "ask", reason: ASK_TOO_LONG };
    const found = riskySql(query);
    if (found === TOO_COMPLEX) return { decision: "ask", reason: ASK_TOO_COMPLEX };
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
 * The native realpath spells a Windows path one way, but the drive letter's case may still differ.
 */
function runAsHook(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const self = realpathSync.native(fileURLToPath(import.meta.url));
    const run = realpathSync.native(entry);
    return process.platform === "win32" ? run.toLowerCase() === self.toLowerCase() : run === self;
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
    decision = UNREADABLE;
  }
  if (decision) process.stdout.write(output(decision));
}
