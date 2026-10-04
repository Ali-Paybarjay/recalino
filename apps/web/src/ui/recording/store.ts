import { z } from "zod";

export const recordingSchema = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  sessionId: z.uuid().nullable(),
  mimeType: z.string().max(100),
  status: z.enum(["recording", "paused", "saved", "interrupted"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activeMs: z.number().finite().nonnegative(),
  chunks: z.int().nonnegative(),
  bytes: z.int().nonnegative(),
  creationKey: z.uuid(),
  sourceAssetId: z.uuid().nullable().default(null),
});
export type Recording = z.infer<typeof recordingSchema>;
export interface RecordingStore {
  put(manifest: Recording): Promise<void>;
  append(manifest: Recording, chunk: Blob): Promise<Recording>;
  get(userId: string, id: string): Promise<Recording | null>;
  list(userId: string): Promise<Recording[]>;
  blob(userId: string, id: string): Promise<Blob>;
  remove(userId: string, id: string): Promise<void>;
}

const DB_NAME = "recalino-recordings-v1";
type Chunk = { userId: string; recordingId: string; sequence: number; blob: Blob };
export type LocalPhoto = {
  id: string;
  userId: string;
  recordingId: string;
  offsetMs: number;
  captureState: "recording" | "paused";
  blob: Blob;
  createdAt: string;
  sourceAssetId: string | null;
};
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Local save failed"));
    tx.onerror = () => reject(tx.error ?? new Error("Local save failed"));
  });
}

/** The marker and every write share a transaction, including across other open tabs. */
function unlessAccountDeleted(tx: IDBTransaction, userId: string, write: () => void): void {
  const request = tx.objectStore("deletedAccounts").get(userId);
  request.onsuccess = () => {
    if (request.result !== undefined) {
      tx.abort();
      return;
    }
    try {
      write();
    } catch {
      tx.abort();
    }
  };
}

