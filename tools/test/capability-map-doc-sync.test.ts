import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// RR-23 / R-25: `tools/capability-map.json` is a copy of the "depends on" column of the capability
// table in docs/MVP_FUNCTIONAL_REQUIREMENTS_FA.md §3. This test parses that table and fails when the
// document and the JSON file disagree, so neither can change without the other.

const root = resolve(import.meta.dirname, "../..");
const documentPath = "docs/MVP_FUNCTIONAL_REQUIREMENTS_FA.md";
const mapPath = "tools/capability-map.json";

const SECTION_HEADING = "## ۳. نقشه قابلیت‌ها";
const ID_COLUMN = "شناسه";
const DEPENDS_COLUMN = "وابسته به";
/** The document writes "every data module"; the JSON file writes `*`. */
const ALL_DATA_MODULES = "همه ماژول‌های داده";
const NO_DEPENDENCY = "—";

type Modules = Record<string, string[]>;

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** The table lines of §3: the first run of `|` lines after the section heading. */
function sectionTable(document: string): string[] {
  const lines = document.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === SECTION_HEADING);
  if (heading < 0) throw new Error(`heading "${SECTION_HEADING}" not found`);
  const start = lines.findIndex((line, index) => index > heading && line.trim().startsWith("|"));
  if (start < 0) throw new Error("no table after the §3 heading");
  const end = lines.findIndex((line, index) => index > start && !line.trim().startsWith("|"));
  return lines.slice(start, end < 0 ? undefined : end);
}

function parseDependencies(cell: string): string[] {
  if (cell === NO_DEPENDENCY) return [];
  if (cell === ALL_DATA_MODULES) return ["*"];
  return cell
    .split(/[،,]/)
    .map((name) => name.trim().replace(/`/g, "").toLowerCase())
    .filter((name) => name !== "");
}

/** Module id to direct dependencies, read from the §3 capability table of the document. */
function parseCapabilityTable(document: string): Modules {
  const [header, separator, ...rows] = sectionTable(document);
  if (header === undefined || separator === undefined) throw new Error("§3 table has no header");
  const columns = cells(header);
  const idColumn = columns.indexOf(ID_COLUMN);
  const dependsColumn = columns.indexOf(DEPENDS_COLUMN);
  if (idColumn < 0 || dependsColumn < 0) throw new Error(`§3 table header: ${header}`);
  const modules: Modules = {};
  for (const row of rows) {
    const values = cells(row);
    const id = (values[idColumn] ?? "").replace(/`/g, "").toLowerCase();
    if (id === "" || id in modules) throw new Error(`bad or repeated module id in row: ${row}`);
    modules[id] = parseDependencies(values[dependsColumn] ?? "");
  }
  return modules;
}

/** Every disagreement between the document table and the JSON modules; empty when in sync. */
function capabilityDifferences(fromDocument: Modules, fromMap: Modules): string[] {
  const differences: string[] = [];
  const ids = [...new Set([...Object.keys(fromDocument), ...Object.keys(fromMap)])].sort();
  for (const id of ids) {
    const documented = fromDocument[id];
    const mapped = fromMap[id];
    if (documented === undefined) differences.push(`${id}: in ${mapPath}, not in the document`);
    else if (mapped === undefined) differences.push(`${id}: in the document, not in ${mapPath}`);
    else if (documented.join(",") !== mapped.join(",")) {
      differences.push(`${id}: document [${documented}] vs ${mapPath} [${mapped}]`);
    }
  }
  return differences;
}

function readDocument(): string {
  return readFileSync(resolve(root, documentPath), "utf8");
}

function readMap(): Modules {
  return (JSON.parse(readFileSync(resolve(root, mapPath), "utf8")) as { modules: Modules }).modules;
}

/** Replaces one exact substring of the document, failing loudly if the fixture text moved. */
function tamper(document: string, from: string, to: string): string {
  expect(document.split(from)).toHaveLength(2);
  return document.replace(from, to);
}

describe("capability map document sync (RR-23, R-25)", () => {
  it("parses all 21 modules of the §3 table, with '*' for every data module", () => {
    const modules = parseCapabilityTable(readDocument());
    expect(Object.keys(modules)).toHaveLength(21);
    expect(modules.plt).toEqual([]);
    expect(modules.src).toEqual(["org", "quota"]);
    expect(modules.priv).toEqual(["*"]);
  });

  it("matches the modules of tools/capability-map.json", () => {
    expect(capabilityDifferences(parseCapabilityTable(readDocument()), readMap())).toEqual([]);
  });

  it("catches a dependency removed from the document table", () => {
    const changed = tamper(readDocument(), "| CARD، MEDIA |", "| CARD |");
    expect(capabilityDifferences(parseCapabilityTable(changed), readMap())).toEqual([
      `anki: document [card] vs ${mapPath} [card,media]`,
    ]);
  });

  it("catches a dependency added to the document table", () => {
    const changed = tamper(readDocument(), "| SRC، AIP، QUOTA |", "| SRC، AIP، QUOTA، LKM |");
    expect(capabilityDifferences(parseCapabilityTable(changed), readMap())).toEqual([
      `media: document [src,aip,quota,lkm] vs ${mapPath} [src,aip,quota]`,
    ]);
  });

  it("catches 'every data module' replaced by a list", () => {
    const changed = tamper(readDocument(), `| ${ALL_DATA_MODULES} |`, "| SRC |");
    expect(capabilityDifferences(parseCapabilityTable(changed), readMap())).toEqual([
      `priv: document [src] vs ${mapPath} [*]`,
    ]);
  });

  it("catches a module missing from the document table", () => {
    const document = readDocument();
    const evalRow = document.split("\n").find((line) => line.startsWith("| `EVAL` |"));
    expect(evalRow).toBeDefined();
    const changed = tamper(document, `${evalRow}\n`, "");
    expect(capabilityDifferences(parseCapabilityTable(changed), readMap())).toEqual([
      `eval: in ${mapPath}, not in the document`,
    ]);
  });

  it("catches a module missing from the JSON modules", () => {
    const { voc: _removed, ...map } = readMap();
    expect(capabilityDifferences(parseCapabilityTable(readDocument()), map)).toEqual([
      `voc: in the document, not in ${mapPath}`,
    ]);
  });
});
