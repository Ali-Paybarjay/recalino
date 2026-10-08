"use client";
import type { VoiceAnalysisView } from "@recalino/core/voice-contracts";
import { useEffect, useRef, useState } from "react";
import { pendingCopy } from "../pending-copy";
import { IndexedRecordingStore } from "../recording/store";
import { strings } from "../strings";
import { prepareFileHashes } from "../workspace/file-hashes";
import { Actions, Button, Status } from "../workspace/primitives";
import { RelinkError, relinkOriginalRecording } from "./relink-original";
import type { LocalAudioState } from "./VoiceClips";

const copy = pendingCopy.voice.playback;
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
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
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
      const name = `recalino-learning:${userId}:${sessionId}`;
      if (navigator.locks) await navigator.locks.request(name, work);
      else await work();
      setMessage({ text: copy.linked, error: false });
      onChanged();
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
  if (state === "unreadable")
    return (
      <Status>
        {copy.unreadable}
        <Button secondary disabled={disabled} onClick={onChanged}>
          {strings.common.tryAgain}
        </Button>
      </Status>
    );
  const verifiable = Boolean(source && /^[a-f0-9]{64}$/.test(source.sha256) && source.sizeBytes);
  return (
    <div>
      {state === "missing" ? (
        <>
          <p className="preview-muted">The original audio isn't on this device.</p>
          {verifiable ? <p className="preview-muted">{copy.missingDetail}</p> : null}
        </>
      ) : (
        <p className="preview-muted">{copy.incomplete}</p>
      )}
      {!verifiable ? (
        <p className="preview-muted">{copy.noChecksum}</p>
      ) : checking ? (
        <Status>
          {copy.checking}
          <Button secondary onClick={() => abort.current?.abort()}>
            {copy.cancel}
          </Button>
        </Status>
      ) : (
        <Actions>
          <Button secondary disabled={disabled} onClick={() => input.current?.click()}>
            {copy.select}
          </Button>
        </Actions>
      )}
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
      {message ? <Status tone={message.error ? "error" : "neutral"}>{message.text}</Status> : null}
    </div>
  );
}
