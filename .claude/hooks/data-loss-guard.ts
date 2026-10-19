// Claude Code PreToolUse hook (D81; SEC-05, audit 2026-10-18; owner decision 2026-10-19).
//
// .claude/settings.json keeps its allow list, so reads and ordinary writes run without a prompt.
// This hook adds the part the allow list cannot express:
//   - execute_sql (both Supabase connectors) asks first for SQL that can remove or rewrite data
//     or change the schema or grants: drop, truncate, alter, create, grant, revoke, merge, copy,
//     dynamic SQL, and a delete or update without a where clause that limits the rows;
//   - any Bash command carrying --approve-data-loss is denied: the product owner runs data-loss
//     migrations themselves.
// It is a safety net, not a parser: a function that deletes rows when selected is not seen, so
// the CLAUDE.md rule (explicit permission for irreversible data changes) still applies.
// It prints nothing for a call it has no concern with, and never prints the SQL or the command.
// Tests: tools/claude-hooks/data-loss-guard.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type HookDecision = { decision: "ask" | "deny"; reason: string } | null;

const SQL_TOOLS = new Set(["mcp__Supabase__execute_sql", "mcp__claude_ai_Supabase__execute_sql"]);
const DATA_LOSS_FLAG = "--approve-data-loss";
const DENY_DATA_LOSS =
  "Commands carrying --approve-data-loss are not run by Claude: the product owner runs data-loss migrations themselves (D81). Report the migration and the data it removes instead. To search for the flag in text, leave out its leading dashes.";

/** Statements and clauses that change the schema, grants or many rows at once. */
const RISKY_WORDS =
  /\b(drop|truncate|alter|create|grant|revoke|merge|copy|vacuum|cluster|reindex|lock|execute|call|reassign|security\s+label|comment\s+on|import\s+foreign|refresh\s+materialized)\b/;
/** A literal that reads like a statement (dynamic SQL) is checked as SQL too. */
const STATEMENT_START =
  /^\s*(drop|truncate|alter|create|grant|revoke|merge|copy|delete|update|insert|do|execute|with)\b/;
/** A where clause that keeps every row. */
const ALWAYS_TRUE = /^\s*\(?\s*(true|1\s*=\s*1|not\s+false)\s*\)?\s*(returning\b.*)?$/;

interface Scanned {
  /** Lower-cased SQL without comments; literal and quoted-identifier contents are blanked. */
  code: string;
  /** Contents of dollar-quoted bodies, and of string literals that read like statements. */
  bodies: string[];
}

/** Removes comments and sets literals aside, the way Postgres reads them. */
function scan(sql: string): Scanned {
  const parts: string[] = [];
  const bodies: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] as string;
    const next = sql[i + 1];
    if (char === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      parts.push(" ");
    } else if (char === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      parts.push(" ");
    } else if (char === "'" || char === '"') {
      const escapes = char === "'" && /[eE]/.test(sql[i - 1] ?? "");
      let end = i + 1;
      while (end < sql.length) {
        if (escapes && sql[end] === "\\") end += 2;
        else if (sql[end] === char && sql[end + 1] === char) end += 2;
        else if (sql[end] === char) break;
        else end++;
      }
      const content = sql.slice(i + 1, end);
      if (char === "'" && STATEMENT_START.test(content.toLowerCase())) bodies.push(content);
      parts.push(`${char}${char}`);
      i = end + 1;
    } else if (char === "$" && !/[\w$]/.test(sql[i - 1] ?? "")) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
      if (!tag) {
        parts.push(char);
        i++;
        continue;
      }
      const close = sql.indexOf(tag, i + tag.length);
      const end = close === -1 ? sql.length : close;
      bodies.push(sql.slice(i + tag.length, end));
      parts.push("$$");
      i = close === -1 ? sql.length : close + tag.length;
    } else {
      parts.push(char);
      i++;
    }
  }
  return { code: parts.join("").replace(/\s+/g, " ").toLowerCase(), bodies };
}

/** The statement text that follows `start` at its own nesting level, up to `;` or its `)`. */
function ownLevel(code: string, start: number): string {
  let depth = 0;
  let own = "";
  for (let i = start; i < code.length; i++) {
    const char = code[i];
    if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) break;
      depth--;
    } else if (char === ";" && depth === 0) break;
    else if (depth === 0) own += char;
  }
  return own;
}

/** A delete or update with no where clause that limits the rows, or null. */
function unrestricted(code: string): string | null {
  for (const match of code.matchAll(/\b(delete|update)\b/g)) {
    const before = code.slice(0, match.index).trimEnd();
    // `select … for update`, `for no key update` and an upsert's `do update` change no other row.
    if (match[1] === "update" && /\b(for|key|do)$/.test(before)) continue;
    const own = ownLevel(code, match.index);
    const where = /\bwhere\b(.*)$/.exec(own);
    if (!where || ALWAYS_TRUE.test(where[1] ?? "")) return `${match[1]} without a where clause`;
  }
  return null;
}

/** A short description of the first risk in the SQL, or null. Never contains the SQL itself. */
export function riskySql(sql: string, depth = 0): string | null {
  if (depth > 5) return "deeply nested SQL";
  const { code, bodies } = scan(sql);
  const word = RISKY_WORDS.exec(code)?.[1];
  if (word) return word.replace(/\s+/, " ");
  if (/\bdblink/.test(code)) return "dblink";
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

/** The hook's decision for one tool call; null leaves the normal permission flow. */
export function decide(input: unknown): HookDecision {
  const tool = field(input, "tool_name");
  const toolInput = field(input, "tool_input");
  if (tool === "Bash") {
    const command = field(toolInput, "command");
    if (typeof command === "string" && command.includes(DATA_LOSS_FLAG))
      return { decision: "deny", reason: DENY_DATA_LOSS };
    return null;
  }
  if (typeof tool === "string" && SQL_TOOLS.has(tool)) {
    const query = field(toolInput, "query");
    if (typeof query !== "string")
      return { decision: "ask", reason: "The SQL of this call could not be read." };
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let decision: HookDecision;
  try {
    decision = decide(JSON.parse(readFileSync(0, "utf8")));
  } catch {
    // A guard that cannot read the call asks instead of letting it through silently.
    decision = { decision: "ask", reason: "The data-loss guard could not read this tool call." };
  }
  if (decision) process.stdout.write(output(decision));
}
