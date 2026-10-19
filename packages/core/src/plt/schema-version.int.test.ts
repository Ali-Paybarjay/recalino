import { sql } from "kysely";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { readAppliedSchemaVersion } from "./schema-version";

// OPS-05 (audit 2026-10-18): migration 20261019120100 lets the application role read the applied
// migration version, so the runner's schema guard works instead of failing open.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => db.destroy());

it("lets the application role read the newest applied migration version", async () => {
  const version = await readAppliedSchemaVersion(db);
  expect(version).toMatch(/^\d{14}$/);
  expect((version ?? "") >= "20261019120100").toBe(true);
});

it("grants the version column only, not the recorded statements", async () => {
  const { rows } = await sql<{ column_read: boolean; table_read: boolean }>`select
      has_column_privilege('supabase_migrations.schema_migrations', 'version', 'SELECT')
        as column_read,
      has_table_privilege('supabase_migrations.schema_migrations', 'SELECT') as table_read`.execute(
    db,
  );
  expect(rows).toEqual([{ column_read: true, table_read: false }]);
});
