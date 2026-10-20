import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("return path after sign-in (FR-PLT-001)", () => {
  it.each([
    "/me",
    "/setup?step=3",
    "/today#review",
    "/sessions/7d3f4c2e-1b2a-4c5d-8e9f-0a1b2c3d4e5f/notes?x=1#a",
  ])("keeps %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    "https://evil.example/today",
    "//evil.example/today",
    "/\\evil.example",
    // SEC-01: dot segments that normalise into a protocol-relative "//host" path.
    "/..//evil.com",
    "/x/..//evil.com",
    "/./..//evil.com",
    "/.//evil.com/x",
    "javascript:alert(1)",
    "today",
    "",
    null,
    undefined,
  ])("refuses %s", (path) => {
    expect(safeReturnPath(path)).toBe("/today");
  });
});
