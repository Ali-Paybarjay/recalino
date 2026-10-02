import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("return path after sign-in (FR-PLT-001)", () => {
  it.each(["/me", "/setup?step=3", "/today#review"])("keeps %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    "https://evil.example/today",
    "//evil.example/today",
    "/\\evil.example",
    "javascript:alert(1)",
    "today",
    "",
    null,
    undefined,
  ])("refuses %s", (path) => {
    expect(safeReturnPath(path)).toBe("/today");
  });
});
