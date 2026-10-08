import { calculateFileHashes, type FileHashes } from "./file-hashes-core";

export { calculateFileHashes, type FileHashes } from "./file-hashes-core";

/** Hash outside the UI thread. A worker never owns network transport or credentials. */
export async function prepareFileHashes(
  file: Blob,
  partBytes: number,
  includeParts: boolean,
  signal?: AbortSignal,
): Promise<FileHashes> {
  signal?.throwIfAborted();
  if (typeof Worker === "undefined") return calculateFileHashes(file, partBytes, includeParts);
  const worker = new Worker(new URL("./file-hash-worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<FileHashes>((resolve, reject) => {
      const cancel = () => finish(() => reject(signal?.reason));
      const timer = setTimeout(
        () => finish(() => reject(new Error("File checking took too long. Retry this file."))),
        120_000,
      );
      const finish = (effect: () => void) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        effect();
      };
      worker.onmessage = (event: MessageEvent<{ result?: FileHashes; error?: string }>) =>
        finish(() =>
          event.data.result
            ? resolve(event.data.result)
            : reject(new Error(event.data.error ?? "File checking failed.")),
        );
      worker.onerror = () =>
        finish(() => reject(new Error("File checking failed. Retry this file.")));
      signal?.addEventListener("abort", cancel, { once: true });
      worker.postMessage({ file, partBytes, includeParts });
    });
  } finally {
    worker.terminate();
  }
}
