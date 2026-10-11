import type { MediaAsset } from "@recalino/core/media";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PronunciationCache,
  type PronunciationRequest,
  pronunciationPollDelay,
} from "./pronunciation-cache";

const request: PronunciationRequest = {
  kind: "note_pronunciation",
  learningItemId: "word-a",
  expectedNotebookRevisionId: "revision-a",
};
const asset: MediaAsset = {
  id: "speech-a",
  sessionId: "session-a",
  kind: "tts",
  state: "ready",
  objectId: "object-a",
  mimeType: "audio/wav",
  sourceId: null,
  synthetic: true,
  exportAllowed: true,
  lastError: null,
  createdAt: "2026-10-11T12:00:00Z",
};
const now = Date.parse("2026-10-11T12:00:00Z");
const playback = {
  url: "https://audio.example/speech-a?signature=signed",
  validUntil: new Date(now + 60_000).toISOString(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe("reader-scoped pronunciation cache", () => {
  it("reuses a signed pronunciation and its receipt when the reader returns from B to A", () => {
    const cache = new PronunciationCache("reader");
    const first = cache.entry("session-a", request, "wear and tear");
    first.operation.current = { payload: JSON.stringify(request), key: "same-operation" };
    cache.asset(first, { ...asset, playback });
    cache.entry("session-a", { ...request, learningItemId: "word-b" }, "kit it out");
    const again = cache.entry("session-a", request, "wear and tear");
    expect(again).toBe(first);
    expect(again.operation.current?.key).toBe("same-operation");
    expect(again.asset).toEqual(asset);
    expect(cache.playback(again)).toEqual(playback);
  });

  it("requires the exact session, item, revision and spoken target", () => {
    const cache = new PronunciationCache("reader");
    const first = cache.entry("session-a", request, "wear and tear");
    cache.asset(first, { ...asset, playback });
    const changed = [
      cache.entry("session-b", request, "wear and tear"),
      cache.entry("session-a", { ...request, learningItemId: "word-b" }, "wear and tear"),
      cache.entry(
        "session-a",
        { ...request, expectedNotebookRevisionId: "revision-b" },
        "wear and tear",
      ),
      cache.entry("session-a", request, "Wear and tear"),
    ];
    for (const entry of changed) {
      expect(entry).not.toBe(first);
      expect(entry.asset).toBeNull();
      expect(cache.playback(entry)).toBeNull();
    }
  });

  it("does not depend on request property order or share memory between reader instances", () => {
    const cache = new PronunciationCache("reader");
    const first = cache.entry("session-a", request, "wear and tear");
    expect(
      cache.entry(
        "session-a",
        {
          expectedNotebookRevisionId: "revision-a",
          learningItemId: "word-a",
          kind: "note_pronunciation",
        },
        "wear and tear",
      ),
    ).toBe(first);
    const otherReader = new PronunciationCache("reader");
    expect(otherReader.entry("session-a", request, "wear and tear")).not.toBe(first);
  });

  it("keeps card content versions and note requests in separate entries", () => {
    const cache = new PronunciationCache("player");
    const card: PronunciationRequest = {
      kind: "pronunciation",
      cardId: "word-a",
      expectedContentVersion: 1,
    };
    const first = cache.entry("session-a", card, "wear and tear");
    expect(
      cache.entry("session-a", { ...card, expectedContentVersion: 2 }, "wear and tear"),
    ).not.toBe(first);
    expect(cache.entry("session-a", request, "wear and tear")).not.toBe(first);
  });

  it("expires only the link before its signature deadline, preserving the paid asset and operation", () => {
    const cache = new PronunciationCache("reader");
    const entry = cache.entry("session-a", request, "wear and tear");
    entry.operation.current = { payload: JSON.stringify(request), key: "same-operation" };
    cache.asset(entry, { ...asset, playback });
    vi.setSystemTime(now + 49_999);
    expect(cache.playback(entry)).toEqual(playback);
    vi.setSystemTime(now + 50_000);
    expect(cache.playback(entry)).toBeNull();
    expect(entry.asset).toEqual(asset);
    expect(entry.operation.current?.key).toBe("same-operation");
  });

  it.each([undefined, "invalid", new Date(now - 1).toISOString()])(
    "does not cache a signed URL with an untrusted or expired deadline: %s",
    (validUntil) => {
      const cache = new PronunciationCache("reader");
      const entry = cache.entry("session-a", request, "wear and tear");
      cache.savePlayback(entry, { url: playback.url, validUntil });
      expect(cache.playback(entry)).toBeNull();
    },
  );

  it("clears a playback failure without reusing the failed inline URL or losing its asset", () => {
    const cache = new PronunciationCache("reader");
    const entry = cache.entry("session-a", request, "wear and tear");
    entry.operation.current = { payload: JSON.stringify(request), key: "same-operation" };
    cache.asset(entry, { ...asset, playback });
    cache.playbackFailed(entry);
    expect(cache.playback(entry)).toBeNull();
    expect(entry.asset).toEqual(asset);
    expect(entry.asset).not.toHaveProperty("playback");
    expect(entry.operation.current?.key).toBe("same-operation");
    cache.savePlayback(entry, { ...playback, url: "https://audio.example/fresh" });
    expect(cache.playback(entry)?.url).toBe("https://audio.example/fresh");
  });

  it("retains pending operation identity after a player is replaced, but resets terminal generation failures", () => {
    const cache = new PronunciationCache("reader");
    const first = cache.entry("session-a", request, "wear and tear");
    first.operation.current = { payload: JSON.stringify(request), key: "original-request" };
    cache.asset(first, { ...asset, state: "processing" });
    const remounted = cache.entry("session-a", request, "wear and tear");
    expect(remounted.operation.current?.key).toBe("original-request");
    expect(remounted.asset?.state).toBe("processing");
    cache.generationFailed(remounted);
    expect(remounted).toEqual({ operation: { current: null }, asset: null, playback: null });
  });

  it("retains only 32 recently used targets and evicts the least recently used entry", () => {
    const cache = new PronunciationCache("reader");
    const first = cache.entry("session-a", request, "word-0");
    const second = cache.entry("session-a", request, "word-1");
    for (let index = 2; index < 32; index++) cache.entry("session-a", request, `word-${index}`);
    expect(cache.entry("session-a", request, "word-0")).toBe(first);
    cache.entry("session-a", request, "word-32");
    expect(cache.entry("session-a", request, "word-0")).toBe(first);
    expect(cache.entry("session-a", request, "word-1")).not.toBe(second);
  });

  it("polls quickly only for the first two checks, then returns to one-second intervals", () => {
    expect([0, 1, 2, 3, 100].map(pronunciationPollDelay)).toEqual([250, 500, 1000, 1000, 1000]);
  });
});
