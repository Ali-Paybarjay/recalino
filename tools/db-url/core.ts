// Loads the app's own database code, so the tools connect exactly as the app does (T10).
// Node runs the tools without a bundler, but packages/core imports its files without an extension
// (as Next.js and Vitest expect). This hook adds ".ts" to those imports, and only to those.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromCore = context.parentURL?.includes("/packages/core/src/") ?? false;
    if (fromCore && specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

// Through the public entries only (packages/core/package.json "exports": ./config and ./db).
export const { readDatabaseEnv } = await import("../../packages/core/src/config/env.ts");
export const { databaseTls, probeDatabase } = await import("../../packages/core/src/db/index.ts");
