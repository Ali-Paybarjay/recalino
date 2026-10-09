import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const roundLockName = ".round.lock";
export const roundLockPath = (directory: string) => resolve(directory, roundLockName);

/** A dry run only writes the plan; it may not do so beside a round process or a stale lock. */
export function assertRoundUnlocked(directory: string) {
  if (existsSync(roundLockPath(directory)))
    throw new Error(
      `round_directory_locked: ${roundLockPath(directory)} exists; a round process holds this directory, or one was killed and needs offline recovery`,
    );
}

/**
 * One process per round directory. Two processes on one freeze share its ledger entry and each
 * would replace the other's spend with its own, so the second is refused before it reads
 * state.json. The lock is an exclusive directory: a process that exits releases it, and one that
 * was killed leaves it for the operator, who confirms no round process is running and inspects
 * state.json for an unresolved dispatch before removing it.
 */
export async function acquireRoundLock(directory: string, owner: Record<string, unknown>) {
  const path = roundLockPath(directory);
  const token = randomUUID();
  await mkdir(directory, { recursive: true });
  try {
    await mkdir(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
      throw new Error(
        `round_directory_locked: ${path} exists; another process runs this round, or one was killed and needs offline recovery`,
      );
    throw error;
  }
  try {
    await writeFile(resolve(path, "owner.json"), JSON.stringify({ token, ...owner }, null, 2));
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
  return {
    path,
    /** Synchronous so an exit handler can run it; removes only the lock this call created. */
    release() {
      try {
        if (JSON.parse(readFileSync(resolve(path, "owner.json"), "utf8"))?.token !== token) return;
      } catch {
        return;
      }
      rmSync(path, { recursive: true, force: true });
    },
  };
}
