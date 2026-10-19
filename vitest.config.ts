import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws outside a React Server Components build; tests run on the server.
      "server-only": fileURLToPath(new URL("./tools/test/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tools/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: [
            "packages/*/src/**/*.int.test.ts",
            "apps/*/src/**/*.int.test.ts",
            "tools/db-url/**/*.int.test.ts",
          ],
          // Integration tests share one local database; run files one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
