import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase, type Database, type Tx } from "../db";
import {
  type ClaimedJob,
  claimJobs,
  completeJob,
  enqueueJob,
  type JobContext,
  jobState,
  MemoryObjectStore,
  type ObjectStore,
  readPltSettings,
  renewJobLease,
  runJobStep,
  sweepJobs,
} from "../plt";
import {
  appendEncryptedDeletionJournal,
  type DeletionJournal,
  readEncryptedDeletionJournals,
} from "./deletion-journals";

// P12-09 (P12-03 F-1 and F-2): the encrypted deletion journal is written only with the authority
// of the privacy cleanup's job, and no failing writer deletes the verified bytes of a ready
// journal. Every claim, sweep and reclaim below goes through the real PLT job layer; no job state
// or lease is written by hand. The journal itself needs no PRIV row (ops.deletion_journal has no
// foreign key to it), so the entries are synthetic identifiers only.

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());

const encryption = { keyId: "synthetic-journal-authority", key: randomBytes(32) };
const keys = new Map([[encryption.keyId, encryption.key]]);
/** Far from any other test's clock, so a stamp below names the rows of one writer only. */
const FAR_MS = 60 * 365 * 24 * 3600 * 1000;

function journalEntry(): DeletionJournal {
  return {
    requestId: randomUUID(),
    userId: randomUUID(),
    kind: "session",
    subjectId: randomUUID(),
    relatedSessions: [],
    requestedAt: new Date().toISOString(),
  };
}

/** A unique instant: every row written with it as `now` belongs to that one writer. */
function writerStamp(): Date {
  return new Date(Date.now() + FAR_MS + Math.floor(Math.random() * 1_000_000_000));
}

/** A job of its own queue kind, claimed through PLT: a worker's JobContext with a real lease. */
async function claimedSyntheticJob(leaseSeconds: number) {
  const kind = `ops.synthetic_${randomUUID().replaceAll("-", "")}`;
  const jobId = await db.transaction().execute((tx) =>
    enqueueJob(
      tx,
      {
        kind,
        version: 1,
        payload: z.strictObject({ subjectId: z.uuid() }),
        options: { leaseSeconds, maxAttempts: 5 },
      },
      { payload: { subjectId: randomUUID() }, now: new Date(), defaults: readPltSettings().jobs },
    ),
  );
  if (!jobId) throw new Error("Expected a synthetic job");
  return { kind, jobId, claim: await claim(kind, jobId) };
}

async function claim(kind: string, jobId: string): Promise<ClaimedJob> {
  const [claimed] = await claimJobs(db, [kind], 1, new Date());
  if (!claimed || claimed.id !== jobId) throw new Error("Expected the synthetic job's claim");
  return claimed;
}

/** What the runner gives a handler for this claim (runDueJobs builds the same context). */
function contextOf(claimed: ClaimedJob): JobContext {
  if (claimed.generation === undefined) throw new Error("Expected a lease generation");
  return {
    db,
    now: () => new Date(),
    job: { id: claimed.id, attempt: claimed.attempt },
    lease: { id: claimed.id, token: claimed.token, generation: claimed.generation },
    step: (name, effect) => runJobStep(db, claimed, name, effect, new Date()),
  };
}

/** Waits for the lease to end on the database clock, as when a worker stalls, then sweeps. */
async function sweepUntilReturned(jobId: string) {
  for (let tries = 0; tries < 80; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await sweepJobs(db, new Date());
    if ((await jobState(db, jobId)) === "retry_scheduled") return;
  }
  throw new Error("The synthetic lease did not end");
}

