import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;

const portSchema = z
  .string()
  .regex(/^\d{1,5}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535));

/**
 * The port of the app under browser test. Port 3000 is shared by every checkout's `pnpm dev`
 * (docs/runbooks/PARALLEL_SESSIONS.md); RECALINO_E2E_PORT gives a run a port of its own.
 */
export function e2ePort(env: Env): number {
  const value = env.RECALINO_E2E_PORT;
  if (value === undefined) return 3000;
  const port = portSchema.safeParse(value);
  if (!port.success)
    throw new Error(`RECALINO_E2E_PORT must be a TCP port from 1 to 65535, not "${value}"`);
  return port.data;
}

/** What `next dev` records in apps/web/.next/dev/lock while it runs (Next.js 16.3). */
const devServerLockSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  startedAt: z.number(),
});

export type DevServerLock = z.infer<typeof devServerLockSchema>;

export function parseDevServerLock(content: string | undefined): DevServerLock | undefined {
  if (content === undefined) return undefined;
  try {
    const lock = devServerLockSchema.safeParse(JSON.parse(content));
    return lock.success ? lock.data : undefined;
  } catch {
    return undefined;
  }
}

export type ServerFacts = {
  /** The port of the browser tests; a server answers on it once Playwright's setup is done. */
  port: number;
  /** This checkout's `next dev` from its lock file, when the process it names still runs. */
  devServer: DevServerLock | undefined;
  /** When this test run began, in milliseconds since the epoch. */
  runStartedAt: number;
  /** Whether LOCAL_TEST_* overrides point the run at a stack of its own. */
  isolated: boolean;
  /** When apps/web/.env.local last changed, if it exists. */
  envChangedAt: number | undefined;
};

/**
 * Why browser tests must not use the server on their port, or undefined when they may.
 * Playwright attaches to whatever already answers there, such as another worktree's or an
 * orphaned `pnpm dev`. Only this checkout's own `next dev` runs this checkout's code with the
 * DATABASE_URL that assertFixturesUseAppDatabase checked; Next.js runs one per checkout.
 */
export function reusedServerProblem(facts: ServerFacts): string | undefined {
  const { port, devServer } = facts;
  const stopped = "Browser tests stopped:";
  if (devServer === undefined)
    return (
      `${stopped} a server already answers on port ${port}, and it is not this checkout's ` +
      "`next dev` (apps/web/.next/dev/lock names no running server). It may be another " +
      "worktree's or an orphaned server, with other code and another DATABASE_URL. Do not stop " +
      "it unless it is yours; set RECALINO_E2E_PORT to a free port to test this checkout."
    );
  const server = `this checkout's \`next dev\` (pid ${devServer.pid})`;
  if (devServer.port !== port)
    return (
      `${stopped} a server already answers on port ${port}, but ${server} runs on port ` +
      `${devServer.port}, so the one on port ${port} belongs to another worktree or process. ` +
      (facts.isolated
        ? `Stop pid ${devServer.pid} and set RECALINO_E2E_PORT to a free port.`
        : `Set RECALINO_E2E_PORT=${devServer.port} to test this checkout's server.`)
    );
  if (facts.isolated && devServer.startedAt < facts.runStartedAt)
    return (
      `${stopped} LOCAL_TEST_* overrides are set, so the tests start their own server for the ` +
      `stack they name, but ${server} was already running on port ${port}. Stop it and run again.`
    );
  if (facts.envChangedAt !== undefined && facts.envChangedAt > devServer.startedAt)
    return (
      `${stopped} apps/web/.env.local changed after ${server} started on port ${port}, so it ` +
      "may still use the previous DATABASE_URL. Restart it, or stop it so the tests start their own."
    );
  return undefined;
}
