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

/** SQL without comments and literal contents, so a scan matches statements, not prose. */
export function stripSqlNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Statements that remove or overwrite stored data. They need the owner's explicit yes for that
 * migration (D75, D77); dropping an index, constraint, policy, function, trigger or view, or a
 * column's default or NOT NULL, keeps every row and needs none.
 */
export function findDataLoss(sql: string): string[] {
  const found: string[] = [];
  for (const raw of stripSqlNoise(sql).split(";")) {
    const statement = raw.trim();
    if (!statement) continue;
    const short = statement.slice(0, 80);
    if (/^(drop (table|schema|materialized view|type|domain|sequence|extension))\b/.test(statement))
      found.push(short);
    else if (/^truncate\b/.test(statement)) found.push(short);
    else if (/^delete from\b/.test(statement)) found.push(short);
    else if (/^update\b/.test(statement) && !/\bwhere\b/.test(statement)) found.push(short);
    else if (/\bcascade\b/.test(statement) && /^drop\b/.test(statement)) found.push(short);
    else if (/^alter table\b/.test(statement) && dropsColumn(statement)) found.push(short);
  }
  return found;
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
