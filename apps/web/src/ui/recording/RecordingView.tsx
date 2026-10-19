"use client";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog, Sheet } from "../components/Sheet";
import { userMessage, workspaceRequest } from "../workspace/api";
import {
  notifyAutomaticLearning,
  pendingLearningBatch,
  uploadAutomaticPhoto,
} from "../workspace/automatic-learning";
import { Actions, Button, LinkButton, Panel, Status } from "../workspace/primitives";
import { captureIsQuiet } from "./capture-phase";
import { MissingAudioNotice, partMissingLabel } from "./MissingAudioNotice";
import type { PhotoQuality } from "./photo-quality";
import { photoQuality } from "./photo-quality-client";
import { canRemoveLocalPhoto, removeLocalPhoto } from "./photo-removal";
import styles from "./Recording.module.css";
import { RecordLauncher, useRecording } from "./RecordingProvider";
import { recordingCopy } from "./recording-copy";
import { formatPartDate } from "./recording-format";
import { SavedPartStatus } from "./SavedPartStatus";
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
export function RecordingView({
  sessionId,
  backHref,
  backLabel = "Back to session",
}: {
  sessionId?: string;
  /** Where the way back leads once capture is over (UX-02); the page has no navigation until then. */
  backHref?: string;
  backLabel?: string;
}) {
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
            setError(userMessage(failure, "The material notice could not be opened."));
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
      setError(userMessage(failure, "The recording could not be opened."));
    } finally {
      setBusy(null);
    }
  }
  async function attach(row: Recording) {
    await registerRecordingRow(row, store, controller);
  }
  /** Whether this part is the one being captured right now. */
  function capturing(recordingId: string) {
    return (
      recordingId === controller.state.recording?.id &&
      ["starting", "recording", "recovering", "paused", "saving"].includes(controller.state.phase)
    );
  }
  /** Opens the camera for a new photo; a retake never replaces the earlier one (PRD-CORE-05). */
  function takePhoto(anchor: NonNullable<typeof captureAnchor.current>) {
    captureAnchor.current = anchor;
    photoInput.current?.click();
  }
  function captureNow() {
    const recording = controller.state.recording;
    if (!recording) return;
    takePhoto({
      recordingId: recording.id,
      // Audio already measured in this part, so the anchor never passes its end.
      offsetMs: controller.anchorMs(),
      captureState: controller.state.phase === "paused" ? "paused" : "recording",
    });
  }
  function retake(photo: LocalPhoto) {
    // During capture the new photo is anchored now; after Stop, to the moment of the first one.
    if (capturing(photo.recordingId)) captureNow();
    else
      takePhoto({
        recordingId: photo.recordingId,
        offsetMs: photo.offsetMs,
        captureState: photo.captureState,
      });
  }
  /** The pending upload group of the photo's session, which may already name it on the server. */
  function uploadJournal(photo: LocalPhoto) {
    const sessionOf = rows.find((row) => row.id === photo.recordingId)?.sessionId;
    return sessionOf ? pendingLearningBatch(userId, sessionOf) : null;
  }
  const canRemove = (photo: LocalPhoto) => canRemoveLocalPhoto(photo, uploadJournal(photo));
  const removePhoto = (photo: LocalPhoto) =>
    void operation(photo.id, async () => {
      await removeLocalPhoto(photo, {
        store,
        uploadJournal: uploadJournal(photo),
        forgetDiagnostics: controller.forgetPhotoQuality,
      });
    });
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
    // On-device readability (D72): numbers only reach diagnostics; failures show nothing.
    void photoQuality(photo.id, file).then((quality) => {
      if (quality) controller.reportPhotoQuality(photo.id, quality);
    });
    // A retake for a finished part joins its session's photos like any other saved photo.
    const row = rows.find((candidate) => candidate.id === photo.recordingId);
    if (row?.sessionId && !capturing(photo.recordingId)) notifyAutomaticLearning(row.sessionId);
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
  // PRD-REC-02: until Stop, only a real capture failure may speak (state.error below). Upload
  // and list problems wait; they stay in state and appear as soon as Stop is pressed (UX-11).
  const quiet = captureIsQuiet(state.phase);
  const currentId = state.recording?.id;
  return (
    <div className="preview-stack">
      {backHref && !active ? (
        <Actions>
          <LinkButton secondary href={backHref}>
            {backLabel}
          </LinkButton>
        </Actions>
      ) : null}
      <Panel
        tone="hero"
        title={active ? "Your session is being recorded" : "Recordings on this device"}
      >
        {active ? (
          <>
            <p role="timer" className={styles.timer} aria-label="Active recording time">
              {duration(time.elapsed)}
            </p>
            {/* Pause and Stop come before the explanations, so Stop is on screen without scrolling (UX-02). */}
            <Actions>
              {["recording", "recovering"].includes(state.phase) ? (
                <Button secondary className={styles.control} onClick={() => controller.pause()}>
                  Pause recording
                </Button>
              ) : state.phase === "paused" ? (
                <Button secondary className={styles.control} onClick={() => controller.resume()}>
                  Resume recording
                </Button>
              ) : null}
              <Button
                className={styles.control}
                disabled={["starting", "saving"].includes(state.phase)}
                onClick={() => void controller.stop()}
              >
                Stop and save
              </Button>
              {["recording", "paused"].includes(state.phase) ? (
                <Button secondary disabled={!sourceNotice?.noticeAccepted} onClick={captureNow}>
                  Add board photo
                </Button>
              ) : null}
            </Actions>
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
            <p>
              {photos.filter((photo) => photo.recordingId === currentId).length} board photos saved
              on this device
            </p>
            {currentId ? (
              <PhotoGallery
                photos={photos}
                recordingId={currentId}
                capturing
                onAttach={() => {}}
                onRetake={retake}
                canRemove={canRemove}
                onRemove={removePhoto}
                retakeDisabled={
                  !sourceNotice?.noticeAccepted || !["recording", "paused"].includes(state.phase)
                }
                disabled={busy !== null}
                automatic={false}
              />
            ) : null}
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
        {state.phase === "saved" ? <MissingAudioNotice missing={state.missing} /> : null}
        {state.error ? <Status tone="error">{state.error}</Status> : null}
      </Panel>
      {error && !quiet ? <Status tone="error">{error}</Status> : null}
      {syncState.pending > 0 && !quiet ? (
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
                {formatPartDate(row.createdAt)}
                {(row.segment ?? 1) > 1 ? ` · Part ${row.segment}` : null}
              </h3>
              <p>
                {duration(row.id === currentId && active ? time.segmentElapsed : row.activeMs)}
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
                  <SavedPartStatus row={row} phase={state.phase} />
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
                    onRetake={retake}
                    canRemove={canRemove}
                    onRemove={removePhoto}
                    retakeDisabled={!sourceNotice?.noticeAccepted}
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
  onRetake,
  canRemove,
  onRemove,
  retakeDisabled,
  disabled,
  automatic,
  capturing = false,
}: {
  photos: LocalPhoto[];
  recordingId: string;
  onAttach: (photo: LocalPhoto) => void;
  onRetake: (photo: LocalPhoto) => void;
  /** Only a photo that exists nowhere but this device (owner decision 2026-10-13). */
  canRemove: (photo: LocalPhoto) => boolean;
  onRemove: (photo: LocalPhoto) => void;
  retakeDisabled: boolean;
  disabled: boolean;
  automatic: boolean;
  /** During capture the row shows only the photo and its readability (PRD-REC-02). */
  capturing?: boolean;
}) {
  const photos = useMemo(
    // In the order they were taken, so a retake follows the photo it repeats.
    () =>
      allPhotos
        .filter((photo) => photo.recordingId === recordingId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [allPhotos, recordingId],
  );
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LocalPhoto | null>(null);
  const ids = photos.map((photo) => photo.id).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: photos are reloaded after every saved audio chunk; URLs change only with the set of photos, so neither the thumbnails nor a zoomed photo reload during capture.
  useEffect(() => {
    const next = Object.fromEntries(
      photos.map((photo) => [photo.id, URL.createObjectURL(photo.blob)]),
    );
    setUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [ids]);
  const shown = photos.flatMap((photo) => {
    const url = urls[photo.id];
    return url ? [{ photo, url }] : [];
  });
  if (!shown.length) return null;
  const zoom = shown.find((item) => item.photo.id === zoomed);
  const label = (photo: LocalPhoto) => `Board captured around ${duration(photo.offsetMs)}`;
  return (
    <div className={styles.photoList}>
      {shown.map(({ photo, url }) => (
        <figure key={photo.id}>
          <button type="button" className={styles.thumb} onClick={() => setZoomed(photo.id)}>
            {/* biome-ignore lint/performance/noImgElement: device Blob URLs are temporary and cannot be optimized on the server. */}
            <img src={url} alt={label(photo)} />
          </button>
          <PhotoReadability
            photo={photo}
            disabled={retakeDisabled}
            onRetake={() => onRetake(photo)}
          />
          <figcaption>
            {duration(photo.offsetMs)} ·{" "}
            {photo.captureState === "paused"
              ? "Taken while paused; time needs checking"
              : "Estimated capture position"}
          </figcaption>
          {capturing ? null : !photo.sourceAssetId ? (
            <>
              {automatic ? <p>Uploads automatically after the recording is saved.</p> : null}
              <Button secondary disabled={disabled} onClick={() => onAttach(photo)}>
                {automatic ? "Retry photo upload" : "Add photo to session"}
              </Button>
            </>
          ) : (
            <p>Added to session sources</p>
          )}
          {canRemove(photo) ? (
            <Button secondary disabled={disabled} onClick={() => setRemoving(photo)}>
              {recordingCopy.photoRemove.action}
            </Button>
          ) : null}
        </figure>
      ))}
      {zoom ? (
        <Sheet
          open
          onClose={() => setZoomed(null)}
          title={label(zoom.photo)}
          footer={
            <>
              <Button
                secondary
                disabled={retakeDisabled}
                onClick={() => {
                  setZoomed(null);
                  onRetake(zoom.photo);
                }}
              >
                {recordingCopy.photoQuality.retake}
              </Button>
              {canRemove(zoom.photo) ? (
                <Button
                  secondary
                  disabled={disabled}
                  onClick={() => {
                    setZoomed(null);
                    setRemoving(zoom.photo);
                  }}
                >
                  {recordingCopy.photoRemove.action}
                </Button>
              ) : null}
            </>
          }
        >
          <p>{recordingCopy.photoQuality.zoomPrompt}</p>
          {/* Native pinch-zoom and scrolling over the full-size photo (D72 layer 2). */}
          <div className={styles.zoom}>
            {/* biome-ignore lint/performance/noImgElement: device Blob URLs are temporary and cannot be optimized on the server. */}
            <img src={zoom.url} alt={label(zoom.photo)} />
          </div>
        </Sheet>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) onRemove(removing);
          setRemoving(null);
        }}
        title={recordingCopy.photoRemove.confirm}
        consequences={[recordingCopy.photoRemove.notUploaded]}
        safeLabel={recordingCopy.photoRemove.keep}
        confirmLabel={recordingCopy.photoRemove.action}
      />
    </div>
  );
}

/** One quiet line under the thumbnail (D72 layer 1); nothing at all if the check fails. */
function PhotoReadability({
  photo,
  disabled,
  onRetake,
}: {
  photo: LocalPhoto;
  disabled: boolean;
  onRetake: () => void;
}) {
  const [quality, setQuality] = useState<PhotoQuality>();
  useEffect(() => {
    let current = true;
    void photoQuality(photo.id, photo.blob).then((value) => {
      if (current) setQuality(value);
    });
    return () => {
      current = false;
    };
  }, [photo.id, photo.blob]);
  if (!quality) return null;
  if (quality.verdict === "ok")
    return <Status tone="success">{recordingCopy.photoQuality.ok}</Status>;
  return (
    <>
      <Status>{recordingCopy.photoQuality[quality.verdict]}</Status>
      <Button secondary disabled={disabled} onClick={onRetake}>
        {recordingCopy.photoQuality.retake}
      </Button>
    </>
  );
}