/** Account-scoped, atomic local storage. No audio is sent to any server here (D29). */
export class IndexedRecordingStore implements RecordingStore {
  private connection: Promise<IDBDatabase> | null = null;
  private open() {
    this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 3);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("recordings")) {
          const manifests = request.result.createObjectStore("recordings", {
            keyPath: ["userId", "id"],
          });
          manifests.createIndex("owner", "userId");
          request.result.createObjectStore("chunks", {
            keyPath: ["userId", "recordingId", "sequence"],
          });
        }
        if (!request.result.objectStoreNames.contains("photos"))
          request.result.createObjectStore("photos", { keyPath: ["userId", "recordingId", "id"] });
        if (!request.result.objectStoreNames.contains("deletedAccounts"))
          request.result.createObjectStore("deletedAccounts", { keyPath: "userId" });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Close another Recalino tab to open local recordings"));
    });
    return this.connection;
  }
  async put(manifest: Recording) {
    recordingSchema.parse(manifest);
    const db = await this.open();
    const tx = db.transaction(["recordings", "deletedAccounts"], "readwrite", {
      durability: "strict",
    });
    const done = committed(tx);
    unlessAccountDeleted(tx, manifest.userId, () => tx.objectStore("recordings").put(manifest));
    await done;
  }
  async append(manifest: Recording, blob: Blob) {
    const db = await this.open();
    const tx = db.transaction(["recordings", "chunks", "deletedAccounts"], "readwrite", {
      durability: "strict",
    });
    const done = committed(tx);
    let next: Recording | null = null;
    unlessAccountDeleted(tx, manifest.userId, () => {
      const request = tx.objectStore("recordings").get([manifest.userId, manifest.id]);
      request.onsuccess = () => {
        try {
          const previous = recordingSchema.parse(request.result);
          next = recordingSchema.parse({
            ...manifest,
            sessionId: previous.sessionId ?? manifest.sessionId,
            sourceAssetId: previous.sourceAssetId ?? manifest.sourceAssetId,
            chunks: previous.chunks + 1,
            bytes: previous.bytes + blob.size,
          });
          tx.objectStore("chunks").add({
            userId: manifest.userId,
            recordingId: manifest.id,
            sequence: previous.chunks,
            blob,
          } satisfies Chunk);
          tx.objectStore("recordings").put(next);
        } catch {
          tx.abort();
        }
      };
    });
    await done;
    if (!next) throw new Error("Local recording is missing");
    return next;
  }
  async get(userId: string, id: string) {
    const db = await this.open();
    const tx = db.transaction("recordings", "readonly");
    const value: unknown = await result(tx.objectStore("recordings").get([userId, id]));
    return value === undefined ? null : recordingSchema.parse(value);
  }
  async list(userId: string) {
    const db = await this.open();
    const tx = db.transaction("recordings", "readonly");
    const rows: unknown[] = await result(
      tx.objectStore("recordings").index("owner").getAll(userId),
    );
    return rows
      .map((r) => recordingSchema.parse(r))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async blob(userId: string, id: string) {
    const manifest = await this.get(userId, id);
    if (!manifest) throw new Error("Recording is missing on this device");
    const db = await this.open();
    const tx = db.transaction("chunks", "readonly");
    const chunks: Chunk[] = await result(
      tx
        .objectStore("chunks")
        .getAll(IDBKeyRange.bound([userId, id, 0], [userId, id, Number.MAX_SAFE_INTEGER])),
    );
    if (
      chunks.length !== manifest.chunks ||
      chunks.some((row, index) => row.sequence !== index) ||
      chunks.reduce((sum, row) => sum + row.blob.size, 0) !== manifest.bytes
    )
      throw new Error("Some saved recording parts are missing");
    return new Blob(
      chunks.map((chunk) => chunk.blob),
      { type: manifest.mimeType },
    );
  }
  async remove(userId: string, id: string) {
    const db = await this.open();
    const tx = db.transaction(["recordings", "chunks", "photos"], "readwrite", {
      durability: "strict",
    });
    const done = committed(tx);
    tx.objectStore("chunks").delete(
      IDBKeyRange.bound([userId, id, 0], [userId, id, Number.MAX_SAFE_INTEGER]),
    );
    tx.objectStore("photos").delete(IDBKeyRange.bound([userId, id, ""], [userId, id, "\uffff"]));
    tx.objectStore("recordings").delete([userId, id]);
    await done;
  }
  async savePhoto(photo: LocalPhoto) {
    if (
      !/^(image\/jpeg|image\/png|image\/webp)$/.test(photo.blob.type) ||
      photo.blob.size === 0 ||
      !Number.isFinite(photo.offsetMs) ||
      photo.offsetMs < 0
    )
      throw new Error("This photo could not be saved with the recording.");
    const db = await this.open();
    const tx = db.transaction(["photos", "recordings", "deletedAccounts"], "readwrite", {
      durability: "strict",
    });
    const done = committed(tx);
    unlessAccountDeleted(tx, photo.userId, () => {
      const request = tx.objectStore("recordings").get([photo.userId, photo.recordingId]);
      request.onsuccess = () => {
        if (!request.result) tx.abort();
        else tx.objectStore("photos").put(photo);
      };
    });
    await done;
  }
  /** Clear only this account, including orphan photos, and permanently reject late writes. */
  async removeAccount(userId: string): Promise<void> {
    z.uuid().parse(userId);
    const db = await this.open();
    const tx = db.transaction(["recordings", "chunks", "photos", "deletedAccounts"], "readwrite", {
      durability: "strict",
    });
    const done = committed(tx);
    tx.objectStore("deletedAccounts").put({ userId });
    const range = IDBKeyRange.bound([userId], [userId, "\uffff"]);
    for (const name of ["recordings", "chunks", "photos"]) tx.objectStore(name).delete(range);
    await done;
  }
  async removePhoto(userId: string, recordingId: string, photoId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction("photos", "readwrite", { durability: "strict" });
    const done = committed(tx);
    tx.objectStore("photos").delete([userId, recordingId, photoId]);
    await done;
  }
  async photos(userId: string, recordingId: string): Promise<LocalPhoto[]> {
    const db = await this.open();
    const tx = db.transaction("photos", "readonly");
    return result(
      tx
        .objectStore("photos")
        .getAll(IDBKeyRange.bound([userId, recordingId, ""], [userId, recordingId, "\uffff"])),
    );
  }
}
