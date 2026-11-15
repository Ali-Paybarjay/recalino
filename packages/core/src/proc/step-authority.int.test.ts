// P11-02 AC-22 (with AC-10, AC-13 and AC-16; ADR-0004 rule 4, C11-12): failRun, storeExtraction
// and checkpointAndContinue, run on a job's behalf, write only with that job's authority. A really
// claimed job and a real lease are used, and no test-only mark: a JobContext without a lease is
// refused (fail-closed), and so is a worker whose claim was taken by a reclaim. Nothing is written.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import type { AiProvider, ProviderSettings } from "../aip";
import { createDatabase } from "../db";
import {
  cancelJob,
  claimJobs,
  DEFAULT_PLT_SETTINGS,
  enqueueJob,
  type JobContext,
  MemoryObjectStore,
  sweepJobs,
} from "../plt";
import { amounts, grantEntitlement } from "../quota";
import { appendContentVersion, selectSourceSnapshot } from "../src";
import { cancelRun, createProcessingRun, processingJob, sourceSnapshotSchema } from "./index";
import { failRun } from "./steps/fail-run";
import { checkpointAndContinue, storeExtraction } from "./steps/runtime";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());

const leaseLost = { name: "JobLeaseLost" };
type JobLease = NonNullable<JobContext["lease"]>;

const settings: ProviderSettings = {
  version: "synthetic-authority",
  llmModel: "synthetic",
  visionModel: "synthetic",
  sttModel: "synthetic",
  ttsModel: "synthetic",
  voice: "synthetic",
  promptVersion: "1",
  maxInputCharacters: 10000,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maximumMicros: 10,
  currency: "USD",
  priceVersion: "synthetic",
  charactersPerPage: 1000,
  audioUrlSupported: false,
  sttProviderOptions: {},
  dataContractApproved: true,
};
const provider: AiProvider = {
  name: "synthetic-authority",
  mode: "mock",
  settings,
  async structured() {
    throw new Error("No live provider used");
  },
  async transcribe() {
    throw new Error("No live provider used");
  },
  async speech() {
    throw new Error("No live provider used");
  },
};

/**
 * A job of its own queue kind, claimed by worker A, and `reclaim`: A's lease ends on the database
 * clock, the sweep returns the job and worker B claims it, so A's claim is void (ADR-0004 rule 2).
 */
async function claimedJob() {
  const kind = `plt.synthetic_${randomUUID().replaceAll("-", "")}`;
  await db
    .transaction()
    .execute((tx) =>
      enqueueJob(
        tx,
        { kind, version: 1, payload: z.strictObject({}) },
        { payload: {}, now: new Date(), defaults: DEFAULT_PLT_SETTINGS.jobs },
      ),
    );
  const leaseOf = async (): Promise<JobLease> => {
    const [claim] = await claimJobs(db, [kind], 1, new Date());
    if (!claim || claim.generation === undefined) throw new Error("Expected a claim");
    return { id: claim.id, token: claim.token, generation: claim.generation };
  };
  const a = await leaseOf();
  return {
    a,
    async reclaim(): Promise<JobLease> {
      await db
        .updateTable("plt.job")
        .set({ lease_until: sql<Date>`now() - interval '1 minute'` })
        .where("id", "=", a.id)
        .execute();
      await sweepJobs(db, new Date());
      const b = await leaseOf();
      expect(b.id).toBe(a.id);
      expect(b.token).not.toBe(a.token);
      return b;
    },
    done: () => cancelJob(db, a.id, new Date()),
  };
}

/** The JobContext a runner hands a step; `lease` is absent only where a test says so. */
function jobContext(id: string, lease: JobLease | undefined): JobContext {
  return {
    db,
    now: () => new Date(),
    job: { id, attempt: 1 },
    ...(lease === undefined ? {} : { lease }),
    async step() {
      throw new Error("No job step used");
    },
  };
}

