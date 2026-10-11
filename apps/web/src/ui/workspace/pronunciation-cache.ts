import type { MediaAsset } from "@recalino/core/media";

export type PronunciationRequest =
  | { kind: "pronunciation"; cardId: string; expectedContentVersion: number }
  | {
      kind: "note_pronunciation";
      learningItemId: string;
      expectedNotebookRevisionId: string;
    };

export interface PronunciationPlayback {
  url: string;
  validUntil?: string;
}

export type PronunciationAsset = MediaAsset & { playback?: PronunciationPlayback };

export interface PronunciationCacheEntry {
  operation: { current: { payload: string; key: string } | null };
  asset: MediaAsset | null;
  playback: PronunciationPlayback | null;
}

/** Leave enough time for a cached URL to reach the audio element before its signature expires. */
export function freshPronunciationPlayback(link: PronunciationPlayback, now = Date.now()) {
  return !!link.url && !!link.validUntil && Date.parse(link.validUntil) > now + 10_000;
}

export function pronunciationPollDelay(attempt: number) {
  return attempt === 0 ? 250 : attempt === 1 ? 500 : 1000;
}

/** In-memory only. A reader creates a new cache for each session and published revision. */
export class PronunciationCache {
  private readonly entries = new Map<string, PronunciationCacheEntry>();
  private readonly limit: number;

  constructor(
    private readonly scope: string,
    limit = 32,
  ) {
    this.limit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 32;
  }

  entry(sessionId: string, request: PronunciationRequest, target: string) {
    const identity =
      request.kind === "pronunciation"
        ? [request.kind, request.cardId, request.expectedContentVersion]
        : [request.kind, request.learningItemId, request.expectedNotebookRevisionId];
    const key = JSON.stringify([this.scope, sessionId, ...identity, target]);
    const entry = this.entries.get(key) ?? {
      operation: { current: null },
      asset: null,
      playback: null,
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return entry;
  }

  asset(entry: PronunciationCacheEntry, response: PronunciationAsset) {
    const { playback, ...asset } = response;
    // Do not retain another copy of a signed URL inside the asset. Explicit
    // playback failures must not resurrect that URL on the next click.
    entry.asset = asset;
    if (asset.state === "ready" && playback) this.savePlayback(entry, playback);
  }

  savePlayback(entry: PronunciationCacheEntry, link: PronunciationPlayback) {
    entry.playback = freshPronunciationPlayback(link) ? { ...link } : null;
  }

  playback(entry: PronunciationCacheEntry) {
    if (entry.playback && !freshPronunciationPlayback(entry.playback)) entry.playback = null;
    return entry.playback;
  }

  playbackFailed(entry: PronunciationCacheEntry) {
    entry.playback = null;
  }

  generationFailed(entry: PronunciationCacheEntry) {
    entry.asset = null;
    entry.operation.current = null;
    entry.playback = null;
  }
}
