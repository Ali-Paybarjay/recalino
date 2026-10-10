import { expect, it } from "vitest";
import {
  type DevServerLock,
  e2ePort,
  parseDevServerLock,
  reusedServerProblem,
  type ServerFacts,
} from "../../apps/web/e2e/web-server";

it("tests on the shared port 3000 unless RECALINO_E2E_PORT gives the run its own", () => {
  expect(e2ePort({})).toBe(3000);
  expect(e2ePort({ RECALINO_E2E_PORT: "58300" })).toBe(58300);
  expect(e2ePort({ RECALINO_E2E_PORT: "1" })).toBe(1);
  expect(e2ePort({ RECALINO_E2E_PORT: "65535" })).toBe(65535);
  for (const value of ["", "0", "65536", "123456", "-1", " 3000", "3000 ", "3e3", "0x10", "3000a"])
    expect(() => e2ePort({ RECALINO_E2E_PORT: value })).toThrow(
      `RECALINO_E2E_PORT must be a TCP port from 1 to 65535, not "${value}"`,
    );
});

it("reads the server that this checkout's `next dev` records in its lock file", () => {
  // As Next.js 16.3.8 writes it while the server runs.
  expect(
    parseDevServerLock(
      '{"pid":41076,"port":58301,"hostname":"localhost","appUrl":"http://localhost:58301",' +
        '"startedAt":1791630890154}',
    ),
  ).toEqual({ pid: 41076, port: 58301, startedAt: 1791630890154 });
  for (const content of [
    undefined,
    "",
    "not json",
    "null",
    '{"pid":41076,"port":58301}',
    '{"pid":"41076","port":58301,"startedAt":1}',
    '{"pid":0,"port":58301,"startedAt":1}',
    '{"pid":41076,"port":0,"startedAt":1}',
  ])
    expect(parseDevServerLock(content)).toBeUndefined();
});

const startedAt = Date.parse("2026-10-10T09:00:00Z");
const ownServer: DevServerLock = { pid: 4242, port: 3000, startedAt };

/** This checkout's `next dev` has served port 3000 since before the run; .env.local is older. */
function facts(changes: Partial<ServerFacts> = {}): ServerFacts {
  return {
    port: 3000,
    devServer: ownServer,
    runStartedAt: startedAt + 60_000,
    isolated: false,
    envChangedAt: startedAt - 60_000,
    ...changes,
  };
}

it("lets browser tests use this checkout's own `next dev`", () => {
  // `pnpm dev` already runs in this checkout, so the run reuses it as before.
  expect(reusedServerProblem(facts())).toBeUndefined();
  // No .env.local: the app's settings come from the environment.
  expect(reusedServerProblem(facts({ envChangedAt: undefined }))).toBeUndefined();
  // Playwright started the server for this run, on a port of its own for an isolated stack.
  const started = { pid: 5151, port: 58300, startedAt: startedAt + 61_000 };
  expect(
    reusedServerProblem(facts({ port: 58300, devServer: started, isolated: true })),
  ).toBeUndefined();
});

it("stops browser tests on a server that is not this checkout's `next dev`", () => {
  // Another worktree's or an orphaned server; this checkout runs none, or its lock is stale.
  expect(reusedServerProblem(facts({ devServer: undefined }))).toBe(
    "Browser tests stopped: a server already answers on port 3000, and it is not this " +
      "checkout's `next dev` (apps/web/.next/dev/lock names no running server). It may be " +
      "another worktree's or an orphaned server, with other code and another DATABASE_URL. Do " +
      "not stop it unless it is yours; set RECALINO_E2E_PORT to a free port to test this checkout.",
  );
  // This checkout's `pnpm dev` moved to port 3001 because another server held 3000.
  const moved = { ...ownServer, port: 3001 };
  expect(reusedServerProblem(facts({ devServer: moved }))).toBe(
    "Browser tests stopped: a server already answers on port 3000, but this checkout's " +
      "`next dev` (pid 4242) runs on port 3001, so the one on port 3000 belongs to another " +
      "worktree or process. Set RECALINO_E2E_PORT=3001 to test this checkout's server.",
  );
  // An isolated run needs a server of its own, and Next.js runs one per checkout.
  expect(reusedServerProblem(facts({ devServer: moved, isolated: true }))).toMatch(
    /belongs to another worktree or process\. Stop pid 4242 and set RECALINO_E2E_PORT to a free port\.$/,
  );
});

it("stops an isolated run on this checkout's `next dev` that was running before it", () => {
  expect(reusedServerProblem(facts({ isolated: true }))).toBe(
    "Browser tests stopped: LOCAL_TEST_* overrides are set, so the tests start their own server " +
      "for the stack they name, but this checkout's `next dev` (pid 4242) was already running on " +
      "port 3000. Stop it and run again.",
  );
});

it("stops browser tests on a `next dev` that started before .env.local last changed", () => {
  expect(reusedServerProblem(facts({ envChangedAt: startedAt + 1 }))).toBe(
    "Browser tests stopped: apps/web/.env.local changed after this checkout's `next dev` " +
      "(pid 4242) started on port 3000, so it may still use the previous DATABASE_URL. Restart " +
      "it, or stop it so the tests start their own.",
  );
});
