"use client";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workspaceRequest } from "../workspace/api";
import { Actions, Button, Panel, Status } from "../workspace/primitives";
import { uploadWithConfirmation } from "../workspace/upload";
import styles from "./Recording.module.css";
import { ensureRecordingClass, RecordLauncher, useRecording } from "./RecordingProvider";
import type { LocalPhoto, Recording } from "./store";

function duration(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function digest(blob: Blob) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}

export function RecordingView({ sessionId }: { sessionId?: string }) {
  const { controller, state, store, userId } = useRecording();
  const [rows, setRows] = useState<Recording[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ id: string; url: string } | null>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const captureAnchor = useRef<{ offsetMs: number; captureState: "recording" | "paused" } | null>(
    null,
  );
  const reload = useCallback(async () => {
    try {
      const next = (await store.list(userId)).filter(
        (row) => !sessionId || row.sessionId === sessionId,
      );
      setRows(next);
      setPhotos((await Promise.all(next.map((row) => store.photos(userId, row.id)))).flat());
    } catch {
      setError("Local recordings could not be opened. Keep this device's site data and try again.");
    }
  }, [store, userId, sessionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: finishing capture refreshes manifests after the durable final chunk commit.
  useEffect(() => {
    void reload();
  }, [reload, state.phase]);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(controller.elapsed()), 250);
    return () => clearInterval(timer);
  }, [controller]);
  useEffect(
    () => () => {
      if (player) URL.revokeObjectURL(player.url);
    },
    [player],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (["recording", "paused", "saving"].includes(controller.state.phase)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [controller]);
  async function operation(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await action();
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The recording could not be opened.");
    } finally {
      setBusy(null);
    }
  }
  async function attach(row: Recording) {
    const blob = await store.blob(userId, row.id);
    if (!blob.size) throw new Error("No audio was saved in this recording.");
    const classId = await ensureRecordingClass(row, store);
    const current = await store.get(userId, row.id);
    if (!current) throw new Error("Recording is missing.");
    if (current.sourceAssetId) return;
    const result = await workspaceRequest<{ assetId: string }>(
      "/api/recordings",
      "POST",
      {
        sessionId: classId,
        kind: "audio",
        mimeType: row.mimeType.split(";")[0],
        sizeBytes: blob.size,
        sha256: await digest(blob),
        displayName: `Class recording ${row.createdAt.slice(0, 10)}`,
        durationMs: Math.max(1, Math.ceil(row.activeMs) + 1000),
        parts: [],
      },
      `recorded-source:${row.id}`,
    );
    await store.put({ ...current, sourceAssetId: result.assetId });
  }
  async function savePhoto(file: File) {
    const recording = controller.state.recording;
    if (!recording || !captureAnchor.current) return;
    const photo: LocalPhoto = {
      id: crypto.randomUUID(),
      userId,
      recordingId: recording.id,
      ...captureAnchor.current,
      blob: file,
      createdAt: new Date().toISOString(),
      sourceAssetId: null,
    };
    await store.savePhoto(photo);
    await reload();
  }
  async function attachPhoto(photo: LocalPhoto) {
    const row = await store.get(userId, photo.recordingId);
    if (!row) throw new Error("Recording is missing.");
    await attach(row);
    const recording = await store.get(userId, row.id);
    if (!recording?.sourceAssetId || !recording.sessionId)
      throw new Error("Add the recording to its class first.");
    const config = await workspaceRequest<{ contract: InputContract; noticeAccepted: boolean }>(
      "/api/sources/contract",
      "GET",
    );
    if (!config.noticeAccepted)
      throw new Error(
        "Accept the source notice on the class Sources page, then return to add this photo.",
      );
    const parts: { index: number; sizeBytes: number; sha256: string }[] = [];
    for (let offset = 0; offset < photo.blob.size; offset += config.contract.partBytes) {
      const part = photo.blob.slice(offset, offset + config.contract.partBytes);
      parts.push({ index: parts.length, sizeBytes: part.size, sha256: await digest(part) });
    }
    const source = await workspaceRequest<{ assetId: string; uploadId: string }>(
      "/api/sources",
      "POST",
      {
        sessionId: recording.sessionId,
        kind: "image",
        mimeType: photo.blob.type,
        sizeBytes: photo.blob.size,
        sha256: await digest(photo.blob),
        displayName: `Board photo at ${duration(photo.offsetMs)}`,
        captureAnchor: {
          sourceId: recording.sourceAssetId,
          offsetMs: Math.ceil(photo.offsetMs),
          state: photo.captureState,
        },
        parts,
      },
      `recorded-photo:${photo.id}`,
    );
    const manifest = await workspaceRequest<{
      parts: { index: number; verifiedAt: string | null }[];
    }>(`/api/sources/uploads/${source.uploadId}`, "GET");
    for (const part of parts) {
      if (manifest.parts.some((stored) => stored.index === part.index && stored.verifiedAt))
        continue;
      const link = await workspaceRequest<{ url: string }>(
        `/api/sources/uploads/${source.uploadId}/parts/${part.index}`,
        "GET",
      );
      await uploadWithConfirmation(
        () =>
          fetch(link.url, {
            method: "PUT",
            headers: { "content-type": photo.blob.type },
            body: photo.blob.slice(
              part.index * config.contract.partBytes,
              (part.index + 1) * config.contract.partBytes,
            ),
          }),
        () =>
          workspaceRequest(`/api/sources/uploads/${source.uploadId}/parts/${part.index}`, "POST"),
        "Photo upload interrupted. The local copy is still saved.",
      );
    }
    await workspaceRequest(
      `/api/sources/uploads/${source.uploadId}/complete`,
      "POST",
      {},
      `photo-complete:${photo.id}`,
    );
    await store.savePhoto({ ...photo, sourceAssetId: source.assetId });
  }
  const active = ["starting", "recording", "paused", "saving"].includes(state.phase);
  const currentId = state.recording?.id;
  return (
    <div className="preview-stack">
      <Panel
        tone="hero"
        title={active ? "Your class is being recorded" : "Recordings on this device"}
      >
        {active ? (
          <>
            <p role="timer" className="preview-rec-time" aria-label="Active recording time">
              {duration(elapsed)}
            </p>
            <p>
              {state.phase === "paused"
                ? "Paused. The microphone is not being recorded."
                : state.phase === "saving"
                  ? "Saving the final audio parts…"
                  : "You can move around Recalino while recording continues."}
            </p>
            <Actions>
              {state.phase === "recording" ? (
                <Button secondary onClick={() => controller.pause()}>
                  Pause recording
                </Button>
              ) : state.phase === "paused" ? (
                <Button secondary onClick={() => controller.resume()}>
                  Resume recording
                </Button>
              ) : null}
              <Button
                disabled={["starting", "saving"].includes(state.phase)}
                onClick={() => void controller.stop()}
              >
                Stop and save
              </Button>
              {["recording", "paused"].includes(state.phase) ? (
                <Button
                  secondary
                  onClick={() => {
                    captureAnchor.current = {
                      offsetMs: controller.elapsed(),
                      captureState: state.phase === "paused" ? "paused" : "recording",
                    };
                    photoInput.current?.click();
                  }}
                >
                  Add board photo
                </Button>
              ) : null}
            </Actions>
            <input
              hidden
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void operation("photo", () => savePhoto(file));
              }}
            />
            <p>
              {photos.filter((photo) => photo.recordingId === currentId).length} board photos saved
              on this device
            </p>
          </>
        ) : (
          <>
            <p>
              Audio is saved on this device. It is sent for transcription only after you confirm
              processing.
            </p>
            <RecordLauncher sessionId={sessionId} />
          </>
        )}
        {state.error ? <Status tone="error">{state.error}</Status> : null}
      </Panel>
      {error ? <Status tone="error">{error}</Status> : null}
      <Panel title="Saved and recoverable recordings">
        {!rows.length ? (
          <p className="preview-muted">No recordings on this device yet.</p>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="preview-panel">
              <h3>{new Date(row.createdAt).toLocaleString()}</h3>
              <p>
                {duration(row.id === currentId && active ? elapsed : row.activeMs)} ·{" "}
                {Math.ceil(row.bytes / 1024)} KB
              </p>
              {row.id === currentId && active ? (
                <p>Recording in progress</p>
              ) : (
                <>
                  <p>
                    {row.status === "saved"
                      ? "Saved on this device"
                      : "Recording was interrupted. Check and export the saved parts."}
                  </p>
                  <Actions>
                    <Button
                      secondary
                      disabled={busy !== null}
                      onClick={() =>
                        void operation(row.id, async () => {
                          const blob = await store.blob(userId, row.id);
                          setPlayer({ id: row.id, url: URL.createObjectURL(blob) });
                        })
                      }
                    >
                      Listen
                    </Button>
                    <Button
                      secondary
                      disabled={busy !== null}
                      onClick={() =>
                        void operation(row.id, async () =>
                          download(
                            await store.blob(userId, row.id),
                            `class-${row.id}.${row.mimeType.includes("mp4") ? "m4a" : row.mimeType.includes("ogg") ? "ogg" : "webm"}`,
                          ),
                        )
                      }
                    >
                      Export audio
                    </Button>
                    {!row.sourceAssetId ? (
                      <Button
                        disabled={busy !== null}
                        onClick={() => void operation(row.id, () => attach(row))}
                      >
                        Add to class sources
                      </Button>
                    ) : null}
                    {row.sessionId ? (
                      <Link href={`/classes/${row.sessionId}/sources`}>Open class sources</Link>
                    ) : null}
                  </Actions>
                  {player?.id === row.id ? (
                    <audio controls src={player.url}>
                      <track kind="captions" />
                    </audio>
                  ) : null}
                  <PhotoGallery
                    photos={photos}
                    recordingId={row.id}
                    onAttach={(photo) => void operation(photo.id, () => attachPhoto(photo))}
                    disabled={busy !== null}
                  />
                  <details>
                    <summary>Remove from this device</summary>
                    <p>
                      This removes the local audio and board photos. Export a copy first if you need
                      it.
                    </p>
                    <Button
                      secondary
                      disabled={busy !== null}
                      onClick={() => void operation(row.id, () => store.remove(userId, row.id))}
                    >
                      Confirm local removal
                    </Button>
                  </details>
                </>
              )}
            </article>
          ))
        )}
      </Panel>
      <p className="preview-muted">
        Clearing this browser's site data removes local audio. Keep a copy of recordings you need.
      </p>
    </div>
  );
}

