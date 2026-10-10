"use client";
import type { VoiceAnalysisView } from "@recalino/core/voice-contracts";
import { useEffect, useRef, useState } from "react";
import { Banner } from "../components/Feedback";
import { WarningCircle } from "../icons";
import { pendingCopy } from "../pending-copy";
import { IndexedRecordingStore } from "../recording/store";
import { strings } from "../strings";
import { prepareFileHashes } from "../workspace/file-hashes";
import { Button, Status } from "../workspace/primitives";
import { RelinkError, relinkOriginalRecording } from "./relink-original";
import styles from "./Voice.module.css";
import type { LocalAudioState } from "./VoiceClips";
import { voiceCopy } from "./voice-copy";

const copy = voiceCopy.playback;
// Parts are not needed to compare one whole-file checksum; any positive size is valid.
const HASH_PART_BYTES = 8 * 1024 * 1024;

function relinkMessage(error: unknown): string {
  if (!(error instanceof RelinkError)) return copy.checkFailed;
  switch (error.code) {
    case "size_mismatch":
    case "content_mismatch":
      return copy.notOriginal;
    case "no_checksum":
      return copy.noChecksum;
    case "recording_active":
      return copy.active;
    case "storage_full":
      return copy.storageFull;
    default:
      return copy.saveFailed;
  }
}

/**
 * Explains why excerpts cannot play here and, when the original is missing or incomplete, lets
 * the learner re-attach it on this device. Nothing is uploaded and no class processing starts.
 */
export function OriginalRecovery({
  userId,
  sessionId,
  sourceId,
  source,
  state,
  disabled,
  onChanged,
}: {
  userId: string;
  sessionId: string;
  sourceId: string;
  source: VoiceAnalysisView["source"];
  state: LocalAudioState;
  disabled: boolean;
  /** `linked` is true when a verified original was just attached on this device. */
  onChanged: (linked: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const wasChecking = useRef(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // The Select and Cancel buttons replace each other; keep keyboard focus on whichever is shown.
  useEffect(() => {
    if (checking === wasChecking.current) return;
    wasChecking.current = checking;
    root.current
      ?.querySelector<HTMLButtonElement>(checking ? "[data-relink=cancel]" : "[data-relink=select]")
      ?.focus();
  }, [checking]);
  async function relink(file: File) {
    if (!source) return;
    const controller = new AbortController();
    abort.current = controller;
    setChecking(true);
    setMessage(null);
    const work = () =>
      relinkOriginalRecording(
        {
          store: new IndexedRecordingStore(),
          hash: async (blob, signal) =>
            (await prepareFileHashes(blob, HASH_PART_BYTES, false, signal)).sha256,
        },
        {
          userId,
          expected: {
            sourceId,
            sha256: source.sha256,
            sizeBytes: source.sizeBytes,
            mimeType: source.mimeType,
            durationMs: source.durationMs,
          },
          file,
          signal: controller.signal,
        },
      );
    try {
      // Same lock as automatic learning, so a pending transfer never reads a half-written copy.
      // Waiting for it can be cancelled, since a transfer may hold it for a long time.
      const name = `recalino-learning:${userId}:${sessionId}`;
      if (navigator.locks) await navigator.locks.request(name, { signal: controller.signal }, work);
      else await work();
      setMessage({ text: copy.linked, error: false });
      onChanged(true);
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? { text: copy.cancelled, error: false }
          : { text: relinkMessage(error), error: true },
      );
    } finally {
      if (abort.current === controller) abort.current = null;
      setChecking(false);
    }
  }
  if (state === "loading" || state === "playable")
    return message && !message.error ? <Status tone="success">{message.text}</Status> : null;
  const verifiable = Boolean(source && /^[a-f0-9]{64}$/.test(source.sha256) && source.sizeBytes);
  const reason =
    state === "unreadable"
      ? copy.unreadable
      : state === "missing"
        ? verifiable
          ? copy.missingDetail
          : copy.noChecksum
        : verifiable
          ? copy.incomplete
          : `${copy.incomplete} ${copy.noChecksum}`;
  // A warning, not a hint: confirming waits on this step (D55), so it carries the next action.
  return (
    <div ref={root} className={styles.recovery}>
      <Banner
        tone="warning"
        icon={WarningCircle}
        title={state === "missing" ? "The original audio isn't on this device." : undefined}
        action={
          state === "unreadable" ? (
            <Button disabled={disabled} onClick={() => onChanged(false)}>
              {strings.common.tryAgain}
            </Button>
          ) : !verifiable ? null : checking ? (
            <Status>
              {copy.checking}
              <Button secondary data-relink="cancel" onClick={() => abort.current?.abort()}>
                {copy.cancel}
              </Button>
            </Status>
          ) : (
            <Button data-relink="select" disabled={disabled} onClick={() => input.current?.click()}>
              {copy.select}
            </Button>
          )
        }
      >
        {reason} {pendingCopy.voice.playback.listenFirst}
      </Banner>
      {state === "unreadable" ? null : (
        <input
          ref={input}
          type="file"
          hidden
          aria-label={copy.select}
          accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg"
          disabled={disabled || checking || !verifiable}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void relink(file);
          }}
        />
      )}
      {message ? <Status tone={message.error ? "error" : "neutral"}>{message.text}</Status> : null}
    </div>
  );
}
