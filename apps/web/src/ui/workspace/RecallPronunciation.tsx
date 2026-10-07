"use client";
import type { MediaAsset } from "@recalino/core/media";
import { useEffect, useRef, useState } from "react";
import { requestKey, WorkspaceRequestError, workspaceRequest } from "./api";
import { Actions, Button, Status } from "./primitives";

function waitForSpeech(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 1000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Mounted only after reveal; a card/set change disposes both requests and playback. */
export function RecallPronunciation({
  cardId,
  contentVersion,
  sessionId,
  target,
}: {
  cardId: string;
  contentVersion: number;
  sessionId: string;
  target: string;
}) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const disposed = useRef(false);
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      active.current?.abort();
      audio.current?.pause();
    };
  }, []);
  useEffect(() => {
    const player = audio.current;
    if (!url || !player) return;
    let current = true;
    void player.play().catch(() => {
      if (current) setMessage("Pronunciation is ready. Press Play to listen.");
    });
    return () => {
      current = false;
      player.pause();
    };
  }, [url]);

  async function hear() {
    if (active.current) return;
    if (url && audio.current) {
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => {
        if (!disposed.current) setMessage("Pronunciation is ready. Press Play to listen.");
      });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setProblem("");
    setMessage("Preparing pronunciation… You can keep reviewing.");
    const body = { kind: "pronunciation", cardId, expectedContentVersion: contentVersion };
    try {
      let asset = await workspaceRequest<MediaAsset>(
        `/api/classes/${sessionId}/media`,
        "POST",
        body,
        requestKey(operation, body),
        { signal: controller.signal },
      );
      const deadline = Date.now() + 120000;
      while (asset.state === "queued" || asset.state === "processing") {
        if (Date.now() >= deadline)
          throw new Error("Pronunciation is still being prepared. Try again shortly.");
        await waitForSpeech(controller.signal);
        asset = await workspaceRequest<MediaAsset>(
          `/api/media/${asset.id}`,
          "GET",
          undefined,
          undefined,
          { signal: controller.signal },
        );
      }
      if (asset.state === "needs_input")
        throw new Error(
          "Pronunciation is unavailable right now. Please contact support; you can keep reviewing.",
        );
      if (asset.state !== "ready" || !asset.mimeType?.startsWith("audio/")) {
        operation.current = null;
        throw new Error("Pronunciation could not be prepared. Try again.");
      }
      const link = await workspaceRequest<{ url: string }>(
        `/api/media/${asset.id}/read`,
        "GET",
        undefined,
        undefined,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setUrl(link.url);
      setMessage("Synthetic British pronunciation");
    } catch (failure) {
      if (controller.signal.aborted) return;
      const reasons =
        failure instanceof WorkspaceRequestError ? Object.values(failure.fields ?? {}).flat() : [];
      setMessage("");
      setProblem(
        reasons.includes("card_changed")
          ? "This card changed. Reload review to hear its current pronunciation."
          : failure instanceof WorkspaceRequestError && failure.code === "conflict"
            ? "Another task is running for this class. Try again shortly; you can keep reviewing."
            : reasons.some((reason) =>
                  [
                    "not_configured",
                    "pronunciation_not_configured",
                    "configuration_unavailable",
                  ].includes(reason),
                )
              ? "Pronunciation is not configured yet. You can keep reviewing."
              : failure instanceof Error
                ? failure.message
                : "Pronunciation is unavailable. Try again.",
      );
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <div className="preview-stack">
      <Actions>
        <Button secondary disabled={busy} aria-busy={busy} onClick={() => void hear()}>
          {busy
            ? "Preparing pronunciation…"
            : problem
              ? "Retry pronunciation"
              : "Hear pronunciation"}
        </Button>
      </Actions>
      {message && <Status>{message}</Status>}
      {problem && <Status tone="error">{problem}</Status>}
      {url && (
        <audio
          ref={audio}
          controls
          src={url}
          aria-label={`Pronunciation of ${target}`}
          onError={() => {
            setUrl("");
            setMessage("");
            setProblem("Pronunciation could not be played. Try again.");
          }}
        >
          <track kind="captions" />
          Audio playback is unavailable.
        </audio>
      )}
    </div>
  );
}
