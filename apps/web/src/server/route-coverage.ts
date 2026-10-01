import type { RouteMeta } from "./routes";

export interface CoverageInput {
  /** Route files relative to the app's src/app folder, e.g. "api/health/route.ts". */
  routeFiles: string[];
  registry: RouteMeta[];
  /** Ids of routes that have a cross-account test file. */
  crossAccountTests: string[];
}

/** "api/(group)/classes/[id]/route.ts" → "/api/classes/[id]" (route groups are not in the URL). */
export function routePathFromFile(file: string): string {
  const segments = file
    .split("/")
    .slice(0, -1)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}`;
}

/**
 * FR-PLT-002 / NFR-01: every route file is registered, every registered route has a file, and
 * every learner route has a cross-account test. Returns the problems found.
 */
export function checkRouteCoverage(input: CoverageInput): string[] {
  const problems: string[] = [];
  const filePaths = new Set(input.routeFiles.map(routePathFromFile));
  const registered = new Map(input.registry.map((route) => [route.path, route]));
  const tested = new Set(input.crossAccountTests);

  for (const path of filePaths) {
    if (!registered.has(path)) problems.push(`unregistered route: ${path}`);
  }
  for (const route of input.registry) {
    if (!filePaths.has(route.path)) problems.push(`registered route without a file: ${route.path}`);
    if (route.access === "learner" && !tested.has(route.id)) {
      problems.push(`learner route without a cross-account test: ${route.id}`);
    }
  }
  return problems;
}
