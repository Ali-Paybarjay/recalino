import { createHash, randomUUID } from "node:crypto";
import { type KyselyPlugin, sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { AppError } from "./errors";
import { cancelJob, claimJobs, enqueueJob, type JobLease, sweepJobs } from "./jobs";
import { DEFAULT_PLT_SETTINGS } from "./settings";
import {
  confirmObject,
  createObject,
  deleteObject,
  issueReadLink,
  issueWriteLink,
  markPendingObjectDeleted,
  ownerStorageAccessExpiry,
  reconcileStorage,
  writeOwnedObject,
} from "./storage";
import { MemoryObjectStore } from "./storage-memory";

// FR-PLT-008 and FR-PLT-014 on the local database, with the in-memory store: no network, no
// storage provider (FR-PLT-014 rule 2).

const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
afterAll(() => db.destroy());

const T0 = new Date("2026-10-02T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const settings = DEFAULT_PLT_SETTINGS.storage;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

function setup() {
  let clock = T0;
  const store = new MemoryObjectStore(() => clock);
  return {
    store,
    tick: (seconds: number) => {
      clock = at(seconds);
    },
  };
}

async function pngFor(userId: string, sizeBytes = PNG.byteLength) {
  return createObject(db, {
    module: "src",
    ownerUserId: userId,
    retention: "durable",
    contentType: "image/png",
    sizeBytes,
    now: T0,
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : "other";
  }
}

describe("FR-PLT-008 signed links", () => {
  it("are not issued for another learner's object: not_found, recorded", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const other = randomUUID();
    const { id } = await pngFor(owner);
    expect(
      await codeOf(issueWriteLink(db, store, { userId: other }, id, { now: T0, settings })),
    ).toBe("not_found");
    expect(
      await codeOf(issueReadLink(db, store, { userId: other }, id, { now: T0, settings })),
    ).toBe("not_found");
    expect(
      await codeOf(
        issueWriteLink(db, store, { userId: other }, randomUUID(), { now: T0, settings }),
      ),
    ).toBe("not_found");
  });

  it("accept only the recorded type and size, and expire", async () => {
    const { store, tick } = setup();
    const owner = randomUUID();
    const { id } = await pngFor(owner);
    const { url, validUntil } = await issueWriteLink(db, store, { userId: owner }, id, {
      now: T0,
      settings,
    });
    expect(validUntil).toEqual(at(settings.writeLinkSeconds));
    expect(store.upload(url, PNG, "image/jpeg")).toBe(400);
    expect(store.upload(url, new Uint8Array(PNG.byteLength + 1), "image/png")).toBe(413);
    tick(settings.writeLinkSeconds);
    expect(store.upload(url, PNG, "image/png")).toBe(403);

    tick(0);
    expect(store.upload(url, PNG, "image/png")).toBe(200);
  });

  it("give read access only to a verified object, and the read link expires", async () => {
    const { store, tick } = setup();
    const owner = randomUUID();
    const { id } = await pngFor(owner);
    expect(
      await codeOf(issueReadLink(db, store, { userId: owner }, id, { now: T0, settings })),
    ).toBe("not_found");
    const write = await issueWriteLink(db, store, { userId: owner }, id, { now: T0, settings });
    store.upload(write.url, PNG, "image/png");
    expect(await confirmObject(db, store, { userId: owner }, id, { now: T0 })).toBe("verified");
    const read = await issueReadLink(db, store, { userId: owner }, id, { now: T0, settings });
    expect(store.download(read.url)).toEqual({ status: 200, bytes: PNG });
    tick(settings.readLinkSeconds + 1);
    expect(store.download(read.url).status).toBe(403);
  });
});

describe("FR-PLT-014 storage layer", () => {
  it("verifies an object only with the recorded size, type and checksum", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const actor = { userId: owner };
    const missing = await pngFor(owner);
    expect(await confirmObject(db, store, actor, missing.id, { now: T0 })).toBe("missing");

    const short = await pngFor(owner, PNG.byteLength + 5);
    store.seed(short.key, PNG, "image/png", T0);
    expect(await confirmObject(db, store, actor, short.id, { now: T0 })).toBe("size_mismatch");

    const tampered = await pngFor(owner);
    store.seed(tampered.key, PNG, "image/png", T0);
    const wrongHash = createHash("sha256").update("something else").digest("hex");
    expect(await confirmObject(db, store, actor, tampered.id, { now: T0, sha256: wrongHash })).toBe(
      "checksum_mismatch",
    );
    const rightHash = createHash("sha256").update(PNG).digest("hex");
    expect(await confirmObject(db, store, actor, tampered.id, { now: T0, sha256: rightHash })).toBe(
      "verified",
    );
  });

  it("builds every key on the server and never stores a provider URL", async () => {
    const owner = randomUUID();
    const { id, key } = await pngFor(owner);
    expect(key).toMatch(new RegExp(`^src/${owner}/[0-9a-f-]{36}$`));
    const row = await db
      .selectFrom("plt.storage_object")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toMatch(/https?:|memory:|blob\.vercel-storage/);
  });

  it("deletes once; deleting again has no further effect", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const { id, key } = await pngFor(owner);
    store.seed(key, PNG, "image/png", T0);
    await confirmObject(db, store, { userId: owner }, id, { now: T0 });
    await deleteObject(db, store, { userId: owner }, id, at(1));
    // A client can finish a previously authorized PUT before its short lease expires.
    store.seed(key, PNG, "image/png", at(2));
    await deleteObject(db, store, { userId: owner }, id, at(2));
    expect(await store.head(key)).toBeNull();
    const row = await db
      .selectFrom("plt.storage_object")
      .select(["state", "deleted_at"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: "deleted", deleted_at: at(1) });
  });

  it("records the longest issued lease and never shortens the final-erasure fence", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const { id, key } = await pngFor(owner);
    const first = await issueWriteLink(db, store, { userId: owner }, id, { now: T0, settings });
    expect(await ownerStorageAccessExpiry(db, owner, T0)).toEqual(first.validUntil);
    await issueWriteLink(db, store, { userId: owner }, id, {
      now: T0,
      settings: { ...settings, writeLinkSeconds: 1 },
    });
    expect(await ownerStorageAccessExpiry(db, owner, T0)).toEqual(first.validUntil);
    store.seed(key, PNG, "image/png", T0);
    await confirmObject(db, store, { userId: owner }, id, { now: T0 });
    const read = await issueReadLink(db, store, { userId: owner }, id, { now: at(100), settings });
    expect(await ownerStorageAccessExpiry(db, owner, T0)).toEqual(read.validUntil);
    expect(await ownerStorageAccessExpiry(db, randomUUID(), T0)).toEqual(T0);
  });

  it("reconciles: reports a verified record without its object, keeps young orphans, deletes old ones", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const prefix = `src/${owner}/`;
    const kept = await pngFor(owner);
    store.seed(kept.key, PNG, "image/png", T0);
    await confirmObject(db, store, { userId: owner }, kept.id, { now: T0 });
    const lost = await pngFor(owner);
    store.seed(lost.key, PNG, "image/png", T0);
    await confirmObject(db, store, { userId: owner }, lost.id, { now: T0 });
    await store.delete(lost.key); // gone from the store behind our back

    store.seed(`${prefix}${randomUUID()}`, PNG, "image/png", at(-settings.orphanGraceSeconds - 1));
    const young = `${prefix}${randomUUID()}`;
    store.seed(young, PNG, "image/png", at(-60));

    const lines: string[] = [];
    const summary = await reconcileStorage(db, store, {
      now: T0,
      settings,
      prefix,
      log: (_level, event, fields) => lines.push(`${event} ${fields?.object_id}`),
    });
    expect(summary).toEqual({ orphansDeleted: 1, orphansKept: 1, missingObjects: 1 });
    expect(lines).toEqual([`storage_object_missing ${lost.id}`]);
    expect(await store.head(young)).not.toBeNull();
    expect(await store.head(kept.key)).not.toBeNull();
    const lostRow = await db
      .selectFrom("plt.storage_object")
      .select("state")
      .where("id", "=", lost.id)
      .executeTakeFirstOrThrow();
    expect(lostRow.state).toBe("verified"); // reported, never deleted
  });
  it("immediately purges a tombstoned object recreated by a still-valid write URL", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const object = await pngFor(owner);
    store.seed(object.key, PNG, "image/png", T0);
    await confirmObject(db, store, { userId: owner }, object.id, { now: T0 });
    await deleteObject(db, store, { userId: owner }, object.id, at(1));
    store.seed(object.key, PNG, "image/png", at(2));
    const summary = await reconcileStorage(db, store, {
      now: at(3),
      settings,
      prefix: `src/${owner}/`,
    });
    expect(summary.orphansDeleted).toBe(1);
    expect(await store.head(object.key)).toBeNull();
  });
});