/** The same database, whose n-th transaction runs through `around` (a lost connection or answer). */
function aroundTransactions(
  around: (index: number, run: () => Promise<unknown>) => Promise<unknown>,
): Database {
  let count = 0;
  return new Proxy(db, {
    get(target, property) {
      if (property === "transaction")
        return () => {
          const builder = target.transaction();
          const index = ++count;
          return {
            execute: (work: (tx: Tx) => Promise<unknown>) =>
              around(index, () => builder.execute(work)),
          };
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The same store, whose writes fail: a provider outage during the journal upload. */
function failingWrites(store: MemoryObjectStore): ObjectStore {
  return new Proxy(store, {
    get(target, property) {
      if (property === "write")
        return async () => {
          throw new Error("Synthetic store write failure");
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function journalRow(requestId: string) {
  return db
    .selectFrom("ops.deletion_journal")
    .select(["id", "state", "object_id", "encrypted_sha256"])
    .where("request_id", "=", requestId)
    .executeTakeFirst();
}

async function objectState(objectId: string) {
  const row = await db
    .selectFrom("plt.storage_object")
    .select("state")
    .where("id", "=", objectId)
    .executeTakeFirstOrThrow();
  return row.state;
}

/** Rows a writer created with `stamp` as its clock: object records and journal rows. */
async function rowsWrittenAt(stamp: Date) {
  const [objects, journals] = await Promise.all([
    db.selectFrom("plt.storage_object").select("id").where("created_at", "=", stamp).execute(),
    db.selectFrom("ops.deletion_journal").select("id").where("created_at", "=", stamp).execute(),
  ]);
  return objects.length + journals.length;
}

/** A ready journal points at a verified object whose bytes are in the store, with its digest. */
async function expectReadyWithBytes(store: MemoryObjectStore, requestId: string) {
  const row = await journalRow(requestId);
  expect(row?.state).toBe("ready");
  if (!row?.object_id) throw new Error("A ready journal without an object");
  const object = await db
    .selectFrom("plt.storage_object")
    .select(["key", "state"])
    .where("id", "=", row.object_id)
    .executeTakeFirstOrThrow();
  expect(object.state).toBe("verified");
  const bytes = await store.read(object.key);
  if (!bytes) throw new Error("A ready journal without its encrypted bytes");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(row.encrypted_sha256);
  return row.object_id;
}

/** An earlier writer that registered its target and lost its connection before the upload. */
async function interruptedWriter(store: MemoryObjectStore, entry: DeletionJournal) {
  const lostConnection = aroundTransactions(async (index, run) => {
    if (index === 2) throw new Error("Synthetic lost connection");
    return run();
  });
  await expect(
    appendEncryptedDeletionJournal(lostConnection, store, encryption, entry),
  ).rejects.toThrow("Synthetic lost connection");
  const row = await journalRow(entry.requestId);
  if (row?.state !== "pending" || !row.object_id) throw new Error("Expected a pending pointer");
  expect(await objectState(row.object_id)).toBe("pending");
  return row.object_id;
}

describe("encrypted deletion journal under the job's authority (P12-09)", () => {
  it("privacy journal: a stale worker after reclaim writes no journal object and moves no pointer", async () => {
    const store = new MemoryObjectStore();
    const entry = journalEntry();
    const earlierTarget = await interruptedWriter(store, entry);
    const { kind, jobId, claim: claimA } = await claimedSyntheticJob(3);
    const workerA = contextOf(claimA);
    // A stalls until its lease ends; the sweep returns the job and worker B claims it.
    await sweepUntilReturned(jobId);
    const claimB = await claim(kind, jobId);
    expect(claimB.attempt).toBe(2);
    const workerB = contextOf(claimB);

    const stampA = writerStamp();
    await expect(
      appendEncryptedDeletionJournal(db, store, encryption, entry, stampA, { job: workerA }),
    ).rejects.toMatchObject({ name: "JobLeaseLost" });
    // A created, verified and deleted nothing, and the pointer did not move.
    expect(await rowsWrittenAt(stampA)).toBe(0);
    expect(await journalRow(entry.requestId)).toMatchObject({
      state: "pending",
      object_id: earlierTarget,
    });
    expect(await objectState(earlierTarget)).toBe("pending");
    expect((await store.list("priv/system/")).objects).toEqual([]);

    // B, the current claim, renews its lease as a live runner does and makes the journal ready;
    // the earlier pending target goes.
    expect(await renewJobLease(db, claimB, new Date())).toBe(true);
    await appendEncryptedDeletionJournal(db, store, encryption, entry, undefined, { job: workerB });
    const readyObject = await expectReadyWithBytes(store, entry.requestId);
    expect(readyObject).not.toBe(earlierTarget);
    expect(await objectState(earlierTarget)).toBe("deleted");
    expect(await readEncryptedDeletionJournals(store, keys)).toEqual([entry]);

    // Once the journal is ready, A still cannot touch it.
    const lateStamp = writerStamp();
    await expect(
      appendEncryptedDeletionJournal(db, store, encryption, entry, lateStamp, { job: workerA }),
    ).rejects.toMatchObject({ name: "JobLeaseLost" });
    expect(await rowsWrittenAt(lateStamp)).toBe(0);
    expect((await journalRow(entry.requestId))?.object_id).toBe(readyObject);
    expect(await objectState(readyObject)).toBe("verified");
    expect(await completeJob(db, claimB, new Date())).toBe(true);
  });

  it("privacy journal: a failing writer never deletes the verified object of another writer", async () => {
    // Without a job and with one: writer 1's commit goes through but its answer is lost. Before
    // writer 1 sees the failure, writer 2, behind the same advisory lock, finds the journal ready
    // and returns on it. Writer 1's cleanup must leave that verified object and its bytes.
    const { claim: claimed } = await claimedSyntheticJob(60);
    for (const options of [{}, { job: contextOf(claimed) }]) {
      const store = new MemoryObjectStore();
      const entry = journalEntry();
      let other: Promise<unknown> = Promise.resolve();
      const lostAnswer = aroundTransactions(async (index, run) => {
        const result = await run();
        if (index !== 2) return result;
        other = appendEncryptedDeletionJournal(db, store, encryption, entry);
        await other;
        throw new Error("Synthetic lost commit answer");
      });
      await expect(
        appendEncryptedDeletionJournal(lostAnswer, store, encryption, entry, undefined, options),
      ).rejects.toThrow("Synthetic lost commit answer");
      const row = await journalRow(entry.requestId);
      await expect(other).resolves.toEqual({ journalId: row?.id });
      await expectReadyWithBytes(store, entry.requestId);
      expect(await readEncryptedDeletionJournals(store, keys)).toEqual([entry]);
    }
    expect(await completeJob(db, claimed, new Date())).toBe(true);
  });

  it("privacy journal: a ready journal always has its encrypted bytes", async () => {
    const store = new MemoryObjectStore();
    const entry = journalEntry();
    // A provider outage during the upload: the staged object goes, the journal stays pending.
    await expect(
      appendEncryptedDeletionJournal(db, failingWrites(store), encryption, entry),
    ).rejects.toThrow("Synthetic store write failure");
    const failed = await journalRow(entry.requestId);
    expect(failed?.state).toBe("pending");
    if (!failed?.object_id) throw new Error("Expected the failed writer's target");
    expect(await objectState(failed.object_id)).toBe("deleted");
    // A writer whose commit answer is lost after the journal became ready.
    const lostAnswer = aroundTransactions(async (index, run) => {
      const result = await run();
      if (index === 2) throw new Error("Synthetic lost commit answer");
      return result;
    });
    await expect(
      appendEncryptedDeletionJournal(lostAnswer, store, encryption, entry),
    ).rejects.toThrow("Synthetic lost commit answer");
    const readyObject = await expectReadyWithBytes(store, entry.requestId);
    // Concurrent repeats return the same ready journal and leave its object as it is.
    const repeats = await Promise.all(
      [0, 1, 2].map(() => appendEncryptedDeletionJournal(db, store, encryption, entry)),
    );
    expect(new Set(repeats.map((result) => result.journalId))).toEqual(new Set([failed.id]));
    expect(await expectReadyWithBytes(store, entry.requestId)).toBe(readyObject);
    expect(await readEncryptedDeletionJournals(store, keys)).toEqual([entry]);
  });

  it("privacy journal: the API path without a Job keeps its behaviour", async () => {
    // The API acknowledgement (persistDeletionJournal) writes outside any job: no job row, lease
    // or authority is involved, and an omitted, empty or job-less options object is the same call.
    const store = new MemoryObjectStore();
    const entries = [journalEntry(), journalEntry(), journalEntry()];
    const [first, second, third] = entries;
    if (!first || !second || !third) throw new Error("Expected three entries");
    const created = await appendEncryptedDeletionJournal(db, store, encryption, first);
    await appendEncryptedDeletionJournal(db, store, encryption, second, undefined, {});
    await appendEncryptedDeletionJournal(db, store, encryption, third, new Date(), {
      job: undefined,
    });
    const object = await expectReadyWithBytes(store, first.requestId);
    await expectReadyWithBytes(store, second.requestId);
    await expectReadyWithBytes(store, third.requestId);
    // Idempotent by requestId; a different entry under the same id is refused.
    expect(await appendEncryptedDeletionJournal(db, store, encryption, first)).toEqual(created);
    expect(await expectReadyWithBytes(store, first.requestId)).toBe(object);
    await expect(
      appendEncryptedDeletionJournal(db, store, encryption, { ...first, subjectId: randomUUID() }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });
    // A failed upload without a job: its pending staged object is deleted and a retry succeeds.
    const retried = journalEntry();
    await expect(
      appendEncryptedDeletionJournal(db, failingWrites(store), encryption, retried),
    ).rejects.toThrow("Synthetic store write failure");
    const failed = await journalRow(retried.requestId);
    if (!failed?.object_id) throw new Error("Expected the failed writer's target");
    expect(failed.state).toBe("pending");
    expect(await objectState(failed.object_id)).toBe("deleted");
    await appendEncryptedDeletionJournal(db, store, encryption, retried);
    expect(await expectReadyWithBytes(store, retried.requestId)).not.toBe(failed.object_id);
    const recovered = await readEncryptedDeletionJournals(store, keys);
    expect(recovered).toHaveLength(4);
    expect(recovered).toEqual(expect.arrayContaining([...entries, retried]));
  });
});
