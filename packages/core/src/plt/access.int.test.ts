import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { LOCAL_ADMIN_DATABASE_URL } from "../../test/local-db";
import { createDatabase, withTransaction } from "../db";

const admin = createDatabase(LOCAL_ADMIN_DATABASE_URL, { maxConnections: 1 });

afterAll(async () => {
  await admin.destroy();
});

describe("plt schema is closed to browser roles (FR-PLT-002, ADR-0002)", () => {
  for (const role of ["anon", "authenticated"]) {
    it(`denies ${role} direct table access`, async () => {
      await expect(
        withTransaction(admin, async (tx) => {
          await sql.raw(`set local role ${role}`).execute(tx);
          await sql`select count(*) from plt.idempotency_key`.execute(tx);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  }
});