async function objectRow(id: string) {
  return db
    .selectFrom("plt.storage_object")
    .select(["state", "deleted_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

/**
 * The database as a call sees it when another session verifies the object right after the call's
 * first read: the verification commits between that read and the call's own update. `readStates`
 * collects the state each such read returned, so a test can show the read still saw pending.
 */
function verifiedAfterFirstRead(id: string, readStates: unknown[]) {
  const selects = new Set<unknown>();
  let raced = false;
  const plugin: KyselyPlugin = {
    transformQuery: ({ node, queryId }) => {
      if (node.kind === "SelectQueryNode") selects.add(queryId);
      return node;
    },
    transformResult: async ({ queryId, result }) => {
      if (!raced && selects.has(queryId)) {
        raced = true;
        readStates.push(result.rows[0]?.state);
        await db
          .updateTable("plt.storage_object")
          .set({ state: "verified", verified_at: T0 })
          .where("id", "=", id)
          .execute();
      }
      return result;
    },
  };
  return db.withPlugin(plugin);
}

describe("P11-03 conditional storage state changes", () => {
  it("C10-3 confirmObject does not report verified when the record left pending before its update", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const object = await pngFor(owner);
    store.seed(object.key, PNG, "image/png", T0);
    // A concurrent cleanup marks the record deleted while the store is being checked.
    const racing = Object.assign(Object.create(store) as typeof store, {
      head: async (key: string) => {
        await db
          .updateTable("plt.storage_object")
          .set({ state: "deleted", deleted_at: at(1) })
          .where("id", "=", object.id)
          .execute();
        return store.head(key);
      },
    });
    expect(await codeOf(confirmObject(db, racing, { userId: owner }, object.id, { now: T0 }))).toBe(
      "conflict",
    );
    expect(await objectRow(object.id)).toEqual({ state: "deleted", deleted_at: at(1) });
  });

  it("C10-5 never marks deleted an object verified between the read and the conditional update", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const object = await pngFor(owner);
    store.seed(object.key, PNG, "image/png", T0);
    // The mark reads the pending record; the record turns verified before the mark's update.
    const reads: unknown[] = [];
    expect(
      await markPendingObjectDeleted(
        verifiedAfterFirstRead(object.id, reads),
        { userId: owner },
        object.id,
        at(1),
      ),
    ).toBe(false);
    expect(reads).toEqual(["pending"]);
    expect(await objectRow(object.id)).toEqual({ state: "verified", deleted_at: null });
    expect(await store.head(object.key)).not.toBeNull();

    // The same window for the pending-only delete: neither the record nor the bytes change.
    const other = await pngFor(owner);
    store.seed(other.key, PNG, "image/png", T0);
    const otherReads: unknown[] = [];
    expect(
      await deleteObject(
        verifiedAfterFirstRead(other.id, otherReads),
        store,
        { userId: owner },
        other.id,
        at(1),
        { pendingOnly: true },
      ),
    ).toBe(false);
    expect(otherReads).toEqual(["pending"]);
    expect(await objectRow(other.id)).toEqual({ state: "verified", deleted_at: null });
    expect(await store.head(other.key)).not.toBeNull();
  });

  it("C10-5 a pending-only delete leaves a verified object, its record and its bytes alone", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const object = await pngFor(owner);
    store.seed(object.key, PNG, "image/png", T0);
    expect(await confirmObject(db, store, { userId: owner }, object.id, { now: T0 })).toBe(
      "verified",
    );
    expect(
      await deleteObject(db, store, { userId: owner }, object.id, at(1), { pendingOnly: true }),
    ).toBe(false);
    expect(await markPendingObjectDeleted(db, { userId: owner }, object.id, at(1))).toBe(false);
    expect(await objectRow(object.id)).toEqual({ state: "verified", deleted_at: null });
    expect(await store.head(object.key)).not.toBeNull();
  });

  it("marks a pending object deleted without deleting its bytes; storage reconciliation removes them", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const object = await pngFor(owner);
    store.seed(object.key, PNG, "image/png", T0);
    expect(
      await codeOf(markPendingObjectDeleted(db, { userId: randomUUID() }, object.id, at(1))),
    ).toBe("not_found");
    expect(await markPendingObjectDeleted(db, { userId: owner }, object.id, at(1))).toBe(true);
    expect(await objectRow(object.id)).toEqual({ state: "deleted", deleted_at: at(1) });
    expect(await store.head(object.key)).not.toBeNull();
    // Repeating it has no further effect.
    expect(await markPendingObjectDeleted(db, { userId: owner }, object.id, at(2))).toBe(false);
    expect(await objectRow(object.id)).toEqual({ state: "deleted", deleted_at: at(1) });
    const summary = await reconcileStorage(db, store, {
      now: at(3),
      settings,
      prefix: `src/${owner}/`,
    });
    expect(summary.orphansDeleted).toBe(1);
    expect(await store.head(object.key)).toBeNull();
  });

  it("a pending-only delete tries the bytes at once and reports a failed byte delete, keeping the record deleted", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const removed = await pngFor(owner);
    store.seed(removed.key, PNG, "image/png", T0);
    expect(
      await deleteObject(db, store, { userId: owner }, removed.id, at(1), { pendingOnly: true }),
    ).toBe(true);
    expect(await objectRow(removed.id)).toEqual({ state: "deleted", deleted_at: at(1) });
    expect(await store.head(removed.key)).toBeNull();

    const kept = await pngFor(owner);
    store.seed(kept.key, PNG, "image/png", T0);
    const failing = Object.assign(Object.create(store) as typeof store, {
      delete: async () => {
        throw new Error("Synthetic store outage");
      },
    });
    const failures: unknown[] = [];
    expect(
      await deleteObject(db, failing, { userId: owner }, kept.id, at(1), {
        pendingOnly: true,
        onByteDeleteFailure: (error) => failures.push(error),
      }),
    ).toBe(true);
    expect(failures).toHaveLength(1);
    expect(await objectRow(kept.id)).toEqual({ state: "deleted", deleted_at: at(1) });
    expect(await store.head(kept.key)).not.toBeNull();
  });
});

