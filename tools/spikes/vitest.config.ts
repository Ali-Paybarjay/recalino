// Spike tests run on their own, outside `pnpm verify` (M4, T1). Removed with the spike code (T6).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/spikes/**/*.int.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
