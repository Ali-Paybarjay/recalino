import type { InputContract } from "@recalino/core/src";

/** Only confirmed run identity and public upload settings; originals remain in RecordingStore. */
export interface ManualAudioTransfer {
  userId: string;
  runId: string;
  sessionId: string;
  contract: InputContract;
  createdAt: number;
  phase: "queued" | "uploading" | "verifying" | "attention";
  message: string;
  problem: string | null;
}
export interface ManualAudioStore {
  put(transfer: ManualAudioTransfer, preserveExisting?: boolean): Promise<ManualAudioTransfer>;
  get(userId: string, runId: string): Promise<ManualAudioTransfer | null>;
  list(userId: string): Promise<ManualAudioTransfer[]>;
  remove(userId: string, runId: string): Promise<void>;
  removeAccount(userId: string): Promise<void>;
}
const name = "recalino-manual-audio-v1";
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("The saved audio transfer could not be updated."));
  });
}
export class IndexedManualAudioStore implements ManualAudioStore {
  private async open() {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore("transfers", { keyPath: ["userId", "runId"] })
        .createIndex("owner", "userId");
      request.result.createObjectStore("deletedAccounts", { keyPath: "userId" });
      request.result
        .createObjectStore("settledRuns", { keyPath: ["userId", "runId"] })
        .createIndex("owner", "userId");
    };
    return result(request);
  }
  async put(transfer: ManualAudioTransfer, preserveExisting = false) {
    const db = await this.open();
    try {
      const tx = db.transaction(["transfers", "deletedAccounts", "settledRuns"], "readwrite", {
        durability: "strict",
      });
      const done = committed(tx);
      let saved = transfer;
      const marker = tx.objectStore("deletedAccounts").get(transfer.userId);
      marker.onsuccess = () => {
        if (marker.result) {
          tx.abort();
          return;
        }
        const settled = tx.objectStore("settledRuns").get([transfer.userId, transfer.runId]);
        settled.onsuccess = () => {
          if (settled.result) {
            tx.abort();
            return;
          }
          const current = tx.objectStore("transfers").get([transfer.userId, transfer.runId]);
          current.onsuccess = () => {
            if (preserveExisting && current.result) saved = current.result;
            else tx.objectStore("transfers").put(transfer);
          };
        };
      };
      await done;
      return saved;
    } finally {
      db.close();
    }
  }
  async get(userId: string, runId: string) {
    const db = await this.open();
    try {
      return (
        ((await result(
          db.transaction("transfers").objectStore("transfers").get([userId, runId]),
        )) as ManualAudioTransfer | undefined) ?? null
      );
    } finally {
      db.close();
    }
  }
  async list(userId: string) {
    const db = await this.open();
    try {
      return (await result(
        db.transaction("transfers").objectStore("transfers").index("owner").getAll(userId),
      )) as ManualAudioTransfer[];
    } finally {
      db.close();
    }
  }
  async remove(userId: string, runId: string) {
    const db = await this.open();
    try {
      const tx = db.transaction(["transfers", "settledRuns"], "readwrite", {
          durability: "strict",
        }),
        done = committed(tx);
      tx.objectStore("settledRuns").put({ userId, runId });
      tx.objectStore("transfers").delete([userId, runId]);
      await done;
    } finally {
      db.close();
    }
  }
  async removeAccount(userId: string) {
    const db = await this.open();
    try {
      const tx = db.transaction(["transfers", "settledRuns", "deletedAccounts"], "readwrite", {
          durability: "strict",
        }),
        done = committed(tx);
      tx.objectStore("deletedAccounts").put({ userId });
      for (const name of ["transfers", "settledRuns"]) {
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