function PhotoGallery({
  photos: allPhotos,
  recordingId,
  onAttach,
  disabled,
}: {
  photos: LocalPhoto[];
  recordingId: string;
  onAttach: (photo: LocalPhoto) => void;
  disabled: boolean;
}) {
  const photos = useMemo(
    () => allPhotos.filter((photo) => photo.recordingId === recordingId),
    [allPhotos, recordingId],
  );
  const [urls, setUrls] = useState<{ photo: LocalPhoto; url: string }[]>([]);
  useEffect(() => {
    const next = photos.map((photo) => ({ photo, url: URL.createObjectURL(photo.blob) }));
    setUrls(next);
    return () => {
      for (const item of next) URL.revokeObjectURL(item.url);
    };
  }, [photos]);
  if (!photos.length) return null;
  return (
    <div className={styles.photoList}>
      {urls.map(({ photo, url }) => (
        <figure key={photo.id}>
          {/* biome-ignore lint/performance/noImgElement: device Blob URLs are temporary and cannot be optimized on the server. */}
          <img src={url} alt={`Board captured around ${duration(photo.offsetMs)}`} />
          <figcaption>
            {duration(photo.offsetMs)} ·{" "}
            {photo.captureState === "paused"
              ? "Taken while paused; time needs checking"
              : "Estimated capture position"}
          </figcaption>
          {!photo.sourceAssetId ? (
            <Button secondary disabled={disabled} onClick={() => onAttach(photo)}>
              Add photo to class
            </Button>
          ) : (
            <p>Added to class sources</p>
          )}
        </figure>
      ))}
    </div>
  );
}
