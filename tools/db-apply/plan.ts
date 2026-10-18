// Pure parts of `pnpm db:apply` (D77): migration file names, the data-loss scan and the SQL that
// applies one migration and records it the way the Supabase CLI does. No I/O here, so the rules
// are unit-tested on their own (plan.test.ts).

/** The only project this tool may touch (CLAUDE.md, Supabase MCP). */
export const PROJECT_REF = "twowhuzhvyuzjrpraikm";

export interface MigrationFile {
  version: string;
  name: string;
  file: string;
}

/** `20261014120000_anki_export_duplicate_indexes.sql` → version and name; null for other files. */
export function parseMigrationFile(file: string): MigrationFile | null {
  const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(file);
  return match ? { version: match[1] as string, name: match[2] as string, file } : null;
}

/** SQL with its comments removed and every literal replaced by a numbered placeholder. */
interface TokenizedSql {
  /** Statements text: `'#n'` stands for a string literal and `$n$` for a dollar-quoted one. */
  text: string;
  /** The raw content of each literal, by placeholder number. */
  literals: string[];
}

const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y;
const identifierChar = (char: string | undefined) =>
  char !== undefined && /[A-Za-z0-9_$\u0080-\uffff]/.test(char);
/** `$$` or `$tag$` opening at `index`, unless the `$` belongs to an identifier or a `$1` parameter. */
function dollarTag(sql: string, index: number): string | null {
  if (sql[index] !== "$" || identifierChar(sql[index - 1])) return null;
  DOLLAR_TAG.lastIndex = index;
  return DOLLAR_TAG.exec(sql)?.[0] ?? null;
}

/**
 * One pass over the SQL text, the way the server reads it: `--` and nested block comments go,
 * `'…'` (and `E'…'` with backslash escapes) and `$tag$…$tag$` literals are set aside, and
 * `"identifiers"` stay as written. `$1` and `a$b$c` are not dollar quotes.
 */
function tokenize(sql: string): TokenizedSql {
  const literals: string[] = [];
  const parts: string[] = [];
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
    } else if (char === "'") {
      const escapes = /[eE]/.test(sql[i - 1] ?? "") && !identifierChar(sql[i - 2]);
      let end = i + 1;
      while (end < sql.length) {
        if (escapes && sql[end] === "\\") end += 2;
        else if (sql[end] === "'" && sql[end + 1] === "'") end += 2;
        else if (sql[end] === "'") break;
        else end++;
      }
      parts.push(`'#${literals.length}'`);
      literals.push(sql.slice(i + 1, end));
      i = end + 1;
    } else if (char === '"') {
      let end = i + 1;
      while (end < sql.length) {
        if (sql[end] === '"' && sql[end + 1] === '"') end += 2;
        else if (sql[end] === '"') break;
        else end++;
      }
      parts.push(sql.slice(i, end + 1));
      i = end + 1;
    } else if (dollarTag(sql, i)) {
      const tag = dollarTag(sql, i) as string;
      const close = sql.indexOf(tag, i + tag.length);
      // An unterminated body runs to the end of the file; scanning it is the cautious choice.
      const end = close === -1 ? sql.length : close;
      parts.push(`$${literals.length}$`);
      literals.push(sql.slice(i + tag.length, end));
      i = close === -1 ? sql.length : close + tag.length;
    } else {
      parts.push(char);
      i++;
    }
  }
  return { text: parts.join(""), literals };
}

const normalize = (text: string) => text.replace(/\s+/g, " ").toLowerCase();

const LITERAL = String.raw`(?:'#(\d+)'|\$(\d+)\$)`;

/** Statements that keep PL/pgSQL control words in front of the SQL they run. */
const CONTROL_PREFIXES = [
  /^(?:begin|then|else|loop|exception|declare)\b\s*/,
  /^(?:if|elsif|elseif|while|when|for|foreach|case)\b[^;]*?\b(?:then|loop)\b\s*/,
  /^<<\w+>>\s*/,
];

