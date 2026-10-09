import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireRoundLock, assertRoundUnlocked, roundLockPath } from "./round-lock";

describe("round directory lock", () => {
  const directories: string[] = [];
  const directory = async () => {
    const created = await mkdtemp(join(tmpdir(), "baseline-round-lock-"));
    directories.push(created);
    return join(created, "round");
  };
  afterEach(async () => {
    for (const created of directories.splice(0))
      await rm(created, { recursive: true, force: true });
  });

  it("admits one process per round directory until it releases", async () => {
    const round = await directory();
    const first = await acquireRoundLock(round, { pid: 1 });
    await expect(acquireRoundLock(round, { pid: 2 })).rejects.toThrow("round_directory_locked");
    expect(() => assertRoundUnlocked(round)).toThrow("round_directory_locked");
    first.release();
    expect(existsSync(roundLockPath(round))).toBe(false);
    expect(() => assertRoundUnlocked(round)).not.toThrow();
    const second = await acquireRoundLock(round, { pid: 3 });
    second.release();
  });

  it("releases only the lock it created", async () => {
    const round = await directory();
    const first = await acquireRoundLock(round, { pid: 1 });
    first.release();
    const second = await acquireRoundLock(round, { pid: 2 });
    // A late release by the earlier holder never frees the current holder's lock.
    first.release();
    expect(existsSync(roundLockPath(round))).toBe(true);
    await expect(acquireRoundLock(round, { pid: 3 })).rejects.toThrow("round_directory_locked");
    second.release();
    expect(existsSync(roundLockPath(round))).toBe(false);
  });
});