/**
 * A job of its own queue kind, claimed by worker A, and `reclaim`: A's lease ends on the database
 * clock, the sweep returns the job and worker B claims it, so A's claim is void (ADR-0004 rule 2).
 */
async function claimedJob() {
  const kind = `plt.synthetic_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await db
    .transaction()
    .execute((tx) =>
      enqueueJob(
        tx,
        { kind, version: 1, payload: z.strictObject({}) },
        { payload: {}, now, defaults: DEFAULT_PLT_SETTINGS.jobs },
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

async function ownerObjects(owner: string) {
  return db
    .selectFrom("plt.storage_object")
    .select(["id", "state"])
    .where("owner_user_id", "=", owner)
    .execute();
}

const leaseLost = { name: "JobLeaseLost" };

describe("P11-02 storage records written for a job need its authority (ADR-0004 rules 4 and 6)", () => {
  it("AC-3 writeOwnedObject from a job records and verifies the object only with that job's authority", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const job = await claimedJob();
    const write = (lease: JobLease, target = store) =>
      writeOwnedObject(
        db,
        target,
        { userId: owner },
        {
          module: "src",
          retention: "durable",
          contentType: "image/png",
          bytes: PNG,
          now: T0,
          job: { lease },
        },
      );
    // With the authority, as before.
    const first = await write(job.a);
    expect(await ownerObjects(owner)).toEqual([{ id: first, state: "verified" }]);

    // After the reclaim, A records nothing: the registration rolls back and no bytes are written.
    const b = await job.reclaim();
    await expect(write(job.a)).rejects.toMatchObject(leaseLost);
    expect(await ownerObjects(owner)).toEqual([{ id: first, state: "verified" }]);
    expect((await store.list(`src/${owner}/`)).objects).toHaveLength(1);

    // B, the current claim, writes as the contract says.
    const second = await write(b);
    expect((await ownerObjects(owner)).find((row) => row.id === second)?.state).toBe("verified");
    await job.done();
  });

  it("AC-3 a job whose claim becomes void while its bytes are written never verifies the record", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const job = await claimedJob();
    // A registers the record with its authority; the job is reclaimed while A writes the bytes.
    const reclaimedDuringWrite = Object.assign(Object.create(store) as typeof store, {
      write: async (key: string, bytes: Uint8Array, contentType: string) => {
        await store.write(key, bytes, contentType);
        await job.reclaim();
      },
    });
    await expect(
      writeOwnedObject(
        db,
        reclaimedDuringWrite,
        { userId: owner },
        {
          module: "src",
          retention: "durable",
          contentType: "image/png",
          bytes: PNG,
          now: T0,
          job: { lease: job.a },
        },
      ),
    ).rejects.toMatchObject(leaseLost);
    // The verification rolled back; the cleanup marks the record deleted and removes the bytes.
    const rows = await ownerObjects(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("deleted");
    expect((await store.list(`src/${owner}/`)).objects).toHaveLength(0);
    await job.done();
  });

  it("AC-4 a pending-only delete from a job marks the record only with that job's authority, and deletes the bytes only after the mark committed", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const job = await claimedJob();
    const object = await pngFor(owner);
    store.seed(object.key, PNG, "image/png", T0);
    const b = await job.reclaim();

    // A, after the reclaim: neither the record nor the bytes change, alone or in its transaction.
    await expect(
      deleteObject(db, store, { userId: owner }, object.id, at(1), {
        pendingOnly: true,
        job: { lease: job.a },
      }),
    ).rejects.toMatchObject(leaseLost);
    await expect(
      db.transaction().execute((tx) =>
        deleteObject(tx, store, { userId: owner }, object.id, at(1), {
          pendingOnly: true,
          job: { lease: job.a },
        }),
      ),
    ).rejects.toMatchObject(leaseLost);
    expect(await objectRow(object.id)).toEqual({ state: "pending", deleted_at: null });
    expect(await store.head(object.key)).not.toBeNull();

    // B: the mark commits first; the byte delete sees it from another session.
    const seenAtByteDelete: unknown[] = [];
    const observing = Object.assign(Object.create(store) as typeof store, {
      delete: async (key: string) => {
        seenAtByteDelete.push((await objectRow(object.id)).state);
        await store.delete(key);
      },
    });
    expect(
      await deleteObject(db, observing, { userId: owner }, object.id, at(1), {
        pendingOnly: true,
        job: { lease: b },
      }),
    ).toBe(true);
    expect(seenAtByteDelete).toEqual(["deleted"]);
    expect(await objectRow(object.id)).toEqual({ state: "deleted", deleted_at: at(1) });
    expect(await store.head(object.key)).toBeNull();
    // Zero rows is never a success, with the authority too.
    expect(
      await deleteObject(db, store, { userId: owner }, object.id, at(2), {
        pendingOnly: true,
        job: { lease: b },
      }),
    ).toBe(false);

    // A failed byte delete keeps the record deleted for storage reconciliation (P10-03 B).
    const kept = await pngFor(owner);
    store.seed(kept.key, PNG, "image/png", T0);
    const failing = Object.assign(Object.create(store) as typeof store, {
      delete: async () => {
        throw new Error("Synthetic store outage");
      },
    });
    const failures: unknown[] = [];
    expect(
      await deleteObject(db, failing, { userId: owner }, kept.id, at(1), {
        pendingOnly: true,
        job: { lease: b },
        onByteDeleteFailure: (error) => failures.push(error),
      }),
    ).toBe(true);
    expect(failures).toHaveLength(1);
    expect(await objectRow(kept.id)).toEqual({ state: "deleted", deleted_at: at(1) });
    expect(await store.head(kept.key)).not.toBeNull();
    await job.done();
  });

  it("AC-13 a JobContext without a lease is refused by every guarded storage write (fail-closed)", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const noLease = {};
    await expect(
      writeOwnedObject(
        db,
        store,
        { userId: owner },
        {
          module: "src",
          retention: "durable",
          contentType: "image/png",
          bytes: PNG,
          now: T0,
          job: noLease,
        },
      ),
    ).rejects.toMatchObject(leaseLost);
    expect(await ownerObjects(owner)).toEqual([]);
    expect((await store.list(`src/${owner}/`)).objects).toHaveLength(0);

    const object = await pngFor(owner);
    store.seed(object.key, PNG, "image/png", T0);
    await expect(
      confirmObject(db, store, { userId: owner }, object.id, { now: at(1), job: noLease }),
    ).rejects.toMatchObject(leaseLost);
    await expect(
      deleteObject(db, store, { userId: owner }, object.id, at(1), {
        pendingOnly: true,
        job: noLease,
      }),
    ).rejects.toMatchObject(leaseLost);
    expect(await objectRow(object.id)).toEqual({ state: "pending", deleted_at: null });
    expect(await store.head(object.key)).not.toBeNull();
  });

  it("AC-4 C11-4 in a caller's transaction, the bytes are deleted only after the mark committed, and never when it rolls back", async () => {
    const { store } = setup();
    const owner = randomUUID();
    const job = await claimedJob();

    // Rolled back after the mark: the record stays pending and the bytes stay.
    const rolledBack = await pngFor(owner);
    store.seed(rolledBack.key, PNG, "image/png", T0);
    const discarded: (() => Promise<void>)[] = [];
    await expect(
      db.transaction().execute(async (tx) => {
        expect(
          await deleteObject(tx, store, { userId: owner }, rolledBack.id, at(1), {
            pendingOnly: true,
            job: { lease: job.a },
            afterCommit: (effect) => discarded.push(effect),
          }),
        ).toBe(true);
        throw new Error("Synthetic rollback");
      }),
    ).rejects.toThrow("Synthetic rollback");
    expect(await objectRow(rolledBack.id)).toEqual({ state: "pending", deleted_at: null });
    expect(await store.head(rolledBack.key)).not.toBeNull();

    // Committed: no byte is deleted inside the transaction; the deferred delete runs after it.
    const committed = await pngFor(owner);
    store.seed(committed.key, PNG, "image/png", T0);
    const deferred: (() => Promise<void>)[] = [];
    await db.transaction().execute(async (tx) => {
      await deleteObject(tx, store, { userId: owner }, committed.id, at(1), {
        pendingOnly: true,
        job: { lease: job.a },
        afterCommit: (effect) => deferred.push(effect),
      });
      expect(await store.head(committed.key)).not.toBeNull();
    });
    expect(deferred).toHaveLength(1);
    expect(await store.head(committed.key)).not.toBeNull();
    for (const effect of deferred) await effect();
    expect(await objectRow(committed.id)).toEqual({ state: "deleted", deleted_at: at(1) });
    expect(await store.head(committed.key)).toBeNull();
    await job.done();
  });
});
