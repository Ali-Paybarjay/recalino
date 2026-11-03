import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyntheticAuthUser } from "./synthetic-auth-user";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("synthetic evaluation auth user", () => {
  it.each([
    "postgresql://example:example@db.example.com:54322/postgres",
    "postgresql://example:example@127.0.0.1:5432/postgres",
    "postgresql://example:example@127.0.0.1:54322/production",
    "https://127.0.0.1:54322/postgres",
    "not a url",
  ])("rejects a non-local database before opening any connection: %s", async (target) => {
    const open = vi.fn(() => {
      throw new Error("connection_opened");
    });
    await expect(createSyntheticAuthUser({ connectionString: target, open })).rejects.toThrow(
      "local_supabase_database_required",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("checks the admin override from the environment before opening any connection", async () => {
    vi.stubEnv(
      "LOCAL_TEST_ADMIN_DATABASE_URL",
      "postgresql://example:example@db.example.com:5432/postgres",
    );
    const open = vi.fn(() => {
      throw new Error("connection_opened");
    });
    await expect(createSyntheticAuthUser({ open })).rejects.toThrow(
      "local_supabase_database_required",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps evaluate.ts free of core test-helper imports", async () => {
    const source = await readFile(new URL("./evaluate.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/["'`][^"'`\n]*core\/test\//);
    expect(source).toMatch(/from\s+["']\.\/synthetic-auth-user["']/);
  });
});
