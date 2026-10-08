// SPIKE-05, T1: the five FR-PLT-005 acceptance criteria, for each queue candidate, on a direct
// connection and through Supavisor in transaction mode. Real Postgres, no mocks.
// Run: pnpm exec vitest run --config tools/spikes/vitest.config.ts
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Candidate, type JobOptions, LOCAL, type QueueClient } from "./contract";
import { pgBossCandidate } from "./pgboss-queue";
import { effectCount, installSteps, runStep, uninstallSteps } from "./steps";
import { tableCandidate } from "./table-queue";

const ADMIN = process.env.SPIKE_ADMIN_URL ?? LOCAL.admin;
const CONNECTIONS: Record<string, string> = {
  direct: process.env.SPIKE_DIRECT_URL ?? LOCAL.direct,
  pooler: process.env.SPIKE_POOLER_URL ?? LOCAL.pooler,
};
const CANDIDATES: Candidate[] = [tableCandidate, pgBossCandidate];

const admin = new pg.Pool({ connectionString: ADMIN, max: 1 });
const timings: string[] = [];

beforeAll(async () => {
  await installSteps(admin);
  for (const candidate of CANDIDATES) await candidate.install(admin);
});

afterAll(async () => {
  for (const candidate of CANDIDATES) await candidate.uninstall(admin);
  await uninstallSteps(admin);
  await admin.end();
  console.log(`\nQueue timings (local):\n${timings.join("\n")}`);
});

const options = (overrides: Partial<JobOptions> = {}): JobOptions => ({
  maxAttempts: 3,
  leaseSeconds: 2,
  retryDelaySeconds: 0,
  ...overrides,
});

const kindName = () => `spike-${randomUUID().slice(0, 8)}`;

async function enqueueOne(
  queue: QueueClient,
  kind: string,
  jobOptions: JobOptions,
): Promise<string> {
  return queue.db
    .transaction()
    .execute((tx) => queue.enqueue(tx, kind, { sessionId: "s1" }, jobOptions));
}

for (const candidate of CANDIDATES) {
  for (const [connection, url] of Object.entries(CONNECTIONS)) {
    describe(`${candidate.name} — ${connection}`, () => {
      let queue: QueueClient;
      let other: QueueClient;

      beforeAll(async () => {
        queue = await candidate.open(url);
        other = await candidate.open(url);
      });

      afterAll(async () => {
        await queue.close();
        await other.close();
      });

      it("a rolled-back transaction leaves no job", async () => {
        const kind = kindName();
        await enqueueOne(queue, kind, options()); // creates the queue for pg-boss
        await queue.claim(kind, 10);
        await expect(
          queue.db.transaction().execute(async (tx) => {
            await queue.enqueue(tx, kind, { sessionId: "s2" }, options());
            throw new Error("roll back");
          }),
        ).rejects.toThrow("roll back");
        expect(await queue.claim(kind, 10)).toEqual([]);
      });

      it("after a crash mid-step, the job runs again and each step's effect exists once", async () => {
        const kind = kindName();
        const id = await enqueueOne(queue, kind, options({ leaseSeconds: 1 }));
        const [first] = await queue.claim(kind, 1);
        expect(first?.id).toBe(id);
        if (!first) return;
        expect(await runStep(queue.db, id, "transcribe")).toBe("ran");
        // The runner dies here: no second step, no completion.

        await sleep(2_200);
        await queue.sweep(kind);
        const [second] = await queue.claim(kind, 1);
        expect(second?.id).toBe(id);
        expect(second?.attempt).toBe(2);
        if (!second) return;
        expect(await runStep(queue.db, id, "transcribe")).toBe("skipped");
        expect(await runStep(queue.db, id, "notes")).toBe("ran");
        expect(await queue.complete(first)).toBe(false); // the dead runner's claim is void
        expect(await queue.complete(second)).toBe(true);
        expect(await queue.state(kind, id)).toBe("succeeded");
        expect(await effectCount(queue.db, id, "transcribe")).toBe(1);
        expect(await effectCount(queue.db, id, "notes")).toBe(1);
      });

      it("two runners claiming at once: only one gets the job", async () => {
        const kind = kindName();
        await enqueueOne(queue, kind, options());
        const [a, b] = await Promise.all([queue.claim(kind, 1), other.claim(kind, 1)]);
        expect((a?.length ?? 0) + (b?.length ?? 0)).toBe(1);
      });

      it("a job that always fails stops at the attempt limit, with its reason", async () => {
        const kind = kindName();
        const id = await enqueueOne(queue, kind, options({ maxAttempts: 2 }));
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const [job] = await queue.claim(kind, 1);
          expect(job?.attempt).toBe(attempt);
          if (job) await queue.fail(job, "provider_unavailable");
        }
        expect(await queue.state(kind, id)).toBe("failed");
        expect(await queue.claim(kind, 1)).toEqual([]);
      });

      it("a cancelled job is never run", async () => {
        const kind = kindName();
        const id = await enqueueOne(queue, kind, options());
        await queue.cancel(kind, id);
        expect(await queue.claim(kind, 1)).toEqual([]);
        expect(await queue.state(kind, id)).toBe("cancelled");
      });

      it("records timings", async () => {
        const kind = kindName();
        const rounds = 20;
        const started = performance.now();
        for (let i = 0; i < rounds; i += 1) await enqueueOne(queue, kind, options());
        const enqueued = performance.now();
        for (let i = 0; i < rounds; i += 1) {
          const [job] = await queue.claim(kind, 1);
          if (job) await queue.complete(job);
        }
        const done = performance.now();
        timings.push(
          `${candidate.name} — ${connection}: enqueue ${((enqueued - started) / rounds).toFixed(1)} ms, ` +
            `claim+complete ${((done - enqueued) / rounds).toFixed(1)} ms`,
        );
      });
    });
  }
}
