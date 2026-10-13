"use client";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workspaceRequest } from "../workspace/api";
import { notifyAutomaticLearning, uploadAutomaticPhoto } from "../workspace/automatic-learning";
import { Actions, Button, Panel, Status } from "../workspace/primitives";
import { MissingAudioNotice, partMissingLabel } from "./MissingAudioNotice";
import styles from "./Recording.module.css";
import { RecordLauncher, useRecording } from "./RecordingProvider";
import { recordingCopy } from "./recording-copy";
import { registerRecordingRow } from "./source-sync";
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
export function RecordingView({ sessionId }: { sessionId?: string }) {
  const { controller, state, store, userId, sourceSync, syncState } = useRecording();
  const [rows, setRows] = useState<Recording[]>([]);
  const [time, setTime] = useState({ elapsed: 0, segmentElapsed: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ id: string; url: string } | null>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [sourceNotice, setSourceNotice] = useState<{
    contract: InputContract;
    noticeAccepted: boolean;
  } | null>(null);
  const [noticeConfirmed, setNoticeConfirmed] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const reloadVersion = useRef(0);
  const captureAnchor = useRef<{
    recordingId: string;
    offsetMs: number;
    captureState: "recording" | "paused";
  } | null>(null);
  const reload = useCallback(async () => {
    const version = ++reloadVersion.current;
    try {
      const next = (await store.list(userId)).filter(
        (row) => !sessionId || row.sessionId === sessionId,
      );
      const nextPhotos = (
        await Promise.all(next.map((row) => store.photos(userId, row.id)))
      ).flat();
      if (version !== reloadVersion.current) return;
      setRows(next);
      setPhotos(nextPhotos);
    } catch {
      if (version !== reloadVersion.current) return;
      setError("Local recordings could not be opened. Keep this device's site data and try again.");
    }
  }, [store, userId, sessionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: capture updates also refresh older parts after late final audio is committed.
  useEffect(() => {
    void reload();
  }, [reload, state, syncState]);
  useEffect(() => {
    const timer = setInterval(
      () => setTime({ elapsed: controller.elapsed(), segmentElapsed: controller.segmentElapsed() }),
      250,
    );
    return () => clearInterval(timer);
  }, [controller]);
  useEffect(
    () => () => {
      if (player) URL.revokeObjectURL(player.url);
    },
    [player],
  );
  useEffect(() => {
    const abort = new AbortController();
    const load = () => {
      void workspaceRequest<{ contract: InputContract; noticeAccepted: boolean }>(
        "/api/sources/contract",
        "GET",
        undefined,
        undefined,
        { signal: abort.signal },
      )
        .then((value) => {
          if (!abort.signal.aborted) setSourceNotice(value);
        })
        .catch((failure) => {
          if (!abort.signal.aborted)
            setError(
              failure instanceof Error
                ? failure.message
                : "The material notice could not be opened.",
            );
        });
    };
    load();
    window.addEventListener("online", load);
    return () => {
      abort.abort();
      window.removeEventListener("online", load);
    };
  }, []);
  async function acceptSourceNotice() {
    if (!sourceNotice || !noticeConfirmed) return;
    await workspaceRequest("/api/sources/notice", "POST", {
      version: sourceNotice.contract.noticeVersion,
      confirmed: noticeConfirmed,
    });
    setSourceNotice({ ...sourceNotice, noticeAccepted: true });
    sourceSync.retry();
    for (const id of new Set(rows.flatMap((row) => (row.sessionId ? [row.sessionId] : []))))
      notifyAutomaticLearning(id);
  }
  async function operation(id: string, action: () => Promise<void>) {
    if (
      id === controller.state.recording?.id &&
      ["starting", "recording", "recovering", "paused", "saving"].includes(controller.state.phase)
    ) {
      setError("Stop and save this part before opening or changing it.");
      return;
    }
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
    await registerRecordingRow(row, store, controller);
  }
  async function savePhoto(file: File) {
    const anchor = captureAnchor.current;
    captureAnchor.current = null;
    if (!anchor) return;
    const photo: LocalPhoto = {
      id: crypto.randomUUID(),
      userId,
      ...anchor,
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
      throw new Error("Add the recording to its session first.");
    const config = await workspaceRequest<{ contract: InputContract; noticeAccepted: boolean }>(
      "/api/sources/contract",
      "GET",
    );
    if (!config.noticeAccepted)
      throw new Error(
        `Board photo at ${duration(photo.offsetMs)} is saved on this device. Accept the material notice below to resume its upload.`,
      );
    await uploadAutomaticPhoto(recording, photo, config.contract, {
      store,
      checkAllowed: () => {
        if (controller.snapshot().accountDeletionBlocked)
          throw new DOMException("Account deletion is in progress.", "AbortError");
      },
    });
    notifyAutomaticLearning(recording.sessionId);
  }
  const active = ["starting", "recording", "recovering", "paused", "saving"].includes(state.phase);
  const currentId = state.recording?.id;
  return (
    <div className="preview-stack">
      <Panel
        tone="hero"
        title={active ? "Your session is being recorded" : "Recordings on this device"}
      >
        {active ? (
          <>
            <p role="timer" className="preview-rec-time" aria-label="Active recording time">
              {duration(time.elapsed)}
            </p>
            <p>
              {state.phase === "paused"
                ? "Paused. The microphone is not being recorded."
                : state.phase === "saving"
                  ? "Saving the final audio parts…"
                  : state.phase === "recovering"
                    ? "Reconnecting the microphone automatically. Audio already saved is kept as a separate part."
                    : "Recording continues in ten-minute parts, saved on this device."}
            </p>
            <p className="preview-muted">
              Recording and lock-screen controls depend on your browser. Keep Recalino open and the
              screen on for reliable capture.
            </p>
            <Actions>
              {["recording", "recovering"].includes(state.phase) ? (
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
                  disabled={!sourceNotice?.noticeAccepted}
                  onClick={() => {
                    const recording = controller.state.recording;
                    if (!recording) return;
                    captureAnchor.current = {
                      recordingId: recording.id,
                      // Audio already measured in this part, so the anchor never passes its end.
                      offsetMs: controller.anchorMs(),
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
            {sourceNotice && !sourceNotice.noticeAccepted ? (
              <p>
                <a href="#recording-material-notice">
                  Accept the material notice to add board photos.
                </a>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p>{recordingCopy.introduction}</p>
            <RecordLauncher sessionId={sessionId} />
          </>
        )}
        {state.phase === "saved" ? <MissingAudioNotice missing={state.missing} /> : null}
        {state.error ? <Status tone="error">{state.error}</Status> : null}
      </Panel>
      {error ? <Status tone="error">{error}</Status> : null}
      {syncState.pending > 0 ? (
        <Panel title="Adding recorded parts to your session">
          <p role={syncState.phase === "failed" ? "alert" : "status"}>
            {syncState.phase === "syncing"
              ? `${syncState.count} parts added · ${syncState.pending} remaining`
              : syncState.error}
          </p>
          {syncState.phase === "failed" ? (
            <Button onClick={() => sourceSync.retry()}>Retry adding session sources</Button>
          ) : null}
        </Panel>
      ) : null}
      <Panel title="Saved and recoverable recordings">
        {!rows.length ? (
          <p className="preview-muted">No recordings on this device yet.</p>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="preview-panel">
              <h3>
                {new Date(row.createdAt).toLocaleString()}
                {(row.segment ?? 1) > 1 ? ` · Part ${row.segment}` : null}
              </h3>
              <p>
                {duration(row.id === currentId && active ? time.segmentElapsed : row.activeMs)} ·{" "}
                {Math.ceil(row.bytes / 1024)} KB
                {row.gaps?.length && !(row.id === currentId && active)
                  ? ` · ${partMissingLabel(row.gaps.reduce((sum, gap) => sum + gap.missingMs, 0))}`
                  : null}
              </p>
              {row.id === currentId && active ? (
                <p>
                  {state.phase === "recovering"
                    ? "Recording interrupted; automatic recovery in progress"
                    : "Recording in progress"}
                </p>
              ) : (
                <>
                  <p>
                    {row.awaitingFinalData
                      ? "Recovering the final audio for this part… You can export the parts already saved."
                      : row.status === "saved"
                        ? "Saved on this device"
                        : "Recording was interrupted. Check and export the saved parts."}
                  </p>
                  {row.syncError ? <Status tone="error">{row.syncError}</Status> : null}
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
                        disabled={
                          busy !== null ||
                          row.awaitingFinalData ||
                          (row.autoRegister && !row.completedAt)
                        }
                        onClick={() => void operation(row.id, () => attach(row))}
                      >
                        Add to session sources
                      </Button>
                    ) : null}
                    {row.sessionId ? (
                      <Link href={`/sessions/${row.sessionId}/sources`}>Open session sources</Link>
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
                    automatic={Boolean(row.autoGenerate)}
                  />
                  <details>
                    <summary>Remove from this device</summary>
                    <p>
                      This removes the local audio and board photos. Export a copy first if you need
                      it.
                    </p>
                    <Button
                      secondary
                      disabled={busy !== null || row.awaitingFinalData}
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
      {sourceNotice && !sourceNotice.noticeAccepted ? (
        <section id="recording-material-notice">
          <Panel title="Before adding session material">
            <p>
              After you stop recording, saved audio and board photos automatically create and save
              your session notes and flashcards. Audio stays on this device, with a temporary copy
              uploaded for transcription. Board photos are stored privately.
            </p>
            <p>Follow your institution’s rules for recording and using class materials.</p>
            {photos.some((photo) => !photo.sourceAssetId) ? (
              <p>
                {photos
                  .filter((photo) => !photo.sourceAssetId)
                  .map((photo) => `Board photo at ${duration(photo.offsetMs)}`)
                  .join(", ")}{" "}
                · saved on this device, waiting for this notice.
              </p>
            ) : null}
            <label className="preview-check">
              <input
                type="checkbox"
                checked={noticeConfirmed}
                onChange={(event) => setNoticeConfirmed(event.target.checked)}
              />
              I have the right to use these materials for private study.
            </label>
            <Actions>
              <Button
                disabled={!noticeConfirmed || busy !== null}
                onClick={() => void operation("notice", acceptSourceNotice)}
              >
                Accept and continue
              </Button>
            </Actions>
          </Panel>
        </section>
      ) : null}
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
  automatic,
}: {
  photos: LocalPhoto[];
  recordingId: string;
  onAttach: (photo: LocalPhoto) => void;
  disabled: boolean;
  automatic: boolean;
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
            <>
              {automatic ? <p>Uploads automatically after the recording is saved.</p> : null}
              <Button secondary disabled={disabled} onClick={() => onAttach(photo)}>
                {automatic ? "Retry photo upload" : "Add photo to session"}
              </Button>
            </>
          ) : (
            <p>Added to session sources</p>
          )}
        </figure>
      ))}
    </div>
  );
}
