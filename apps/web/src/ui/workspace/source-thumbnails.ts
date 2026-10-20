import { useCallback, useEffect, useRef, useState } from "react";
import { IndexedRecordingStore } from "../recording/store";
import { workspaceRequest } from "./api";
import type { SourceRow } from "./source-types";

type Candidate = Pick<
  SourceRow,
  "kind" | "verifiedAt" | "originalDeletedAt" | "rejectionReason" | "uploadState"
>;

/**
 * Whether a material row shows a picture of its file (D106): only a verified photo whose original
 * is still kept. Audio never comes from the server (D29), and PDF, HTML and text keep their icon.
 */
export function showsThumbnail(source: Candidate): boolean {
  return (
    source.kind === "image" &&
    !!source.verifiedAt &&
    !source.originalDeletedAt &&
    !source.rejectionReason &&
    source.uploadState !== "rejected"
  );
}

export interface ThumbnailIo {
  /** The photos saved on this device, by their source asset id. */
  deviceCopies: () => Promise<ReadonlyMap<string, Blob>>;
  /** A short-lived private link to the original (GET /api/sources/{id}/read). */
  readLink: (assetId: string) => Promise<string>;
  objectUrl: (blob: Blob) => string;
  revoke: (url: string) => void;
  /** The pictures that are ready to show, by asset id. */
  changed: (pictures: ReadonlyMap<string, string>) => void;
}

type Entry = {
  url: string | null;
  local: boolean;
  loads: number;
  state: "queued" | "loading" | "ready" | "failed";
};

/** The first load, and one more after the picture fails to show (an expired link, say). */
const MAX_LOADS = 2;

/**
 * Loads each photo once per page visit, one at a time: the copy on this device first, otherwise a
 * private read link. Each read link takes the account lock and keeps the original readable a little
 * longer, so a page refresh never asks again (D106). Links live only in memory.
 */
export class ThumbnailLoader {
  private readonly entries = new Map<string, Entry>();
  private readonly dropped = new Set<string>();
  private readonly queue: string[] = [];
  private device: Promise<ReadonlyMap<string, Blob>> | null = null;
  private running = false;
  private closed = false;

  constructor(private readonly io: ThumbnailIo) {}

  /** The tile came into view. Asking again for the same photo does nothing. */
  request(assetId: string) {
    if (this.closed || this.dropped.has(assetId) || this.entries.has(assetId)) return;
    this.entries.set(assetId, { url: null, local: false, loads: 0, state: "queued" });
    this.enqueue(assetId);
  }

  /** The picture at `url` could not be shown: load it once more, then fall back to the icon. */
  failed(assetId: string, url: string) {
    const entry = this.entries.get(assetId);
    if (entry?.state !== "ready" || entry.url !== url) return;
    this.release(entry);
    entry.state = entry.loads < MAX_LOADS ? "queued" : "failed";
    this.publish();
    if (entry.state === "queued") this.enqueue(assetId);
  }

  /** The photo was removed or deleted: drop its picture at once and never load it again. */
  forget(assetId: string) {
    this.dropped.add(assetId);
    const entry = this.entries.get(assetId);
    if (!entry) return;
    this.release(entry);
    this.entries.delete(assetId);
    this.publish();
  }

  /** Keeps only the photos still listed; the others drop their picture. */
  keep(assetIds: ReadonlySet<string>) {
    let changed = false;
    for (const [assetId, entry] of this.entries) {
      if (assetIds.has(assetId)) continue;
      this.release(entry);
      this.entries.delete(assetId);
      changed = true;
    }
    if (changed) this.publish();
  }

  dispose() {
    this.closed = true;
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.queue.length = 0;
  }

