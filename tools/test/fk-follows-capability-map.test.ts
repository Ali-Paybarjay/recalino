import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// RR-32 / R-24: a foreign key is a database dependency, so it must follow the capability map like an
// import does. This test only reads `supabase/migrations/*.sql` (it never runs SQL or changes a file),
// extracts every `references <schema>.<table>` and checks that the target schema is the source schema
// or a module in the transitive closure `allowedModules(source)` of `tools/capability-map.json`.
// Ownership of `learning_item` between LKM and CARD is not decided here (R-24, Architect).

const root = resolve(import.meta.dirname, "../..");
const migrationsDir = "supabase/migrations";

const require = createRequire(import.meta.url);
const { allowedModules } = require("../boundaries/rules.cjs") as {
  allowedModules: (name: string) => Set<string>;
};
const modules = Object.keys(
  (
    JSON.parse(readFileSync(resolve(root, "tools/capability-map.json"), "utf8")) as {
      modules: object;
    }
  ).modules,
);

/** Supabase owns `auth.users`; every module may point at it. */
const AUTH_USERS = "auth.users";

type Exception = {
  file: string;
  table: string;
  columns: string;
  references: string;
  decision: string;
};

/**
 * E95 (owner decision, option C, 2026-11-03) excepted the two `plt -> acc.user_account` FKs of the
 * notification migration as known debt. E105 (option A, 2026-11-04) removed them in migration
 * 20261104130100, so the list is empty: apart from `auth.users`, every FK follows the map. A new
 * FK against the map fails the test, and so does an entry here that no longer exists in the
 * migrations.
 */
const E95_EXCEPTIONS: readonly Exception[] = [];

type ForeignKey = {
  file: string;
  /** `schema.table` that holds the FK column. */
  table: string;
  /** FK columns, comma separated, in declaration order. */
  columns: string;
  /** `schema.table` the FK points at. */
  references: string;
  /** The constraint name: the declared one, or the name Postgres chooses by default. */
  constraint: string;
};

/** An `alter table <table> drop constraint <constraint>`; it removes an earlier FK of that name. */
type DroppedConstraint = { table: string; constraint: string };

type Extraction = { fks: ForeignKey[]; issues: string[]; drops: DroppedConstraint[] };