/** A learner's queued processing run over one selected text source with its content. */
async function queuedRun() {
  const f = await studyFixture(db);
  const now = new Date();
  const asset = await db
    .insertInto("src.asset")
    .values({
      user_id: f.ctx.userId,
      kind: "text",
      declared_mime: "text/plain",
      verified_mime: "text/plain",
      size_bytes: 14,
      sha256: "a".repeat(64),
      display_name: "Synthetic.txt",
      contract_version: "1",
      retention: "persistent",
      operation_key: randomUUID(),
      request_hash: randomUUID(),
      verified_at: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: f.ctx.userId,
      session_id: f.session.id,
      asset_id: asset.id,
      role: "class_material",
      selected: true,
    })
    .execute();
  await db.transaction().execute((tx) =>
    appendContentVersion(tx, f.ctx, asset.id, {
      originKey: "fixture",
      schemaVersion: "1",
      provenance: "machine_extraction",
      settings: {},
      units: [{ id: "doc", kind: "document", start: 1 }],
      blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: "Present perfect" }],
    }),
  );
  await grantEntitlement(db, {
    userId: f.ctx.userId,
    startsAt: new Date(now.getTime() - 1000),
    endsAt: new Date(now.getTime() + 3600000),
    amounts: amounts({ document: 10, regeneration: 10 }),
    operationKey: randomUUID(),
    actorId: "synthetic-authority-test",
    reason: "Synthetic step authority",
  });
  const definition = processingJob({ provider, store: new MemoryObjectStore() });
  const run = await createProcessingRun(
    db,
    f.ctx,
    { sessionId: f.session.id, operationKey: randomUUID() },
    { provider, job: definition },
  );
  const snapshot = sourceSnapshotSchema.parse(await selectSourceSnapshot(db, f.ctx, f.session.id));
  const source = snapshot.sources[0];
  if (!source) throw new Error("Expected selected source");
  /** What the guarded writes would change: run state, checkpoints, content versions, next jobs. */
  const written = async () => ({
    state: (
      await db
        .selectFrom("proc.processing_run")
        .select("state")
        .where("id", "=", run.id)
        .executeTakeFirstOrThrow()
    ).state,
    steps: (
      await db.selectFrom("proc.run_step").select("step").where("run_id", "=", run.id).execute()
    ).length,
    versions: (
      await db
        .selectFrom("src.content_version")
        .select("id")
        .where("asset_id", "=", asset.id)
        .execute()
    ).length,
    jobs: (
      await db
        .selectFrom("plt.job")
        .select("id")
        .where("kind", "=", definition.kind)
        .where("singleton_key", "like", `${run.id}:%`)
        .execute()
    ).length,
  });
  return { f, run, source, definition, written };
}

type Guarded = (job: JobContext, x: Awaited<ReturnType<typeof queuedRun>>) => Promise<unknown>;

const guarded: [string, Guarded][] = [
  [
    "failRun",
    (job, x) =>
      failRun(
        { job, ctx: x.f.ctx, payload: { runId: x.run.id, userId: x.f.ctx.userId } },
        new Error("synthetic definite failure"),
      ),
  ],
  [
    "storeExtraction",
    (job, x) =>
      storeExtraction(
        job,
        x.f.ctx,
        x.run.id,
        x.source,
        {
          units: [{ id: "doc", kind: "document", start: 1, status: "extracted" }],
          blocks: [{ id: "text", kind: "paragraph", unitId: "doc", text: "Synthetic extraction" }],
        },
        { synthetic: true },
      ),
  ],
  [
    "checkpointAndContinue",
    (job, x) => checkpointAndContinue(job, x.f.ctx, x.run.id, x.definition),
  ],
];

describe("P11-02 AC-22 guarded run writes need the job's authority", () => {
  for (const [name, write] of guarded) {
    it(`AC-13 ${name} refuses a JobContext without a lease and writes nothing`, async () => {
      const x = await queuedRun();
      const before = await x.written();
      await expect(write(jobContext(randomUUID(), undefined), x)).rejects.toMatchObject(leaseLost);
      expect(await x.written()).toEqual(before);
      await cancelRun(db, x.f.ctx, x.run.id);
    }, 60000);

    it(`AC-10 ${name} from a worker whose job was reclaimed is refused and writes nothing`, async () => {
      const x = await queuedRun();
      const job = await claimedJob();
      const before = await x.written();
      await job.reclaim();
      await expect(write(jobContext(job.a.id, job.a), x)).rejects.toMatchObject(leaseLost);
      expect(await x.written()).toEqual(before);
      expect(before.state).toBe("queued");
      await cancelRun(db, x.f.ctx, x.run.id);
      await job.done();
    }, 60000);
  }
});