  private enqueue(assetId: string) {
    this.queue.push(assetId);
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.closed && this.queue.length) {
        const assetId = this.queue.shift() as string;
        const entry = this.entries.get(assetId);
        if (entry?.state !== "queued") continue;
        entry.state = "loading";
        await this.load(assetId, entry);
        // Removed, deleted or left while it loaded: nothing may keep its picture.
        if (this.closed || this.entries.get(assetId) !== entry) {
          this.release(entry);
          continue;
        }
        this.publish();
      }
    } finally {
      this.running = false;
    }
  }

  private async load(assetId: string, entry: Entry) {
    entry.loads += 1;
    try {
      if (entry.loads === 1) {
        this.device ??= this.io.deviceCopies().catch(() => new Map<string, Blob>());
        const blob = (await this.device).get(assetId);
        if (blob) {
          entry.url = this.io.objectUrl(blob);
          entry.local = true;
          entry.state = "ready";
          return;
        }
      }
      entry.url = await this.io.readLink(assetId);
      entry.state = "ready";
    } catch {
      entry.state = "failed";
    }
  }

  private release(entry: Entry) {
    if (entry.local && entry.url) this.io.revoke(entry.url);
    entry.url = null;
    entry.local = false;
  }

  private publish() {
    if (this.closed) return;
    const pictures = new Map<string, string>();
    for (const [assetId, entry] of this.entries)
      if (entry.state === "ready" && entry.url) pictures.set(assetId, entry.url);
    this.io.changed(pictures);
  }
}

async function devicePhotos(userId: string): Promise<ReadonlyMap<string, Blob>> {
  const store = new IndexedRecordingStore();
  const copies = new Map<string, Blob>();
  for (const recording of await store.list(userId))
    for (const photo of await store.photos(userId, recording.id))
      if (photo.sourceAssetId) copies.set(photo.sourceAssetId, photo.blob);
  return copies;
}

/**
 * The photo thumbnails of the session material list. A tile registers with `tile(assetId)` and
 * loads when it scrolls into view; `failed` reports an `<img>` error and `forget` a removed photo.
 */
export function useSourceThumbnails(userId: string, sources: readonly SourceRow[]) {
  const [pictures, setPictures] = useState<ReadonlyMap<string, string>>(() => new Map());
  const loader = useRef<ThumbnailLoader | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  const tiles = useRef(new Map<string, Element>());
  const callbacks = useRef(new Map<string, (element: Element | null) => void>());
  useEffect(() => {
    const instance = new ThumbnailLoader({
      deviceCopies: () => devicePhotos(userId),
      readLink: async (assetId) =>
        (await workspaceRequest<{ url: string }>(`/api/sources/${assetId}/read`, "GET")).url,
      objectUrl: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
      changed: setPictures,
    });
    const elements = tiles.current;
    const watch =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              watch?.unobserve(entry.target);
              for (const [assetId, element] of elements)
                if (element === entry.target) instance.request(assetId);
            }
          })
        : null;
    loader.current = instance;
    observer.current = watch;
    for (const [assetId, element] of elements)
      if (watch) watch.observe(element);
      else instance.request(assetId);
    return () => {
      watch?.disconnect();
      observer.current = null;
      loader.current = null;
      instance.dispose();
      setPictures(new Map());
    };
  }, [userId]);
  const listed = sources
    .filter(showsThumbnail)
    .map((source) => source.assetId)
    .join(" ");
  useEffect(() => {
    loader.current?.keep(new Set(listed.split(" ").filter(Boolean)));
  }, [listed]);
  const tile = useCallback((assetId: string) => {
    let callback = callbacks.current.get(assetId);
    if (!callback) {
      callback = (element: Element | null) => {
        const previous = tiles.current.get(assetId);
        if (previous === element) return;
        if (previous) {
          observer.current?.unobserve(previous);
          tiles.current.delete(assetId);
        }
        if (!element) return;
        tiles.current.set(assetId, element);
        if (observer.current) observer.current.observe(element);
        else loader.current?.request(assetId);
      };
      callbacks.current.set(assetId, callback);
    }
    return callback;
  }, []);
  return {
    picture: (assetId: string) => pictures.get(assetId) ?? null,
    tile,
    failed: (assetId: string, url: string) => loader.current?.failed(assetId, url),
    forget: (assetId: string) => loader.current?.forget(assetId),
  };
}
