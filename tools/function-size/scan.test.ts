import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT_MB,
  MEGABYTE,
  measureFunctions,
  measureManifest,
  parseLimitMb,
  summarize,
} from "./scan.ts";

// OPS-06: Vercel refuses a Function above 250 MB. The guard measures what each traced Function
// would ship, from synthetic manifests here, and fails the build well before that limit.

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "recalino-function-size-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A file of `bytes` bytes at `path` below the temporary root. */
function file(path: string, bytes: number) {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, Buffer.alloc(bytes));
  return full;
}
/** A `.nft.json` the way Next writes it: paths relative to the manifest's own directory. */
function manifest(path: string, files: string[]) {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify({ version: 1, files }));
  return full;
}

describe("measureManifest", () => {
  it("sums the files the manifest lists, relative to the manifest", () => {
    file("lib/a.bin", 1000);
    file("lib/b.bin", 234);
    const path = manifest("server/app/api/x/route.js.nft.json", [
      "../../../../lib/a.bin",
      "../../../../lib/b.bin",
    ]);
    expect(measureManifest(path)).toMatchObject({ bytes: 1234, files: 2, missing: 0 });
  });

  it("counts a file once however often or however it is listed", () => {
    const real = file("store/pkg/lib.so", 500);
    mkdirSync(join(root, "linked"));
    symlinkSync(real, join(root, "linked/lib.so"));
    symlinkSync(join(root, "store/pkg"), join(root, "linked/pkg"));
    const path = manifest("server/route.js.nft.json", [
      "../store/pkg/lib.so",
      "../store/pkg/lib.so",
      "../linked/lib.so",
      "../linked/pkg/lib.so",
    ]);
    expect(measureManifest(path)).toMatchObject({ bytes: 500, files: 1 });
  });

  it("does not count a symlink as bytes of its own", () => {
    const real = file("store/a.bin", 700);
    symlinkSync(real, join(root, "link.bin"));
    const path = manifest("server/route.js.nft.json", ["../link.bin"]);
    expect(measureManifest(path)).toMatchObject({ bytes: 700, files: 1 });
  });

  it("reports a listed file that is not on disk instead of failing", () => {
    file("lib/a.bin", 10);
    const path = manifest("server/route.js.nft.json", ["../lib/a.bin", "../lib/gone.bin"]);
    expect(measureManifest(path)).toMatchObject({ bytes: 10, files: 1, missing: 1 });
  });

  it("ignores directories", () => {
    mkdirSync(join(root, "lib/dir"), { recursive: true });
    file("lib/a.bin", 10);
    const path = manifest("server/route.js.nft.json", ["../lib/dir", "../lib/a.bin"]);
    expect(measureManifest(path)).toMatchObject({ bytes: 10, files: 1 });
  });

  it("refuses a manifest it cannot read as a file list", () => {
    const path = join(root, "bad.nft.json");
    writeFileSync(path, '{"version":1}');
    expect(() => measureManifest(path)).toThrow("function_size_manifest_invalid");
  });
});

describe("measureFunctions", () => {
  it("finds every manifest below the directory, largest first", () => {
    file("lib/big.bin", 900);
    file("lib/small.bin", 100);
    manifest("server/app/a/route.js.nft.json", ["../../../lib/small.bin"]);
    manifest("server/app/b/c/page.js.nft.json", ["../../../../lib/big.bin"]);
    manifest("server/app/b/c/other.txt", []);
    const sizes = measureFunctions(join(root, "server/app"));
    expect(sizes.map((size) => [size.manifest, size.bytes])).toEqual([
      ["b/c/page.js.nft.json", 900],
      ["a/route.js.nft.json", 100],
    ]);
  });
});

describe("summarize", () => {
  const sizes = [
    { manifest: "a.nft.json", bytes: 200 * MEGABYTE, files: 3, missing: 0 },
    { manifest: "b.nft.json", bytes: 100 * MEGABYTE, files: 2, missing: 1 },
  ];

  it("reports the largest function and the count", () => {
    expect(summarize(sizes, DEFAULT_LIMIT_MB)).toEqual({
      limitMb: 225,
      functions: 2,
      largestMb: 200,
      largest: "a.nft.json",
      overLimit: [],
      missingFiles: 1,
    });
  });

  it("lists the functions above a lower limit", () => {
    expect(summarize(sizes, 150).overLimit).toEqual([{ manifest: "a.nft.json", mb: 200 }]);
    expect(summarize(sizes, 50).overLimit).toHaveLength(2);
  });

  it("treats a function exactly at the limit as within it", () => {
    expect(summarize(sizes, 200).overLimit).toEqual([]);
  });

  it("copes with no function at all", () => {
    expect(summarize([], 225)).toMatchObject({ functions: 0, largestMb: 0, overLimit: [] });
  });
});

describe("parseLimitMb", () => {
  it("defaults to 225 MB, which leaves room under the 250 MB platform limit", () => {
    expect(DEFAULT_LIMIT_MB).toBe(225);
    expect(parseLimitMb([], {})).toBe(225);
  });

  it("takes the flag over the variable", () => {
    expect(parseLimitMb(["--limit-mb", "180"], { RECALINO_FUNCTION_SIZE_LIMIT_MB: "100" })).toBe(
      180,
    );
    expect(parseLimitMb([], { RECALINO_FUNCTION_SIZE_LIMIT_MB: "100" })).toBe(100);
  });

  it.each(["0", "-5", "abc", "", "1e3x"])("rejects %j", (value) => {
    expect(() => parseLimitMb(["--limit-mb", value], {})).toThrow("function_size_limit_invalid");
  });
});

describe("check command", () => {
  const command = join(import.meta.dirname, "check.ts");
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [command, "--dir", join(root, "server/app"), ...args], {
      encoding: "utf8",
    });

  beforeEach(() => {
    file("lib/a.bin", 3 * MEGABYTE);
    manifest("server/app/api/x/route.js.nft.json", ["../../../../lib/a.bin"]);
  });

  it("logs the numbers as JSON and passes under the limit", () => {
    const result = run();
    expect(result.status).toBe(0);
    const line = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(line.functionSize).toMatchObject({
      limitMb: 225,
      functions: 1,
      largestMb: 3,
      largest: "api/x/route.js.nft.json",
      overLimit: [],
    });
  });

  it("fails with a lower limit and names the function", () => {
    const result = run("--limit-mb", "2");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("function_size_limit_exceeded");
    expect(result.stderr).toContain("api/x/route.js.nft.json");
    expect(JSON.parse(result.stdout.trim()).functionSize.overLimit).toHaveLength(1);
  });

  it("fails when there is no build to measure", () => {
    const result = spawnSync(process.execPath, [command, "--dir", join(root, "does-not-exist")], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("function_size_build_missing");
  });
});
