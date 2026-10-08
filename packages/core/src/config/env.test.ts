import { describe, expect, it } from "vitest";
import { readDatabaseEnv } from "./env";

describe("FR-PLT-009 readDatabaseEnv", () => {
  it("accepts a postgres connection string", () => {
    const env = { DATABASE_URL: "postgresql://app:secret@127.0.0.1:54322/postgres" };
    expect(readDatabaseEnv(env).DATABASE_URL).toBe(env.DATABASE_URL);
  });

  it("names a missing variable, with an error name request logs keep", () => {
    expect(() => readDatabaseEnv({})).toThrow("DATABASE_URL");
    expect(() => readDatabaseEnv({})).toThrow(
      expect.objectContaining({ name: "ConfigurationError" }),
    );
  });

  it("rejects a non-postgres URL without echoing its value", () => {
    const leaked = "https://user:do-not-log-me@example.com";
    expect(() => readDatabaseEnv({ DATABASE_URL: leaked })).toThrow(
      /^Invalid database configuration: DATABASE_URL$/,
    );
  });

  // M4-A1: a space after the scheme made the pooler look up the user " recalino_app".
  const valid =
    "postgresql://recalino_app.ref:do-not-log-me@aws-0-eu-west-2.pooler.supabase.com:6543/postgres";
  it.each([
    ["a space after the scheme", valid.replace("//", "// ")],
    ["a leading space", ` ${valid}`],
    ["a trailing space", `${valid} `],
    ["a space in the password", valid.replace("do-not", "do not")],
    ["a trailing line break", `${valid}\n`],
    ["a Windows line break", `${valid}\r\n`],
    ["a line break inside", valid.replace("@", "@\n")],
    ["a tab", valid.replace(":6543", "\t:6543")],
    ["a NUL character", valid.replace("postgres", "postgres\u0000")],
    ["a DEL character", `${valid}\u007f`],
    ["a no-break space", valid.replace("@", " @")],
    ["a zero-width space", valid.replace("recalino", "reca​lino")],
    ["a right-to-left mark", `‏${valid}`],
    ["a byte order mark", `﻿${valid}`],
    ["curly quotes", `“${valid}”`],
  ])("rejects %s anywhere in the value, without echoing it", (_, value) => {
    let message = "";
    try {
      readDatabaseEnv({ DATABASE_URL: value });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      "Invalid database configuration: DATABASE_URL (only visible ASCII characters: no spaces, line breaks or control characters)",
    );
    for (const part of ["do-not-log-me", "recalino_app", "pooler", "6543"]) {
      expect(message).not.toContain(part);
    }
  });
});
