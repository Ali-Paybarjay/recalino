import { expect, it } from "vitest";
import { assertLocalRestoreTarget } from "./backup-native";

it("allows only exact loopback admin targets for an isolated restore", () => {
  expect(
    assertLocalRestoreTarget("postgresql://postgres:synthetic@127.0.0.1:54322/postgres").hostname,
  ).toBe("127.0.0.1");
  for (const value of [
    "postgresql://postgres:synthetic@db.example.org/postgres",
    "postgresql://postgres:synthetic@127.0.0.1/postgres?host=remote.example.org",
    "postgresql://postgres:synthetic@127.0.0.1/current_user_database",
    "file:///tmp/postgres",
  ]) {
    expect(() => assertLocalRestoreTarget(value)).toThrow();
  }
});