const IDENT = `(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const QUALIFIED = String.raw`(${IDENT})\s*\.\s*(${IDENT})`;
const TABLE_STATEMENT = new RegExp(
  String.raw`^\s*(create\s+(?:(?:unlogged|temp|temporary)\s+)?table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?)${QUALIFIED}`,
  "i",
);
const REFERENCES = /\breferences\b/gi;
const QUALIFIED_TARGET = new RegExp(String.raw`\breferences\s+${QUALIFIED}`, "gi");
const TABLE_LEVEL_FK = new RegExp(
  String.raw`^(?:add\s+)?(?:constraint\s+${IDENT}\s+)?foreign\s+key\s*\(([^)]*)\)`,
  "i",
);
const COLUMN_LEVEL_FK = new RegExp(
  String.raw`^(?:add\s+)?(?:column\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})\s`,
  "i",
);
const NAMED_CONSTRAINT = new RegExp(String.raw`^(?:add\s+)?constraint\s+(${IDENT})\s`, "i");
const COLUMN_CONSTRAINT = new RegExp(String.raw`\bconstraint\s+(${IDENT})\s+references\b`, "i");
const ALTER_TABLE = /^alter\s/i;
const DROP_CONSTRAINT = new RegExp(
  String.raw`^drop\s+constraint\s+(?:if\s+exists\s+)?(${IDENT})(?:\s+(?:cascade|restrict))?$`,
  "i",
);
/** Postgres `NAMEDATALEN - 1`: the longest identifier it keeps. */
const MAX_IDENTIFIER = 63;
const NOT_A_COLUMN = new Set([
  "constraint",
  "foreign",
  "primary",
  "unique",
  "check",
  "exclude",
  "like",
]);

function ident(name: string): string {
  return name.startsWith('"') ? name.slice(1, -1) : name.toLowerCase();
}

/**
 * The SQL with comments, string contents and dollar-quoted bodies blanked out (same length, so line
 * numbers hold), plus the raw dollar-quoted bodies, which this static check cannot attribute.
 */
function mask(sql: string): { masked: string; bodies: string[] } {
  const out = sql.split("");
  const bodies: string[] = [];
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      const stop = end < 0 ? sql.length : end;
      blank(i, stop);
      i = stop;
    } else if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else if (sql[i] === '"') {
      const end = sql.indexOf('"', i + 1);
      i = end < 0 ? sql.length : end + 1;
    } else {
      const tag = /^\$[a-z_]*\$/i.exec(rest)?.[0];
      if (tag === undefined) {
        i += 1;
        continue;
      }
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end < 0 ? sql.length : end;
      bodies.push(sql.slice(i + tag.length, stop));
      blank(i + tag.length, stop);
      i = stop + tag.length;
    }
  }
  return { masked: out.join(""), bodies };
}

/** Splits `text` on commas outside parentheses. */
function topLevelItems(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      items.push(text.slice(start, i));
      start = i + 1;
    }
  }
  items.push(text.slice(start));
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

/** The text between the first `(` at or after `from` and its matching `)`. */
function parenthesized(text: string, from: number): string | undefined {
  const open = text.indexOf("(", from);
  if (open < 0) return undefined;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return undefined;
}

function clauseColumns(clause: string): string | undefined {
  const tableLevel = TABLE_LEVEL_FK.exec(clause);
  if (tableLevel?.[1] !== undefined) {
    return tableLevel[1]
      .split(",")
      .map((name) => ident(name.trim()))
      .join(",");
  }
  const column = COLUMN_LEVEL_FK.exec(clause)?.[1];
  if (column === undefined || NOT_A_COLUMN.has(column.toLowerCase())) return undefined;
  return ident(column);
}

/**
 * The name Postgres gives an unnamed FK (`makeObjectName` with the `fkey` label): `<table>_<columns
 * joined by _>_fkey`, the longer part shortened first to fit 63 characters. A numeric suffix for a
 * clash is not modelled; such a name does not match a drop, so the FK stays counted.
 */
function defaultFkName(table: string, columns: string): string {
  const relation = table.split(".")[1] ?? table;
  const addition = columns.split(",").join("_").slice(0, MAX_IDENTIFIER);
  const label = "fkey";
  let first = relation.length;
  let second = addition.length;
  const available = MAX_IDENTIFIER - 1 - (label.length + 1);
  while (first + second > available) {
    if (first > second) first -= 1;
    else second -= 1;
  }
  return `${relation.slice(0, first)}_${addition.slice(0, second)}_${label}`;
}

function constraintName(clause: string, table: string, columns: string): string {
  const name = NAMED_CONSTRAINT.exec(clause)?.[1] ?? COLUMN_CONSTRAINT.exec(clause)?.[1];
  return name === undefined ? defaultFkName(table, columns) : ident(name);
}

function isDropped(fk: ForeignKey, drops: readonly DroppedConstraint[]): boolean {
  return drops.some((drop) => drop.table === fk.table && drop.constraint === fk.constraint);
}

/**
 * Every FK of one migration file that is still in place at its end, every `references` it could not
 * attribute to one, and every constraint it drops (which may remove an FK of an earlier file).
 */
function extractForeignKeys(file: string, sql: string): Extraction {
  const { masked, bodies } = mask(sql);
  let fks: ForeignKey[] = [];
  const issues: string[] = [];
  const drops: DroppedConstraint[] = [];
  for (const body of bodies) {
    if (/\breferences\b/i.test(body)) {
      issues.push(`${file}: 'references' inside a dollar-quoted body cannot be checked statically`);
    }
  }
  for (const statement of masked.split(";")) {
    const count = statement.match(REFERENCES)?.length ?? 0;
    const head = TABLE_STATEMENT.exec(statement);
    const keyword = head?.[1];
    const schema = head?.[2];
    const name = head?.[3];
    const table =
      schema === undefined || name === undefined ? "" : `${ident(schema)}.${ident(name)}`;
    const afterName = head === null ? 0 : head.index + head[0].length;
    if (table !== "" && keyword !== undefined && ALTER_TABLE.test(keyword)) {
      for (const action of topLevelItems(statement.slice(afterName))) {
        const dropped = DROP_CONSTRAINT.exec(action.replace(/\s+/g, " "))?.[1];
        if (dropped === undefined) continue;
        const drop = { table, constraint: ident(dropped) };
        drops.push(drop);
        fks = fks.filter((fk) => !isDropped(fk, [drop]));
      }
    }
    if (count === 0) continue;
    const oneLine = statement.trim().replace(/\s+/g, " ");
    if (head === null || keyword === undefined || table === "") {
      issues.push(
        `${file}: 'references' outside a schema-qualified create/alter table: ${oneLine}`,
      );
      continue;
    }
    const clauses = keyword.toLowerCase().startsWith("create")
      ? topLevelItems(parenthesized(statement, afterName) ?? "")
      : topLevelItems(statement.slice(afterName));
    let found = 0;
    for (const clause of clauses) {
      const targets = [...clause.matchAll(QUALIFIED_TARGET)];
      const inClause = clause.match(REFERENCES)?.length ?? 0;
      if (inClause === 0) continue;
      const columns = clauseColumns(clause);
      const target = targets[0];
      if (
        inClause !== 1 ||
        targets.length !== 1 ||
        target?.[1] === undefined ||
        target[2] === undefined
      ) {
        issues.push(`${file}: ${table}: FK target is not one schema-qualified table: ${clause}`);
      } else if (columns === undefined) {
        issues.push(`${file}: ${table}: FK column not found: ${clause}`);
      } else {
        fks.push({
          file,
          table,
          columns,
          references: `${ident(target[1])}.${ident(target[2])}`,
          constraint: constraintName(clause, table, columns),
        });
      }
      found += inClause;
    }
    if (found !== count)
      issues.push(`${file}: ${table}: ${count - found} 'references' not parsed: ${oneLine}`);
  }
  return { fks, issues, drops };
}

function sameException(fk: ForeignKey, exception: Exception): boolean {
  return (
    fk.file === exception.file &&
    fk.table === exception.table &&
    fk.columns === exception.columns &&
    fk.references === exception.references
  );
}

function describeFk(fk: ForeignKey): string {
  return `${fk.file}: ${fk.table}(${fk.columns}) -> ${fk.references}`;
}

/** Every FK against the capability map, and every exception no FK uses any more; empty when clean. */
function directionViolations(fks: ForeignKey[], exceptions: readonly Exception[]): string[] {
  const violations: string[] = [];
  const used = new Set<Exception>();
  for (const fk of fks) {
    const source = fk.table.split(".")[0] ?? "";
    const target = fk.references.split(".")[0] ?? "";
    if (fk.references === AUTH_USERS || source === target) continue;
    if (!modules.includes(source)) {
      violations.push(
        `${describeFk(fk)}: source schema '${source}' is not a capability-map module`,
      );
      continue;
    }
    if (!modules.includes(target)) {
      violations.push(
        `${describeFk(fk)}: target schema '${target}' is not a capability-map module`,
      );
      continue;
    }
    if (allowedModules(source).has(target)) continue;
    const exception = exceptions.find((entry) => sameException(fk, entry));
    if (exception !== undefined) {
      used.add(exception);
      continue;
    }
    const allowed = [...allowedModules(source)].sort().join(", ") || "no other module";
    violations.push(`${describeFk(fk)}: ${source} may reference only ${allowed}`);
  }
  for (const exception of exceptions) {
    if (!used.has(exception)) {
      violations.push(
        `${exception.decision} exception not found in the migrations: ${exception.file}: ${exception.table}(${exception.columns}) -> ${exception.references}`,
      );
    }
  }
  return violations;
}

function migrationFiles(): string[] {
  return readdirSync(resolve(root, migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => `${migrationsDir}/${name}`);
}

function readMigration(file: string): string {
  return readFileSync(resolve(root, file), "utf8");
}

/** The files in migration order: a drop removes the FKs of the earlier files, not the later ones. */
function extractAll(files: { file: string; sql: string }[]): Extraction {
  const all: Extraction = { fks: [], issues: [], drops: [] };
  for (const { file, sql } of files) {
    const { fks, issues, drops } = extractForeignKeys(file, sql);
    all.fks = all.fks.filter((fk) => !isDropped(fk, drops));
    all.fks.push(...fks);
    all.issues.push(...issues);
    all.drops.push(...drops);
  }
  return all;
}

function extractBase(): Extraction {
  return extractAll(migrationFiles().map((file) => ({ file, sql: readMigration(file) })));
}

const E95_FILE = `${migrationsDir}/20261007233920_plt_processing_notifications.sql`;
const E105_FILE = `${migrationsDir}/20261104130100_plt_drop_acc_user_foreign_keys.sql`;
const SYNTHETIC = "supabase/migrations/99999999999999_synthetic.sql";
const LATER = "supabase/migrations/99999999999999_synthetic_later.sql";

/** The two former E95 entries; they only exercise the exception mechanism, never the migrations. */
const SYNTHETIC_EXCEPTIONS: readonly Exception[] = [
  {
    file: E95_FILE,
    table: "plt.notification",
    columns: "user_id",
    references: "acc.user_account",
    decision: "E95",
  },
  {
    file: E95_FILE,
    table: "plt.push_subscription",
    columns: "user_id",
    references: "acc.user_account",
    decision: "E95",
  },
];

const NOTIFICATION_VIOLATIONS = [
  `${E95_FILE}: plt.notification(user_id) -> acc.user_account: plt may reference only no other module`,
  `${E95_FILE}: plt.push_subscription(user_id) -> acc.user_account: plt may reference only no other module`,
];

describe("foreign keys follow the capability map (RR-32, R-24)", () => {
  it("reads every migration and attributes every 'references' to one FK", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    const { fks, issues } = extractBase();
    expect(issues).toEqual([]);
    expect(fks.length).toBeGreaterThan(100);
    expect(fks).toContainEqual({
      file: `${migrationsDir}/20261006173727_voice_identity.sql`,
      table: "voc.analysis",
      columns: "session_id,user_id",
      references: "org.class_session",
      constraint: "analysis_session_id_user_id_fkey",
    });
    expect(fks.some((fk) => fk.references === AUTH_USERS)).toBe(true);
  });

  it("finds every FK on the migrations in the direction of the map, with no exception but auth.users", () => {
    expect(E95_EXCEPTIONS).toEqual([]);
    expect(directionViolations(extractBase().fks, E95_EXCEPTIONS)).toEqual([]);
  });

  it("keeps the E95 list empty, because E105 drops the two FKs of the notification migration", () => {
    const { fks } = extractForeignKeys(E95_FILE, readMigration(E95_FILE));
    expect(directionViolations(fks, [])).toEqual(NOTIFICATION_VIOLATIONS);
    expect(
      fks.filter((fk) => fk.references === "acc.user_account").map((fk) => fk.constraint),
    ).toEqual(["notification_user_id_fkey", "push_subscription_user_id_fkey"]);
    const dropMigration = extractForeignKeys(E105_FILE, readMigration(E105_FILE));
    expect(dropMigration).toEqual({
      fks: [],
      issues: [],
      drops: [
        { table: "plt.notification", constraint: "notification_user_id_fkey" },
        { table: "plt.push_subscription", constraint: "push_subscription_user_id_fkey" },
      ],
    });
    const base = extractBase();
    expect(
      base.fks.filter((fk) => fk.table.startsWith("plt.") && fk.references.startsWith("acc.")),
    ).toEqual([]);
  });

  it("fails an in-memory FK against the map and passes ones that follow it", () => {
    const sql = [
      "create table acc.synthetic (",
      "  id uuid primary key,",
      "  run_id uuid not null references proc.processing_run(id) on delete cascade,",
      "  owner_id uuid references acc.user_account(id),",
      "  auth_id uuid references auth.users(id),",
      "  job_id uuid references plt.job(id)",
      ");",
    ].join("\n");
    const { fks, issues } = extractForeignKeys(SYNTHETIC, sql);
    expect(issues).toEqual([]);
    expect(fks).toHaveLength(4);
    expect(directionViolations(fks, [])).toEqual([
      `${SYNTHETIC}: acc.synthetic(run_id) -> proc.processing_run: acc may reference only plt`,
    ]);
  });

  it("fails table-level and alter-table FKs against the map", () => {
    const sql = [
      "create table org.synthetic (",
      "  id uuid primary key, card_id uuid, user_id uuid,",
      "  constraint synthetic_card_fk foreign key (card_id, user_id) references card.card (id, user_id)",
      ");",
      "alter table only quota.entitlement add column note_id uuid references note.revision(id);",
      "alter table src.asset add constraint asset_srs_fk",
      "  foreign key (srs_id) references srs.review_event(id) on delete set null;",
    ].join("\n");
    const { fks, issues } = extractForeignKeys(SYNTHETIC, sql);
    expect(issues).toEqual([]);
    expect(directionViolations(fks, [])).toEqual([
      `${SYNTHETIC}: org.synthetic(card_id,user_id) -> card.card: org may reference only acc, plt`,
      `${SYNTHETIC}: quota.entitlement(note_id) -> note.revision: quota may reference only acc, plt`,
      `${SYNTHETIC}: src.asset(srs_id) -> srs.review_event: src may reference only acc, org, plt, quota`,
    ]);
  });

  it("fails an FK against the map outside an exception list, even in the excepted migration", () => {
    const sql = [
      readMigration(E95_FILE),
      "create table plt.synthetic (owner_id uuid not null references acc.user_account(id));",
      "alter table plt.notification add column author_id uuid references acc.user_account(id);",
      "alter table plt.push_subscription add constraint sub_org_fk foreign key (user_id) references org.course(id);",
    ].join("\n");
    const { fks, issues } = extractForeignKeys(E95_FILE, sql);
    expect(issues).toEqual([]);
    expect(directionViolations(fks, SYNTHETIC_EXCEPTIONS)).toEqual([
      `${E95_FILE}: plt.synthetic(owner_id) -> acc.user_account: plt may reference only no other module`,
      `${E95_FILE}: plt.notification(author_id) -> acc.user_account: plt may reference only no other module`,
      `${E95_FILE}: plt.push_subscription(user_id) -> org.course: plt may reference only no other module`,
    ]);
  });

  it("fails an exception entry that no longer exists in the migrations", () => {
    expect(directionViolations(extractBase().fks, SYNTHETIC_EXCEPTIONS)).toEqual([
      `E95 exception not found in the migrations: ${E95_FILE}: plt.notification(user_id) -> acc.user_account`,
      `E95 exception not found in the migrations: ${E95_FILE}: plt.push_subscription(user_id) -> acc.user_account`,
    ]);
    const original = extractForeignKeys(E95_FILE, readMigration(E95_FILE)).fks;
    expect(directionViolations(original, SYNTHETIC_EXCEPTIONS)).toEqual([]);
    const moved = original.map((fk) => ({
      ...fk,
      file: fk.file.replace("20261007233920", "20261007233921"),
    }));
    expect(directionViolations(moved, SYNTHETIC_EXCEPTIONS)).toHaveLength(4);
  });

  it("does not count an FK that a later drop constraint removes, and still counts one it does not", () => {
    const original = { file: E95_FILE, sql: readMigration(E95_FILE) };
    const e105 = { file: E105_FILE, sql: readMigration(E105_FILE) };
    const dropped = extractAll([original, e105]);
    expect(dropped.issues).toEqual([]);
    // Only the FKs inside PLT remain: push_delivery -> notification and -> push_subscription.
    expect(dropped.fks.map((fk) => `${fk.table}(${fk.columns}) -> ${fk.references}`)).toEqual([
      "plt.push_delivery(notification_id) -> plt.notification",
      "plt.push_delivery(subscription_id) -> plt.push_subscription",
    ]);
    expect(directionViolations(dropped.fks, [])).toEqual([]);
    // Repeating the idempotent drop changes nothing.
    expect(directionViolations(extractAll([original, e105, e105]).fks, [])).toEqual([]);
    // A drop only removes an FK of an earlier migration, on the same table, under the same name.
    expect(directionViolations(extractAll([e105, original]).fks, [])).toEqual(
      NOTIFICATION_VIOLATIONS,
    );
    const wrongName = [
      "alter table plt.notification drop constraint if exists notification_user_fkey;",
      "alter table plt.job drop constraint push_subscription_user_id_fkey;",
    ].join("\n");
    expect(
      directionViolations(extractAll([original, { file: LATER, sql: wrongName }]).fks, []),
    ).toEqual(NOTIFICATION_VIOLATIONS);
    // Dropping and adding the FK again, as 20261004062114 does for plt.job, keeps it counted.
    const readded = [
      "alter table plt.notification drop constraint notification_user_id_fkey,",
      "  add constraint notification_user_id_fkey foreign key (user_id) references acc.user_account(id);",
    ].join("\n");
    expect(
      directionViolations(extractAll([original, e105, { file: LATER, sql: readded }]).fks, []),
    ).toEqual([
      `${LATER}: plt.notification(user_id) -> acc.user_account: plt may reference only no other module`,
    ]);
    // In one file, with a declared name, `only`, quoting and `cascade`.
    const sameFile = [
      "create table plt.synthetic (owner_id uuid references acc.user_account(id), org_id uuid,",
      "  constraint synthetic_org_fk foreign key (org_id) references org.course(id));",
      "alter table plt.synthetic drop constraint synthetic_owner_id_fkey;",
      'alter table only plt."synthetic" drop constraint if exists "synthetic_org_fk" cascade;',
    ].join("\n");
    expect(extractForeignKeys(SYNTHETIC, sameFile)).toEqual({
      fks: [],
      issues: [],
      drops: [
        { table: "plt.synthetic", constraint: "synthetic_owner_id_fkey" },
        { table: "plt.synthetic", constraint: "synthetic_org_fk" },
      ],
    });
  });

  it("names an unnamed FK as Postgres does, shortening the longer part to 63 characters", () => {
    expect(defaultFkName("voc.analysis", "session_id,user_id")).toBe(
      "analysis_session_id_user_id_fkey",
    );
    const long = defaultFkName(
      "acc.a_very_long_table_name_that_goes_on_and_on_for_ever",
      "first_long_column_name,second_long_column_name",
    );
    expect(long).toBe("a_very_long_table_name_that_g_first_long_column_name_secon_fkey");
    expect(long).toHaveLength(63);
  });

  it("ignores comments and strings, and reports what it cannot attribute", () => {
    const sql = [
      "-- references proc.processing_run is only a comment",
      "/* create table acc.x (a uuid references card.card(id)); */",
      "comment on table acc.user_account is 'references card.card; not an FK';",
      "create table acc.unqualified (run_id uuid references processing_run(id));",
      "create table unschemed (run_id uuid references proc.processing_run(id));",
      "do $body$ begin execute 'alter table acc.y add column c uuid references card.card(id)'; end $body$;",
      "create table srs.synthetic (unknown_id uuid references public.thing(id));",
    ].join("\n");
    const { fks, issues } = extractForeignKeys(SYNTHETIC, sql);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toContain("dollar-quoted body");
    expect(issues[1]).toContain("acc.unqualified: FK target is not one schema-qualified table");
    expect(issues[2]).toContain("outside a schema-qualified create/alter table");
    expect(directionViolations(fks, [])).toEqual([
      `${SYNTHETIC}: srs.synthetic(unknown_id) -> public.thing: target schema 'public' is not a capability-map module`,
    ]);
  });
});
