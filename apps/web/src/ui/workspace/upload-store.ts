import type { InputContract } from "@recalino/core/src";
import type { FileProcessingReceipt } from "./file-processing";
import type { SourceRow } from "./source-types";

export type UploadEntry = {
  id: string;
  displayName: string;
  sizeBytes: number;
  lastModified: number;
  mimeType: string;
  creationKey: string;
  phase:
    | "queued"
    | "checking"
    | "uploading"
    | "saving"
    | "local_saved"
    | "verifying"
    | "complete"
    | "failed"
    | "skipped";
  sentBytes: number;
  startedAt: number;
  finishedAt?: number;
  problem?: string;
  source?: SourceRow;
  serverSeen: boolean;
  registered?: boolean;
  prepared?: {
    sha256: string;
    parts: { index: number; sizeBytes: number; sha256: string }[];
    durationMs?: number;
  };
  preparationMs?: number;
  transferMs?: number;
};
export type UploadBatch = {
  id: string;
  userId: string;
  sessionId: string;
  contract: InputContract;
  storageConfigured: boolean;
  createdAt: number;
  phase: "queued" | "uploading" | "attention" | "received" | "cancelled";
  entries: UploadEntry[];
  receipt: FileProcessingReceipt;
  opened?: boolean;
  problem?: string;
};
export interface UploadStore {
  save(batch: UploadBatch, files?: readonly { id: string; blob: Blob }[]): Promise<void>;
  list(userId: string): Promise<UploadBatch[]>;
  file(userId: string, batchId: string, id: string): Promise<Blob | null>;
  removeFile(userId: string, batchId: string, id: string): Promise<void>;
  removeAccount(userId: string): Promise<void>;
}

const databaseName = "recalino-uploads-v1";
function value<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function commit(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("The upload could not be saved on this device."));
  });
}

/** Bytes and stable operation IDs commit together; a deletion tombstone fences stale tabs. */
export class IndexedUploadStore implements UploadStore {
  private async open(): Promise<IDBDatabase> {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("batches", { keyPath: ["userId", "id"] }).createIndex("owner", "userId");
      db.createObjectStore("files", { keyPath: ["userId", "batchId", "id"] }).createIndex(
        "owner",
        "userId",
      );
      db.createObjectStore("deletedAccounts", { keyPath: "userId" });
    };
    return value(request);
  }
  async save(batch: UploadBatch, files: readonly { id: string; blob: Blob }[] = []): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction(["batches", "files", "deletedAccounts"], "readwrite", {
        durability: "strict",
      });
      const done = commit(tx);
      const tombstone = tx.objectStore("deletedAccounts").get(batch.userId);
      tombstone.onsuccess = () => {
        if (tombstone.result) {
          tx.abort();
          return;
        }
        tx.objectStore("batches").put(batch);
        for (const file of files)
          tx.objectStore("files").put({ userId: batch.userId, batchId: batch.id, ...file });
      };
      await done;
    } finally {
      db.close();
    }
  }
  async list(userId: string): Promise<UploadBatch[]> {
    const db = await this.open();
    try {
      return (await value(
        db.transaction("batches").objectStore("batches").index("owner").getAll(userId),
      )) as UploadBatch[];
    } finally {
      db.close();
    }
  }
  async file(userId: string, batchId: string, id: string): Promise<Blob | null> {
    const db = await this.open();
    try {
      const row = await value(
        db.transaction("files").objectStore("files").get([userId, batchId, id]),
      );
      return row?.blob ?? null;
    } finally {
      db.close();
    }
  }
  async removeFile(userId: string, batchId: string, id: string): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction("files", "readwrite", { durability: "strict" }),
        done = commit(tx);
      tx.objectStore("files").delete([userId, batchId, id]);
      await done;
    } finally {
      db.close();
    }
  }
  async removeAccount(userId: string): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction(["batches", "files", "deletedAccounts"], "readwrite", {
          durability: "strict",
        }),
        done = commit(tx);
      tx.objectStore("deletedAccounts").put({ userId });
      for (const name of ["batches", "files"]) {
        const request = tx.objectStore(name).index("owner").openCursor(userId);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }
      await done;
    } finally {
      db.close();
    }
  }
}
