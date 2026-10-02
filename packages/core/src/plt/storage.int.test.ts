import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { createDatabase } from "../db";
import { AppError } from "./errors";
import { DEFAULT_PLT_SETTINGS } from "./settings";
import {
  confirmObject,
  createObject,
  deleteObject,
  issueReadLink,
  issueWriteLink,
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
    await deleteObject(db, store, { userId: owner }, id, at(2));
    expect(await store.head(key)).toBeNull();
    const row = await db
      .selectFrom("plt.storage_object")
      .select(["state", "deleted_at"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: "deleted", deleted_at: at(1) });
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
});
