import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts", "tools/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["packages/*/src/**/*.int.test.ts"],
          // Integration tests share one local database; run files one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
