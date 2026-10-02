import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLegalModule, OUTPUT, parseHeader, ROOT } from "./build.ts";

describe("legal texts in the app (Q-ACC-3)", () => {
  it("are up to date with docs/legal (run `pnpm legal:build`)", () => {
    const fresh = buildLegalModule((path) => readFileSync(join(ROOT, path), "utf8"));
    expect(readFileSync(join(ROOT, OUTPUT), "utf8")).toBe(fresh);
  });

  it("read the version line", () => {
    expect(parseHeader("# T\n\nVersion 0.1 · Draft · 1 October 2026\n", "x")).toEqual({
      version: "0.1",
      draft: true,
      published: "2026-10-01",
    });
    expect(parseHeader("Version 1.0 · 12 March 2027", "x")).toEqual({
      version: "1.0",
      draft: false,
      published: "2027-03-12",
    });
    expect(() => parseHeader("no version here", "x")).toThrow("missing");
  });
});
