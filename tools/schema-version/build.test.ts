import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSchemaVersionModule, newestMigrationVersion, OUTPUT, ROOT } from "./build.ts";

// OPS-05 (audit 2026-10-18): the code knows which migration it was built against, so the job
// runner can refuse to work on a database that is behind it.
describe("expected schema version (OPS-05)", () => {
  it("is up to date with supabase/migrations (run `pnpm schema:version`)", () => {
    expect(readFileSync(join(ROOT, OUTPUT), "utf8")).toBe(buildSchemaVersionModule());
  });

  it("takes the newest migration file name", () => {
    expect(
      newestMigrationVersion([
        "20261001100505_plt_core.sql",
        "20261015120000_srs_daily_new_limit_default.sql",
        "20260930175238_baseline.sql",
        "README.md",
        "20261099_short_name.sql",
      ]),
    ).toBe("20261015120000");
    expect(() => newestMigrationVersion(["README.md"])).toThrow("no migration");
  });
});
