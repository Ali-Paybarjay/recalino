"use client";
import type { PhotoQuality } from "./photo-quality";
import { assessPhotoBlob } from "./photo-quality-image";

/** A photo that is not judged within this time shows nothing. */
const WORKER_TIMEOUT_MS = 15_000;

/**
 * Judges a board photo on this device (D72). Runs in a Web Worker: on a 4× slowed CPU the
 * main-thread version took 60–250 ms. Browsers without workers or OffscreenCanvas judge it on
 * the main thread when idle. Never throws: any failure returns undefined and nothing is shown.
 */
export async function assessPhotoFile(blob: Blob): Promise<PhotoQuality | undefined> {
  try {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined")
      return await onMainThread(blob);
    const result = await inWorker(blob);
    return result === "unavailable" ? await onMainThread(blob) : result;
  } catch {
    return undefined;
  }
}

function inWorker(blob: Blob): Promise<PhotoQuality | undefined | "unavailable"> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./photo-quality-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return Promise.resolve("unavailable");
  }
  const started = performance.now();
  return new Promise<PhotoQuality | undefined | "unavailable">((resolve) => {
    const timer = setTimeout(() => finish(undefined), WORKER_TIMEOUT_MS);
    const finish = (value: PhotoQuality | undefined | "unavailable") => {
      clearTimeout(timer);
      worker.terminate();
      resolve(value);
    };
    worker.onmessage = (event: MessageEvent<{ quality?: PhotoQuality }>) => {
      // Wall time until the verdict, visible in performance tools; none of it is main-thread work.
      performance.measure("recalino:photo-quality:worker", { start: started });
      finish(event.data.quality);
    };
    worker.onerror = () => finish("unavailable");
    worker.postMessage({ blob });
  });
}

function onMainThread(blob: Blob): Promise<PhotoQuality | undefined> {
  return new Promise((resolve) => {
    const run = () => {
      const started = performance.now();
      void assessPhotoBlob(blob, (width, height) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas.getContext("2d", { willReadFrequently: true });
      })
        .then((quality) => {
          performance.measure("recalino:photo-quality:main", { start: started });
          resolve(quality);
        })
        .catch(() => resolve(undefined));
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 0);
  });
}

const results = new Map<string, Promise<PhotoQuality | undefined>>();

/** One assessment per local photo for this page; later renders reuse it. */
export function photoQuality(id: string, blob: Blob): Promise<PhotoQuality | undefined> {
  let result = results.get(id);
  if (!result) {
    result = assessPhotoFile(blob);
    results.set(id, result);
  }
  return result;
}

/** Drops the cached verdict of a photo removed from this device. */
export function forgetPhotoQuality(id: string) {
  results.delete(id);
}
