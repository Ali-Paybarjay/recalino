import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase, type Tx } from "../db";
import { AppError } from "./errors";
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

/** Waits until another session is blocked on a row lock this transaction holds. */
async function untilBlockedBy(tx: Tx) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await sql<{ blocked: boolean }>`
      select exists (
        select 1 from pg_stat_activity where pg_backend_pid() = any(pg_blocking_pids(pid))
      ) as blocked`.execute(tx);
    if (rows[0]?.blocked) return;
    await sleep(20);
  }
  throw new Error("the other session never waited for the row lock");
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
    let marking: Promise<boolean> | undefined;
    await db.transaction().execute(async (tx) => {
      // The record turns verified in an open transaction; the mark reads the committed pending
      // row, then its update waits for this row lock and re-checks the row after commit.
      await tx
        .updateTable("plt.storage_object")
        .set({ state: "verified", verified_at: T0 })
        .where("id", "=", object.id)
        .execute();
      marking = markPendingObjectDeleted(db, { userId: owner }, object.id, at(1));
      await untilBlockedBy(tx);
    });
    expect(await marking).toBe(false);
    expect(await objectRow(object.id)).toEqual({ state: "verified", deleted_at: null });
    expect(await store.head(object.key)).not.toBeNull();
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
