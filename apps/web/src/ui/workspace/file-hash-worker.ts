import { calculateFileHashes } from "./file-hashes-core";

self.onmessage = async (
  event: MessageEvent<{ file: Blob; partBytes: number; includeParts: boolean }>,
) => {
  try {
    const { file, partBytes, includeParts } = event.data;
    self.postMessage({ result: await calculateFileHashes(file, partBytes, includeParts) });
  } catch {
    self.postMessage({ error: "This file could not be checked on your device. Retry it." });
  }
};
