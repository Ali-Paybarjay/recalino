import { describe, expect, it } from "vitest";
import { readDatabaseEnv } from "./env";

describe("readDatabaseEnv", () => {
  it("accepts a postgres connection string", () => {
    const env = { DATABASE_URL: "postgresql://app:secret@127.0.0.1:54322/postgres" };
    expect(readDatabaseEnv(env).DATABASE_URL).toBe(env.DATABASE_URL);
  });

  it("names a missing variable", () => {
    expect(() => readDatabaseEnv({})).toThrow("DATABASE_URL");
  });

  it("rejects a non-postgres URL without echoing its value", () => {
    const leaked = "https://user:do-not-log-me@example.com";
    expect(() => readDatabaseEnv({ DATABASE_URL: leaked })).toThrow(
      /^Invalid database configuration: DATABASE_URL$/,
    );
  });
});
