// FR-PLT-014 and FR-PLT-008: every file operation goes through this thin layer (ADR-0001 rule 9).
// Domain code never calls a storage provider's SDK; it asks for short-lived links here, after the
// owner check. Records hold our own key, never a provider URL.
import { createHash, randomUUID } from "node:crypto";
import type { Database, Tx } from "../db";
import { errors } from "./errors";
import type { Logger } from "./log";
import { assertOwner, type LearnerContext } from "./ownership";
import type { PltSettings } from "./settings";

export interface StoredObjectInfo {
  size: number;
  contentType: string;
  uploadedAt: Date;
  /** The store's version tag, when it has one. */
  etag?: string;
}

/** What a storage provider must offer. Implementations: Vercel Blob, and in-memory for tests. */
export interface ObjectStore {
  readonly name: string;
  /** A URL the browser can PUT one object to; the store rejects other types and larger bodies. */
  signWrite(
    key: string,
    limits: { contentType: string; maxBytes: number; validUntil: Date },
  ): Promise<string>;
  signRead(key: string, validUntil: Date): Promise<string>;
  head(key: string): Promise<StoredObjectInfo | null>;
  read(key: string): Promise<Uint8Array | null>;
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  list(
    prefix: string,
    cursor?: string,
  ): Promise<{ objects: { key: string; size: number; uploadedAt: Date }[]; cursor?: string }>;
}

export type Retention = "durable" | "temporary";
export type ObjectState = "pending" | "verified" | "deleted";

/** A learner acting on their own object, or the system acting for its owner. */
export type StorageActor = Pick<LearnerContext, "userId"> | "system";

export interface NewObject {
  /** The owning module, e.g. "src"; the first part of the key. */
  module: string;
  ownerUserId: string | null;
  retention: Retention;
  contentType: string;
  sizeBytes: number;
  now: Date;
}

/**
 * Records an object as pending, before any write link exists (rule 4). The key is built here
 * from the module, the owner and a random id; nothing the user typed becomes part of it.
 */
