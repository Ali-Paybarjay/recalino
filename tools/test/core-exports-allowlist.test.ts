import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// RR-26 (ARCH-F-6), R-27: every public entry point of @recalino/core is listed here on purpose.
// A new key in packages/core/package.json "exports" must be added to this list in the same change,
// and a key that does not point at a module index must say why it exists.

/** Module entry points: each one is `./src/<module>/index.ts`. */
const INDEX_SUBPATHS = [
  "./db",
  "./plt",
  "./acc",
  "./org",
  "./quota",
  "./src",
  "./aip",
  "./lkm",
  "./voc",
  "./proc",
  "./note",
  "./card",
  "./srs",
  "./pers",
  "./media",
  "./priv",
  "./html",
  "./anki",
  "./ops",
  "./eval",
  "./support",
] as const;

/** Entry points that are not a module index, each with the one-line reason it is public. */
const NON_INDEX_SUBPATHS: Readonly<Record<string, string>> = {
  "./config": "the env schema alone, so a caller can validate DATABASE_URL without loading ./db.",
  "./study-render":
    "study card rendering from lkm without the whole ./lkm index and its server-side code.",
  "./study-target": "the study pronunciation target schema, usable without the whole ./lkm index.",
  "./card-html": "the study card HTML boundary check, usable without the whole ./lkm index.",
  "./study-export": "study card export formatting, usable without the whole ./lkm index.",
  "./voice-contracts": "zod-only voice contracts, usable without the whole ./voc index.",
  "./plt/vercel-blob":
    "the only file that imports the @vercel/blob SDK, kept out of ./plt so it loads only where wanted.",
};

const ALLOWED_KEYS: readonly string[] = [...INDEX_SUBPATHS, ...Object.keys(NON_INDEX_SUBPATHS)];

function readCoreExports(): Record<string, string> {
  const manifest = JSON.parse(
    readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8"),
  ) as { exports?: Record<string, string> };
  if (!manifest.exports || typeof manifest.exports !== "object") {
    throw new Error("packages/core/package.json has no exports map");
  }
  return manifest.exports;
}

/** Throws with the unexpected and missing keys when the exports keys differ from the allowlist. */
function assertExportsMatchAllowlist(exportsMap: Record<string, string>): void {
  const actual = new Set(Object.keys(exportsMap));
  const allowed = new Set(ALLOWED_KEYS);
  const unexpected = [...actual].filter((key) => !allowed.has(key)).sort();
  const missing = [...allowed].filter((key) => !actual.has(key)).sort();
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `core exports differ from the allowlist; unexpected: [${unexpected.join(", ")}], missing: [${missing.join(", ")}]. ` +
        "Update tools/test/core-exports-allowlist.test.ts together with packages/core/package.json.",
    );
  }
}

describe("@recalino/core exports allowlist", () => {
  it("lists exactly the 28 current keys, with no duplicates", () => {
    expect(ALLOWED_KEYS).toHaveLength(28);
    expect(new Set(ALLOWED_KEYS).size).toBe(ALLOWED_KEYS.length);
  });

  it("matches the exports keys of packages/core/package.json", () => {
    const exportsMap = readCoreExports();
    expect(() => assertExportsMatchAllowlist(exportsMap)).not.toThrow();
    expect(Object.keys(exportsMap).sort()).toEqual([...ALLOWED_KEYS].sort());
  });

  it("gives a one-line reason for every key that is not a module index", () => {
    const exportsMap = readCoreExports();
    for (const [key, target] of Object.entries(exportsMap)) {
      if ((INDEX_SUBPATHS as readonly string[]).includes(key)) {
        expect(target, key).toBe(`./src/${key.slice(2)}/index.ts`);
        continue;
      }
      const reason = NON_INDEX_SUBPATHS[key];
      expect(reason, key).toBeTypeOf("string");
      expect(reason?.trim().length, key).toBeGreaterThan(0);
      expect(reason, key).not.toMatch(/\n/);
    }
  });

  it("fails when a key is added without updating the allowlist", () => {
    const withExtra = { ...readCoreExports(), "./fabricated-extra": "./src/fabricated/index.ts" };
    expect(() => assertExportsMatchAllowlist(withExtra)).toThrow(
      /unexpected: \[\.\/fabricated-extra\]/,
    );
  });

  it("fails when an allowlisted key is removed from exports", () => {
    const { "./config": _removed, ...withoutConfig } = readCoreExports();
    expect(() => assertExportsMatchAllowlist(withoutConfig)).toThrow(/missing: \[\.\/config\]/);
  });
});
