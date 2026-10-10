import { readFileSync, statSync } from "node:fs";
import { usesLocalTestOverrides } from "../../../packages/core/test/local-db";
import { e2ePort, parseDevServerLock, reusedServerProblem } from "./web-server";

/**
 * Runs once Playwright has started this checkout's server or attached to one already on the
 * port, before any test: the tests write fixtures, so they stop unless the server is this
 * checkout's own `next dev`.
 */
export default function globalSetup(): void {
  // CI never reuses a server; Playwright itself started this checkout's build there.
  if (process.env.CI) return;
  const lock = parseDevServerLock(readText(new URL("../.next/dev/lock", import.meta.url)));
  const problem = reusedServerProblem({
    port: e2ePort(process.env),
    devServer: lock !== undefined && running(lock.pid) ? lock : undefined,
    // The web server is set up in this process, so a server it started is younger than it.
    runStartedAt: performance.timeOrigin,
    isolated: usesLocalTestOverrides(process.env),
    envChangedAt: modifiedAt(new URL("../.env.local", import.meta.url)),
  });
  if (problem !== undefined) throw new Error(problem);
}

function readText(file: URL): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function modifiedAt(file: URL): number | undefined {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
