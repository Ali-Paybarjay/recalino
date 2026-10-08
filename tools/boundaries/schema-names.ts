// ADR-0002 rule 4: production code references a module's tables only inside
// packages/core/src/<module>/. Test files are exempt so they can observe effects.
// Table names come from the generated DB types, so the check knows every real table.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface SourceFile {
  path: string;
  content: string;
}

export interface SchemaNameViolation {
  path: string;
  table: string;
}

/** Qualified table names ("plt.idempotency_key") declared in the generated DB interface. */
export function tablesFromGeneratedTypes(typesSource: string): string[] {
  const block = typesSource.match(/export interface DB \{([\s\S]*?)\}/)?.[1] ?? "";
  return [...block.matchAll(/"([a-z_]+\.[a-z_]+)"\s*:/g)].map((match) => match[1] as string);
}

export function findSchemaNameViolations(
  files: SourceFile[],
  tables: string[],
): SchemaNameViolation[] {
  const violations: SchemaNameViolation[] = [];
  for (const file of files) {
    // Tests may read any table to observe effects; the rule protects production code.
    if (/\.(test|spec)\.tsx?$/.test(file.path) || /^packages\/[^/]+\/test\//.test(file.path))
      continue;
    for (const table of tables) {
      const schema = table.split(".")[0];
      const ownFolder = `packages/core/src/${schema}/`;
      if (file.path.startsWith(ownFolder)) continue;
      const pattern = new RegExp(`(^|[^A-Za-z0-9_])${table.replace(".", "\\.")}([^A-Za-z0-9_]|$)`);
      if (pattern.test(file.content)) violations.push({ path: file.path, table });
    }
  }
  return violations;
}

const CODE_FILE = /\.(ts|tsx|js|mjs|cjs)$/;
const SKIP_DIR = new Set(["node_modules", ".next", "fixture", "test-results", "playwright-report"]);

/** Code files under the given repo-relative roots, with forward-slash paths. */
export function readCodeFiles(repoRoot: string, roots: string[]): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIR.has(entry.name)) walk(join(dir, entry.name));
      } else if (CODE_FILE.test(entry.name)) {
        const absolute = join(dir, entry.name);
        const path = relative(repoRoot, absolute).split(sep).join("/");
        if (path !== "packages/core/src/db/types.ts") {
          files.push({ path, content: readFileSync(absolute, "utf8") });
        }
      }
    }
  };
  for (const root of roots) walk(join(repoRoot, root));
  return files;
}
