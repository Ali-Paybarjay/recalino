"use client";
import type { VoiceCandidate } from "@recalino/core/voice-contracts";
import { useEffect, useRef, useState } from "react";
import { pendingCopy } from "../pending-copy";
import {
  IndexedRecordingStore,
  LocalRecordingIncompleteError,
  LocalRecordingMissingError,
} from "../recording/store";
import { Button, Status } from "../workspace/primitives";
import { localOriginalRow } from "./relink-original";
import styles from "./Voice.module.css";

/**
 * Where the original of one class source stands on this device. A store that cannot be read,
 * an incomplete saved copy and a missing copy need different recoveries, so they stay apart.
 */
export type LocalAudioState = "loading" | "playable" | "missing" | "incomplete" | "unreadable";

export function useLocalVoiceAudio(userId: string, sourceId: string, revision = 0) {
  const [audio, setAudio] = useState<{ url: string | null; state: LocalAudioState }>({
    url: null,
    state: "loading",
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision re-reads the store after a relink.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setAudio({ url: null, state: "loading" });
    const store = new IndexedRecordingStore();
    const settle = (state: LocalAudioState, blob?: Blob) => {
      if (cancelled) return;
      url = blob ? URL.createObjectURL(blob) : null;
      setAudio({ url, state });
    };
    void store
      .list(userId)
      .then(async (rows) => {
        const row = localOriginalRow(rows, sourceId);
        if (!row) return settle("missing");
        try {
          const blob = await store.blob(userId, row.id);
          settle(blob.size ? "playable" : "incomplete", blob.size ? blob : undefined);
        } catch (error) {
          settle(
            error instanceof LocalRecordingIncompleteError
              ? "incomplete"
              : error instanceof LocalRecordingMissingError
                ? "missing"
                : "unreadable",
          );
        }
      })
      .catch(() => settle("unreadable"));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [userId, sourceId, revision]);
  return audio;
}

function timestamp(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
}

/** One bounded player per candidate; its parent pauses other candidates and sources. */
export function VoiceClips({
  candidate,
  audioUrl,
  limit = 3,
  onPlayback,
}: {
  candidate: VoiceCandidate;
  audioUrl: string | null;
  limit?: number;
  onPlayback: (element: HTMLAudioElement) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const active = useRef<VoiceCandidate["clips"][number] | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [problem, setProblem] = useState("");
  const generation = useRef(0);
  function stop() {
    generation.current++;
    audio.current?.pause();
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    setPlaying(null);
  }
  useEffect(() => {
    const element = audio.current;
    return () => {
      generation.current++;
      element?.pause();
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);
  async function play(index: number) {
    const element = audio.current,
      clip = candidate.clips[index];
    if (!element || !clip) return;
    if (playing === index) {
      stop();
      return;
    }
    stop();
    const request = generation.current;
    setProblem("");
    active.current = clip;
    onPlayback(element);
    try {
      element.currentTime = clip.startMs / 1000;
      await element.play();
      if (request !== generation.current) {
        element.pause();
        return;
      }
      setPlaying(index);
      timeout.current = setTimeout(stop, Math.max(0, clip.endMs - element.currentTime * 1000));
    } catch {
      if (request === generation.current) {
        setProblem(pendingCopy.voice.playback.clipFailed);
        setPlaying(null);
      }
    }
  }
  const clips = candidate.clips.slice(0, limit);
  return (
    <>
      {audioUrl && clips.length ? (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: Every clip has its saved transcript immediately below. */}
          <audio
            ref={audio}
            src={audioUrl}
            preload="metadata"
            onPause={() => {
              if (timeout.current) clearTimeout(timeout.current);
              setPlaying(null);
            }}
            onEnded={() => stop()}
            onTimeUpdate={() => {
              const element = audio.current,
                clip = active.current;
              if (element && clip && element.currentTime * 1000 >= clip.endMs) stop();
            }}
          />
        </>
      ) : null}
      <ol className={styles.clips} aria-label={`${candidate.label} excerpts`}>
        {clips.length
          ? clips.map((clip, index) => (
              <li key={`${clip.startMs}-${clip.endMs}`} className={styles.clip}>
                <span className={styles.clipLabel}>
                  Excerpt {index + 1} · {timestamp(clip.startMs)} ·{" "}
                  {/* A line under half a second still lasts; it never reads "0 sec". */}
                  {Math.max(1, Math.round((clip.endMs - clip.startMs) / 1000))} sec
                </span>
                {clip.text ? <p dir="auto">{clip.text}</p> : null}
                {audioUrl ? (
                  <Button
                    secondary
                    onClick={() => void play(index)}
                    aria-label={`${playing === index ? "Pause" : "Play"} ${candidate.label} excerpt ${index + 1}`}
                  >
                    {playing === index ? "Pause clip" : "Play clip"}
                  </Button>
                ) : null}
              </li>
            ))
          : null}
        {/* Listening-only excerpts carry no text; the saved lines still identify the voice. */}
        {!clips.some((clip) => clip.text)
          ? [...new Set(candidate.lines.slice(0, 4))].map((line) => (
              <li className={styles.clip} key={line}>
                <p dir="auto">{line}</p>
              </li>
            ))
          : null}
      </ol>
      {problem ? <Status tone="error">{problem}</Status> : null}
    </>
  );
}
