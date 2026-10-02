import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { LOCAL_ADMIN_DATABASE_URL } from "../../packages/core/test/local-db";
import { alterRoleStatement, connectionString, generatePassword, scramVerifier } from "./scram";

// A throwaway role on the local database only; the cloud password is never changed by tests.
const role = `scram_check_${randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: LOCAL_ADMIN_DATABASE_URL });

afterAll(async () => {
  await admin.query(`drop role if exists ${role}`);
  await admin.end();
});

describe("FR-PLT-009 password rotation with a SCRAM-SHA-256 verifier, on local Postgres", () => {
  it("Postgres stores the verifier as it is, and the password then signs in", async () => {
    await admin.connect();
    const password = generatePassword();
    const verifier = scramVerifier(password);
    await admin.query(`create role ${role} login`);
    await admin.query(alterRoleStatement(role, verifier));

    const local = { user: role, host: "127.0.0.1", port: 54322, database: "postgres" };
    const client = new pg.Client({ connectionString: connectionString(password, local) });
    await client.connect();
    try {
      const result = await client.query<{ current_user: string }>("select current_user");
      expect(result.rows[0]?.current_user).toBe(role);
    } finally {
      await client.end();
    }

    const wrong = new pg.Client({
      connectionString: connectionString(generatePassword(), local),
    });
    await expect(wrong.connect()).rejects.toMatchObject({ code: "28P01" });
    await wrong.end().catch(() => {});
  });
});
