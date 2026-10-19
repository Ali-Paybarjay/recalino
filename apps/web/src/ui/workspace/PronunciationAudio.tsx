"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SpeakerHigh } from "../icons";
import { requestKey, userMessage, WorkspaceRequestError, workspaceRequest } from "./api";
import styles from "./PronunciationAudio.module.css";
import {
  freshPronunciationPlayback,
  type PronunciationAsset,
  PronunciationCache,
  type PronunciationCacheEntry,
  type PronunciationPlayback,
  type PronunciationRequest,
  pronunciationPollDelay,
} from "./pronunciation-cache";

export type { PronunciationRequest } from "./pronunciation-cache";
export interface PronunciationState {
  busy: boolean;
  ready: boolean;
  problem: string;
  message: string;
}

function waitForSpeech(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function pronunciationProblem(failure: unknown): string {
  const reasons =
    failure instanceof WorkspaceRequestError ? Object.values(failure.fields ?? {}).flat() : [];
  if (reasons.includes("card_changed"))
    return "This card changed. Reload review to hear its current pronunciation.";
  if (reasons.includes("notebook_changed"))
    return "This notebook changed. Reload session notes to hear its current pronunciation.";
  if (reasons.includes("target_unavailable"))
    return "Pronunciation is unavailable for this item. You can keep studying.";
  if (failure instanceof WorkspaceRequestError && failure.code === "conflict")
    return "Another task is running for this session. Try again shortly; you can keep studying.";
  if (
    reasons.some((reason) =>
      ["not_configured", "pronunciation_not_configured", "configuration_unavailable"].includes(
        reason,
      ),
    )
  )
    return "Pronunciation is not configured yet. You can keep studying.";
  return userMessage(failure, "Pronunciation is unavailable. Try again.");
}

function pauseOtherStudyAudio(player: HTMLAudioElement) {
  // Listening attachments and inline players share a study Panel; other app audio stays alone.
  const panel = player.closest(".preview-panel");
  if (!panel) return;
  for (const other of panel.querySelectorAll("audio")) {
    if (other !== player) other.pause();
  }
}

/** Callers key by target/version: replacing the player cancels its request and playback. */
export function PronunciationAudio({
  sessionId,
  request,
  target,
  trigger = 0,
  showButton = true,
  onState,
  cache: sharedCache,
}: {
  sessionId: string;
  request: PronunciationRequest;
  target: string;
  trigger?: number;
  showButton?: boolean;
  onState?: (state: PronunciationState) => void;
  cache?: PronunciationCache;
}) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const [showControls, setShowControls] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const [localCache] = useState(() => new PronunciationCache("player", 1));
  const cache = sharedCache ?? localCache;
  const cacheEntry = useRef<PronunciationCacheEntry | null>(null);
  const playbackLink = useRef<PronunciationPlayback | null>(null);
  const active = useRef<AbortController | null>(null);
  const disposed = useRef(false);
  const playback = useRef(0);
  const notify = useRef(onState);
  const hearLatest = useRef<() => Promise<void>>(async () => {});
  const previousTrigger = useRef(0);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      active.current?.abort();
      active.current = null;
      previousTrigger.current = 0;
      playback.current += 1;
      audio.current?.pause();
    };
  }, []);

  const play = useCallback(async (player: HTMLAudioElement) => {
    const attempt = ++playback.current;
    try {
      pauseOtherStudyAudio(player);
      await player.play();
      if (disposed.current || playback.current !== attempt) return;
      setShowControls(false);
      setMessage("Synthetic British pronunciation");
    } catch {
      if (disposed.current || playback.current !== attempt) return;
      setShowControls(true);
      setMessage("Pronunciation is ready. Press Play to listen.");
    }
  }, []);

  useEffect(() => {
    const player = audio.current;
    if (!url || !player) return;
    void play(player);
    return () => {
      playback.current += 1;
      player.pause();
    };
  }, [url, play]);

  useEffect(() => {
    if (showControls && url)
      audio.current?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  }, [showControls, url]);

  async function hear() {
    if (active.current || disposed.current) return;
    const entry = cache.entry(sessionId, request, target);
    const sameEntry = cacheEntry.current === entry;
    cacheEntry.current = entry;
    if (
      sameEntry &&
      url &&
      audio.current &&
      (!playbackLink.current?.validUntil || freshPronunciationPlayback(playbackLink.current))
    ) {
      audio.current.currentTime = 0;
      await play(audio.current);
      return;
    }
    if (url) {
      playback.current += 1;
      audio.current?.pause();
      setUrl("");
    }
    const cachedLink = cache.playback(entry);
    if (cachedLink) {
      playbackLink.current = cachedLink;
      setProblem("");
      setShowControls(false);
      setUrl(cachedLink.url);
      setMessage("Synthetic British pronunciation");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setProblem("");
    setShowControls(false);
    setMessage("Preparing pronunciation… You can keep studying.");
    try {
      // A known asset survives read-link/playback failures; retry never creates new speech.
      let asset: PronunciationAsset = entry.asset
        ? entry.asset.state === "ready"
          ? entry.asset
          : await workspaceRequest<PronunciationAsset>(
              `/api/media/${entry.asset.id}?playback=1`,
              "GET",
              undefined,
              undefined,
              { signal: controller.signal },
            )
        : await workspaceRequest<PronunciationAsset>(
            `/api/classes/${sessionId}/media`,
            "POST",
            request,
            requestKey(entry.operation, request),
            { signal: controller.signal },
          );
      if (controller.signal.aborted) return;
      cache.asset(entry, asset);
      const deadline = Date.now() + 120000;
      let polls = 0;
      while (asset.state === "queued" || asset.state === "processing") {
        if (Date.now() >= deadline)
          throw new Error("Pronunciation is still being prepared. Try again shortly.");
        await waitForSpeech(controller.signal, pronunciationPollDelay(polls++));
        asset = await workspaceRequest<PronunciationAsset>(
          `/api/media/${asset.id}?playback=1`,
          "GET",
          undefined,
          undefined,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        cache.asset(entry, asset);
      }
      if (asset.state === "needs_input")
        throw new Error(
          "Pronunciation is unavailable right now. Please contact support; you can keep studying.",
        );
      if (asset.state !== "ready" || !asset.mimeType?.startsWith("audio/")) {
        cache.generationFailed(entry);
        throw new Error("Pronunciation could not be prepared. Try again.");
      }
      const link =
        cache.playback(entry) ??
        (await workspaceRequest<PronunciationPlayback>(
          `/api/media/${asset.id}/read`,
          "GET",
          undefined,
          undefined,
          { signal: controller.signal },
        ));
      if (controller.signal.aborted) return;
      cache.savePlayback(entry, link);
      playbackLink.current = link;
      setUrl(link.url);
      setMessage("Synthetic British pronunciation");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setMessage("");
      setProblem(pronunciationProblem(failure));
    } finally {
      if (active.current === controller && !controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    hearLatest.current = hear;
  });
  useEffect(() => {
    if (trigger <= 0 || trigger === previousTrigger.current) return;
    let current = true;
    // StrictMode can replay mount effects; defer until its cancelled setup is discarded.
    queueMicrotask(() => {
      if (!current || disposed.current) return;
      previousTrigger.current = trigger;
      void hearLatest.current();
    });
    return () => {
      current = false;
    };
  }, [trigger]);
  useEffect(() => {
    notify.current = onState;
  }, [onState]);
  useEffect(() => {
    notify.current?.({ busy, ready: !!url, problem, message });
  }, [busy, url, problem, message]);

  const label = `${busy ? "Preparing pronunciation" : problem ? "Retry pronunciation" : "Hear pronunciation"} of ${target}`;
  return (
    <span className={styles.player}>
      {showButton && (
        <button
          type="button"
          className={styles.speaker}
          disabled={busy}
          aria-busy={busy}
          aria-label={label}
          title={label}
          onClick={() => void hear()}
        >
          <SpeakerHigh size={20} aria-hidden="true" />
        </button>
      )}
      {message && (
        <span className={styles.message} role="status">
          {message}
        </span>
      )}
      {problem && (
        <span className={styles.message} role="alert">
          {problem}
        </span>
      )}
      {url && showControls && !showButton && (
        <span className={styles.message} lang="en" dir="ltr">
          Pronunciation of {target}
        </span>
      )}
      {url && (
        <audio
          ref={audio}
          controls={showControls}
          hidden={!showControls}
          src={url}
          aria-label={`Pronunciation of ${target}`}
          onPlay={(event) => pauseOtherStudyAudio(event.currentTarget)}
          onError={() => {
            playback.current += 1;
            if (cacheEntry.current) cache.playbackFailed(cacheEntry.current);
            playbackLink.current = null;
            setUrl("");
            setShowControls(false);
            setMessage("");
            setProblem("Pronunciation could not be played. Try again.");
          }}
        >
          <track kind="captions" />
          Audio playback is unavailable.
        </audio>
      )}
    </span>
  );
}
