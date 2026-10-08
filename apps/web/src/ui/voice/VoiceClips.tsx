"use client";
import type { VoiceCandidate } from "@recalino/core/voice-contracts";
import { useEffect, useRef, useState } from "react";
import { IndexedRecordingStore } from "../recording/store";
import { Button, Status } from "../workspace/primitives";
import styles from "./Voice.module.css";

export function useLocalVoiceAudio(userId: string, sourceId: string) {
  const [audio, setAudio] = useState<{ url: string | null; loading: boolean }>({
    url: null,
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setAudio({ url: null, loading: true });
    const store = new IndexedRecordingStore();
    void store
      .list(userId)
      .then(async (rows) => {
        const row = rows.find((item) => (item.sourceAssetId ?? item.id) === sourceId);
        if (!row) return null;
        return store.blob(userId, row.id);
      })
      .then((blob) => {
        if (cancelled) return;
        url = blob ? URL.createObjectURL(blob) : null;
        setAudio({ url, loading: false });
      })
      .catch(() => {
        if (!cancelled) setAudio({ url: null, loading: false });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [userId, sourceId]);
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
        setProblem(
          "This clip could not play. You can identify the speaker from the transcript or try again.",
        );
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
                  {Math.round((clip.endMs - clip.startMs) / 1000)} sec
                </span>
                <p dir="auto">{clip.text}</p>
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
          : [...new Set(candidate.lines.slice(0, 4))].map((line) => (
              <li className={styles.clip} key={line}>
                <p dir="auto">{line}</p>
              </li>
            ))}
      </ol>
      {problem ? <Status tone="error">{problem}</Status> : null}
    </>
  );
}
