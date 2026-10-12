import type { Page } from "@playwright/test";

/**
 * Keeps a silent synthetic original (a test asset, no person recorded) of each listed class
 * source on this device, owned by the given account, then reloads. A voice is confirmed by
 * listening (D55), so confirming needs a playable original. Call it after a source has said its
 * original audio isn't on this device: by then the page has created the device store.
 */
export async function keepOriginalsOnDevice(page: Page, owners: Record<number, string>) {
  await page.evaluate(async (entries) => {
    const request = indexedDB.open("recalino-recordings-v1", 3);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sampleRate = 8000,
      bytes = sampleRate * 40 * 2,
      data = new ArrayBuffer(44 + bytes),
      header = new DataView(data);
    function ascii(offset: number, value: string) {
      for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
    }
    ascii(0, "RIFF");
    header.setUint32(4, 36 + bytes, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, 1, true);
    header.setUint32(24, sampleRate, true);
    header.setUint32(28, sampleRate * 2, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    ascii(36, "data");
    header.setUint32(40, bytes, true);
    const blob = new Blob([data], { type: "audio/wav" });
    const transaction = db.transaction(["recordings", "chunks"], "readwrite");
    for (const [source, userId] of entries) {
      const id = `30000000-0000-4000-8000-00000000000${source}`;
      transaction.objectStore("recordings").put({
        id,
        userId,
        sourceAssetId: `20000000-0000-4000-8000-00000000000${source}`,
        sessionId: null,
        mimeType: "audio/wav",
        status: "saved",
        createdAt: "2026-10-06T12:00:00.000Z",
        updatedAt: "2026-10-06T12:00:00.000Z",
        activeMs: 40000,
        chunks: 1,
        bytes: blob.size,
        creationKey: id,
      });
      transaction.objectStore("chunks").put({ userId, recordingId: id, sequence: 0, blob });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, Object.entries(owners));
  await page.reload();
}
