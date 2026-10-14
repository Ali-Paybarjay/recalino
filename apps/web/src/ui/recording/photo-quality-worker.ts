import { assessPhotoBlob } from "./photo-quality-image";

// D72: judges one board photo outside the UI thread. No network, no storage; numbers only back.
self.onmessage = async (event: MessageEvent<{ blob: Blob }>) => {
  const quality = await assessPhotoBlob(event.data.blob, (width, height) =>
    new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true }),
  ).catch(() => undefined);
  self.postMessage({ quality });
};
