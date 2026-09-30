import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase, withTransaction } from "./index";

// One connection, so the temporary table below is visible to every statement in this file.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });

afterAll(async () => {
  await db.destroy();
});

describe("database baseline (ADR-0002)", () => {
  it("connects as the least-privilege application role", async () => {
    const { rows } = await sql<{ role: string }>`select current_user as role`.execute(db);
    expect(rows[0]?.role).toBe("recalino_app");
  });

  it("commits when the callback succeeds and rolls back when it throws", async () => {
    await sql`create temporary table m0_probe (id int)`.execute(db);

    await withTransaction(db, async (tx) => {
      await sql`insert into m0_probe values (1)`.execute(tx);
    });
    await expect(
      withTransaction(db, async (tx) => {
        await sql`insert into m0_probe values (2)`.execute(tx);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const { rows } = await sql<{ id: number }>`select id from m0_probe order by id`.execute(db);
    expect(rows.map((row) => row.id)).toEqual([1]);
  });

  it("cannot read Supabase auth tables", async () => {
    await expect(sql`select count(*) from auth.users`.execute(db)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("cannot create objects in the public schema", async () => {
    await expect(sql`create table public.m0_forbidden (id int)`.execute(db)).rejects.toThrow(
      /permission denied/,
    );
  });
});
