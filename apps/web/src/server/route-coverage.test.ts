import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRouteCoverage, routePathFromFile } from "./route-coverage";
import { ROUTES, type RouteMeta } from "./routes";

const APP_DIR = join(process.cwd(), "apps/web/src/app");
const CROSS_ACCOUNT_DIR = join(process.cwd(), "apps/web/src/server/cross-account");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [relative(APP_DIR, path).split(sep).join("/")] : [];
  });
}

function crossAccountTests(): string[] {
  if (!existsSync(CROSS_ACCOUNT_DIR)) return [];
  return readdirSync(CROSS_ACCOUNT_DIR)
    .filter((name) => name.endsWith(".int.test.ts"))
    .map((name) => name.replace(/\.int\.test\.ts$/, ""));
}

describe("API route coverage (FR-PLT-002, NFR-01)", () => {
  it("maps route files to URL paths", () => {
    expect(routePathFromFile("api/health/route.ts")).toBe("/api/health");
    expect(routePathFromFile("api/(learner)/classes/[id]/route.ts")).toBe("/api/classes/[id]");
  });

  it("reports unregistered routes and learner routes without a cross-account test", () => {
    const registry: RouteMeta[] = [
      { id: "health", path: "/api/health", access: "public" },
      { id: "classes", path: "/api/classes", access: "learner" },
      { id: "stale", path: "/api/stale", access: "public" },
    ];
    const problems = checkRouteCoverage({
      routeFiles: ["api/health/route.ts", "api/classes/route.ts", "api/secret/route.ts"],
      registry,
      crossAccountTests: [],
    });
    expect(problems).toEqual([
      "unregistered route: /api/secret",
      "learner route without a cross-account test: classes",
      "registered route without a file: /api/stale",
    ]);
  });

  it("holds for the app", () => {
    const problems = checkRouteCoverage({
      routeFiles: routeFiles(APP_DIR),
      registry: Object.values(ROUTES),
      crossAccountTests: crossAccountTests(),
    });
    expect(problems).toEqual([]);
  });
});