/** The code a `do` block or `create function|procedure` statement carries, with a label. */
function codeBodies(statement: string, literals: string[]): { label: string; code: string }[] {
  const pick = (match: RegExpMatchArray | null) =>
    match ? (literals[Number(match[1] ?? match[2])] ?? "") : undefined;
  const bodies: { label: string; code: string }[] = [];
  if (/^do\b/.test(statement)) {
    const code = pick(
      statement.match(new RegExp(String.raw`^do\s+(?:language\s+\S+\s+)?${LITERAL}`)),
    );
    if (code !== undefined) bodies.push({ label: "in do block", code });
  } else if (/^create (?:or replace )?(?:function|procedure)\b/.test(statement)) {
    for (const match of statement.matchAll(new RegExp(String.raw`\bas\s+${LITERAL}`, "g")))
      bodies.push({ label: "in function body", code: pick(match) ?? "" });
  }
  return bodies;
}

/**
 * Statements that remove or overwrite stored data. They need the owner's explicit yes for that
 * migration (D75, D77); dropping an index, constraint, policy, function, trigger or view, or a
 * column's default or NOT NULL, keeps every row and needs none. The bodies of `do` blocks and
 * functions are read too (OPS-08): a `do $$ begin delete from x; end $$` removes rows just as a
 * plain `delete from x` does, and a function that does so is reviewed when it is created.
 */
export function findDataLoss(sql: string): string[] {
  return scan(sql, false);
}

/** `inBody`: the text is PL/pgSQL or SQL from a `do` block or a function, not a migration file. */
function scan(sql: string, inBody: boolean): string[] {
  const { text, literals } = tokenize(sql);
  const display = (statement: string) =>
    statement
      .replace(/'#\d+'/g, "''")
      .replace(/\$\d+\$/g, "$$$$")
      .slice(0, 80);
  const found: string[] = [];
  for (const raw of normalize(text).split(";")) {
    let statement = raw.trim();
    if (inBody) statement = withoutControlWords(statement);
    if (!statement) continue;
    if (losesData(statement)) found.push(display(statement));
    else {
      for (const { label, code } of codeBodies(statement, literals))
        for (const inner of scan(code, true)) found.push(`${label}: ${inner}`);
      // Dynamic SQL: `execute 'delete from x'` or `execute format('drop table %I', t)`.
      if (inBody)
        for (const match of statement.matchAll(
          new RegExp(String.raw`\bexecute\s+(?:format\s*\(\s*)?${LITERAL}`, "g"),
        ))
          found.push(...scan(literals[Number(match[1] ?? match[2])] ?? "", true));
    }
  }
  return found;
}

/** `begin delete from x` and `then update y set …` run the SQL after the control words. */
function withoutControlWords(statement: string): string {
  let current = statement;
  for (let changed = true; changed; ) {
    changed = false;
    for (const prefix of CONTROL_PREFIXES) {
      const stripped = current.replace(prefix, "");
      if (stripped !== current) {
        current = stripped;
        changed = true;
      }
    }
  }
  return current;
}

function losesData(statement: string): boolean {
  if (/^(drop (table|schema|materialized view|type|domain|sequence|extension))\b/.test(statement))
    return true;
  if (/^truncate\b/.test(statement)) return true;
  if (/^delete from\b/.test(statement)) return true;
  if (/^update\b/.test(statement) && !/\bwhere\b/.test(statement)) return true;
  if (/\bcascade\b/.test(statement) && /^drop\b/.test(statement)) return true;
  return /^alter table\b/.test(statement) && dropsColumn(statement);
}

/** `alter table … drop [column] x` loses data; `drop constraint` and `alter column … drop …` do not. */
function dropsColumn(statement: string): boolean {
  for (const match of statement.matchAll(/\bdrop (\w+)/g)) {
    const before = statement.slice(0, match.index).trimEnd();
    if (match[1] === "constraint" || /\balter (column )?\w+$/.test(before)) continue;
    return true;
  }
  return false;
}

/** One request body: the file and its history row in one transaction, as `db push` records it. */
export function applySql(migration: MigrationFile, sql: string, statementTimeout = "120s"): string {
  if (!/^\d{14}$/.test(migration.version) || !/^[a-z0-9_]+$/.test(migration.name))
    throw new Error(`invalid migration ${migration.file}`);
  let tag = "migration";
  while (sql.includes(`$${tag}$`)) tag += "_";
  return [
    "begin;",
    "set local lock_timeout = '5s';",
    `set local statement_timeout = '${statementTimeout}';`,
    // On its own line: the file may end with a comment that would swallow the terminator.
    `${sql.trim()}\n;`,
    "insert into supabase_migrations.schema_migrations (version, name, statements)",
    `values ('${migration.version}', '${migration.name}', array[$${tag}$${sql.trim()}$${tag}$]);`,
    "commit;",
  ].join("\n");
}