export async function createObject(
  tx: Database | Tx,
  input: NewObject,
): Promise<{ id: string; key: string }> {
  const key = `${input.module}/${input.ownerUserId ?? "system"}/${randomUUID()}`;
  const row = await tx
    .insertInto("plt.storage_object")
    .values({
      key,
      owner_module: input.module,
      owner_user_id: input.ownerUserId,
      retention: input.retention,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      created_at: input.now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, key };
}

type ObjectRow = {
  id: string;
  key: string;
  ownerId: string;
  state: ObjectState;
  contentType: string;
  sizeBytes: number;
};

async function loadOwned(db: Database, objectId: string, actor: StorageActor): Promise<ObjectRow> {
  const row = await db
    .selectFrom("plt.storage_object")
    .select(["id", "key", "owner_user_id", "state", "content_type", "size_bytes"])
    .where("id", "=", objectId)
    .executeTakeFirst();
  const object = row && {
    id: row.id,
    key: row.key,
    ownerId: row.owner_user_id ?? "system",
    state: row.state as ObjectState,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
  };
  if (actor === "system") {
    if (!object) throw errors.notFound();
    return object;
  }
  return assertOwner(object, actor);
}

export interface LinkRequest {
  now: Date;
  settings: PltSettings["storage"];
}

/** FR-PLT-008: a write link for a pending object of the caller, limited to its type and size. */
export async function issueWriteLink(
  db: Database,
  store: ObjectStore,
  actor: StorageActor,
  objectId: string,
  request: LinkRequest,
): Promise<{ url: string; validUntil: Date }> {
  const object = await loadOwned(db, objectId, actor);
  if (object.state !== "pending") throw errors.conflict();
  const validUntil = new Date(request.now.getTime() + request.settings.writeLinkSeconds * 1000);
  const url = await store.signWrite(object.key, {
    contentType: object.contentType,
    maxBytes: object.sizeBytes,
    validUntil,
  });
  return { url, validUntil };
}

/** FR-PLT-008: a read link for a verified object of the caller. */
export async function issueReadLink(
  db: Database,
  store: ObjectStore,
  actor: StorageActor,
  objectId: string,
  request: LinkRequest & { validForSeconds?: number },
): Promise<{ url: string; validUntil: Date }> {
  const object = await loadOwned(db, objectId, actor);
  if (object.state !== "verified") throw errors.notFound();
  const seconds = request.validForSeconds ?? request.settings.readLinkSeconds;
  const validUntil = new Date(request.now.getTime() + seconds * 1000);
  return { url: await store.signRead(object.key, validUntil), validUntil };
}

export type ConfirmResult =
  | "verified"
  | "missing"
  | "size_mismatch"
  | "type_mismatch"
  | "checksum_mismatch";

/**
 * After an upload: the object is "verified" only when it exists with the recorded size and type,
 * and, when given, the SHA-256 the client declared (rule 4).
 */
export async function confirmObject(
  db: Database,
  store: ObjectStore,
  actor: StorageActor,
  objectId: string,
  check: { now: Date; sha256?: string },
): Promise<ConfirmResult> {
  const object = await loadOwned(db, objectId, actor);
  if (object.state === "verified") return "verified";
  if (object.state !== "pending") throw errors.notFound();
  const info = await store.head(object.key);
  if (!info) return "missing";
  if (info.size !== object.sizeBytes) return "size_mismatch";
  if (info.contentType !== object.contentType) return "type_mismatch";
  if (check.sha256 !== undefined) {
    const bytes = await store.read(object.key);
    if (!bytes) return "missing";
    if (createHash("sha256").update(bytes).digest("hex") !== check.sha256) {
      return "checksum_mismatch";
    }
  }
  await db
    .updateTable("plt.storage_object")
    .set({ state: "verified", verified_at: check.now })
    .where("id", "=", object.id)
    .where("state", "=", "pending")
    .execute();
  return "verified";
}

/** Deletes the object and marks its record; repeating it has no further effect (PRD-DEL-03). */
export async function deleteObject(
  db: Database,
  store: ObjectStore,
  actor: StorageActor,
  objectId: string,
  now: Date,
): Promise<void> {
  const object = await loadOwned(db, objectId, actor);
  if (object.state === "deleted") return;
  await store.delete(object.key);
  await db
    .updateTable("plt.storage_object")
    .set({ state: "deleted", deleted_at: now })
    .where("id", "=", object.id)
    .execute();
}

export interface ReconcileSummary {
  /** Objects with no record, older than the grace period: deleted. */
  orphansDeleted: number;
  /** Objects with no record, still young: maybe an upload in progress. Kept. */
  orphansKept: number;
  /** Verified records whose object is gone: reported, never deleted. */
  missingObjects: number;
}

/**
 * The periodic check of records against the store (rule 5). A module's own rules, such as
 * abandoned uploads, live in that module.
 */
export async function reconcileStorage(
  db: Database,
  store: ObjectStore,
  options: { now: Date; settings: PltSettings["storage"]; log?: Logger; prefix?: string },
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { orphansDeleted: 0, orphansKept: 0, missingObjects: 0 };
  const graceEnd = options.now.getTime() - options.settings.orphanGraceSeconds * 1000;
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await store.list(options.prefix ?? "", cursor);
    const keys = page.objects.map((object) => object.key);
    const known = new Set(
      keys.length === 0
        ? []
        : (
            await db
              .selectFrom("plt.storage_object")
              .select("key")
              .where("key", "in", keys)
              .where("state", "!=", "deleted")
              .execute()
          ).map((row) => row.key),
    );
    for (const object of page.objects) {
      seen.add(object.key);
      if (known.has(object.key)) continue;
      if (object.uploadedAt.getTime() < graceEnd) {
        await store.delete(object.key);
        summary.orphansDeleted += 1;
      } else {
        summary.orphansKept += 1;
      }
    }
    cursor = page.cursor;
  } while (cursor);

  const verified = await db
    .selectFrom("plt.storage_object")
    .select(["id", "key"])
    .where("state", "=", "verified")
    .$if(options.prefix !== undefined, (qb) => qb.where("key", "like", `${options.prefix}%`))
    .execute();
  for (const row of verified) {
    if (seen.has(row.key)) continue;
    summary.missingObjects += 1;
    options.log?.("error", "storage_object_missing", { object_id: row.id });
  }
  return summary;
}
