"use client";
import { useEffect, useId, useState } from "react";
import { IconButton, Button as SmallButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { UploadProgress } from "../components/UploadProgress";
import { FilePdf, FileText, Image as ImageIcon, Trash, Waveform, X } from "../icons";
import { mediaAlt } from "./media-alt";
import { Actions, Button, Field, Status } from "./primitives";
import styles from "./SessionMaterial.module.css";
import { sourceKindLabel } from "./source-labels";
import type { SourceRow } from "./source-types";
import type { UploadEntry } from "./upload-store";

// The lines of the session material list (D106): one compact line per file, with its controls
// at the end and the rarely needed ones underneath.

export function FileUploadItem({
  file,
  busy,
  remove,
  retry,
}: {
  file: UploadEntry;
  busy: boolean;
  remove: () => void;
  retry?: () => void;
}) {
  const active = ["queued", "checking", "uploading", "saving"].includes(file.phase);
  const status =
    file.phase === "queued"
      ? "Saved — waiting to upload"
      : file.phase === "checking"
        ? "Checking file…"
        : file.phase === "saving"
          ? "Saving on this device…"
          : file.phase === "verifying"
            ? "Uploaded — checking file"
            : file.phase === "failed"
              ? "File needs attention"
              : file.sentBytes >= file.sizeBytes
                ? "Finishing upload…"
                : "Uploading…";
  const measured = ["uploading", "verifying"].includes(file.phase);
  return (
    <li aria-busy={active || undefined} className="workspace-upload-file">
      <div className="workspace-row">
        <strong dir="auto">{file.displayName}</strong>
        <span className="workspace-muted">{(file.sizeBytes / 1_000_000).toFixed(1)} MB</span>
      </div>
      <UploadProgress
        label={`Upload progress for ${file.displayName}`}
        status={status}
        value={
          measured || file.phase === "failed"
            ? file.sizeBytes > 0
              ? (file.sentBytes / file.sizeBytes) * 100
              : 0
            : undefined
        }
        detail={
          measured
            ? `${(file.sentBytes / 1_000_000).toFixed(2)} of ${(file.sizeBytes / 1_000_000).toFixed(2)} MB`
            : undefined
        }
        startedAt={file.startedAt}
        finishedAt={file.finishedAt}
        active={active}
      />
      {file.problem ? (
        <>
          <Status tone="error">{file.problem}</Status>
          <Actions>
            {retry && (
              <SmallButton variant="primary" disabled={busy} onClick={retry}>
                Retry saved file
              </SmallButton>
            )}
            <SmallButton disabled={busy} onClick={remove}>
              {retry ? "Skip this file" : file.source ? "Remove from session" : "Dismiss"}
            </SmallButton>
          </Actions>
        </>
      ) : null}
    </li>
  );
}

function kindLabel(source: SourceRow) {
  return source.kind === "audio"
    ? "Class audio"
    : source.role === "board_photo"
      ? "Board photo"
      : source.role === "user_notes"
        ? "Notes"
        : sourceKindLabel(source.kind);
}

export function SourceItem({
  source,
  busy,
  change,
  remove,
  read,
  unlock,
  localAvailable,
  deleteSource,
  selectionDirty,
  removeLabel,
  deletionBlocked,
  problem = "",
  picture = null,
  pictureTile,
  pictureFailed,
}: {
  source: SourceRow;
  busy: boolean;
  change: (patch: Partial<SourceRow>) => Promise<unknown>;
  remove: () => Promise<unknown>;
  read: () => Promise<unknown>;
  unlock: (password: string) => Promise<unknown>;
  localAvailable: boolean | null;
  /** Resolves to whether the deletion was saved. */
  deleteSource: (mode: "original" | "all") => Promise<boolean>;
  selectionDirty: (assetId: string, dirty: boolean) => void;
  removeLabel?: string;
  deletionBlocked?: boolean;
  /** The page's latest problem, shown in the delete sheet after its deletion failed. */
  problem?: string;
  /** A thumbnail of this photo, once it has loaded (source-thumbnails.ts). */
  picture?: string | null;
  /** Registers the tile, so its thumbnail loads when it comes into view. */
  pictureTile?: (element: Element | null) => void;
  pictureFailed?: (url: string) => void;
}) {
  const nameId = useId();
  const [password, setPassword] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const needsPassword = ["needs_password", "wrong_password"].includes(source.rejectionReason ?? "");
  const isAudio = source.kind === "audio";
  const supportsRange = isAudio || source.kind === "pdf";
  const factor = isAudio ? 1000 : 1;
  const maximum = (isAudio ? (source.durationMs ?? 0) : (source.pageCount ?? 0)) / factor;
  const savedStart = (source.ranges[0]?.start ?? (isAudio ? 0 : 1)) / factor;
  const savedEnd = (source.ranges[0]?.end ?? maximum * factor) / factor;
  const savedPartial = source.ranges.length > 0;
  const [partial, setPartial] = useState(savedPartial);
  const [start, setStart] = useState(String(savedStart));
  const [end, setEnd] = useState(String(savedEnd));
  useEffect(() => {
    setPartial(savedPartial);
    setStart(String(savedStart));
    setEnd(String(savedEnd));
  }, [savedPartial, savedStart, savedEnd]);
  const dirty =
    supportsRange &&
    (partial !== savedPartial ||
      (partial &&
        (!start.trim() ||
          !end.trim() ||
          Number(start) !== savedStart ||
          Number(end) !== savedEnd)));
  useEffect(() => {
    selectionDirty(source.assetId, dirty);
  }, [selectionDirty, source.assetId, dirty]);
  useEffect(() => () => selectionDirty(source.assetId, false), [selectionDirty, source.assetId]);
  const status = isAudio
    ? localAvailable === null
      ? "Checking this device…"
      : localAvailable
        ? "Original audio is saved on this device"
        : "Original audio is not on this device"
    : source.originalDeletedAt
      ? "Original file is no longer kept"
      : needsPassword
        ? source.rejectionReason === "wrong_password"
          ? "Incorrect password — try again or upload an unlocked copy"
          : "Needs a password — enter it or upload an unlocked copy"
        : source.uploadState === "rejected"
          ? "Not accepted — add a supported file"
          : source.verifiedAt
            ? "Received"
            : source.uploadState === "verifying"
              ? "Verifying file"
              : "Upload pending — choose the same file to resume";
  const ready = source.kind === "audio" || (!!source.verifiedAt && !needsPassword);
  const openable = isAudio
    ? localAvailable === true
    : !!source.verifiedAt && !source.originalDeletedAt;
  const timeToConfirm =
    !!source.anchorSourceId &&
    source.captureOffsetMs !== null &&
    source.timeStatus !== "user_confirmed";
  const rangeForm = ready && supportsRange;
  const tile = (
    <span ref={pictureTile} className={`${styles.tile} ${isAudio ? styles.audio : ""}`}>
      {picture ? (
        // biome-ignore lint/performance/noImgElement: Signed private URLs must not pass through an image proxy.
        <img
          src={picture}
          alt={mediaAlt(source.displayName)}
          dir="auto"
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => pictureFailed?.(picture)}
        />
      ) : (
        <Icon
          icon={
            isAudio
              ? Waveform
              : source.kind === "image"
                ? ImageIcon
                : source.kind === "pdf"
                  ? FilePdf
                  : FileText
          }
          size={20}
        />
      )}
    </span>
  );
  async function confirmDelete(mode: "original" | "all") {
    const deleted = await deleteSource(mode);
    setDeleteFailed(!deleted);
    if (deleted) setDeleteOpen(false);
  }
  return (
    <li>
      <div className={styles.row}>
        {openable ? (
          <button
            type="button"
            className={styles.open}
            aria-label="Open original"
            aria-describedby={nameId}
            disabled={busy}
            onClick={() => void read()}
          >
            {tile}
          </button>
        ) : (
          tile
        )}
        <div className={styles.text}>
          <label className="workspace-check">
            <input
              type="checkbox"
              checked={source.selected}
              disabled={busy || !ready}
              onChange={(event) => void change({ selected: event.target.checked })}
            />
            <strong id={nameId} dir="auto" className={styles.name}>
              {source.displayName}
            </strong>
          </label>
          <span className={styles.meta}>
            {kindLabel(source)} · {(source.sizeBytes / 1_000_000).toFixed(1)} MB
          </span>
          <span className={styles.meta}>{status}</span>
        </div>
        <div className={styles.ctas}>
          <IconButton
            icon={X}
            label={removeLabel ?? "Remove from session"}
            aria-describedby={nameId}
            disabled={busy}
            onClick={() => void remove()}
          />
          <IconButton
            icon={Trash}
            label="Delete options"
            aria-describedby={nameId}
            onClick={() => {
              setDeleteConfirmed(false);
              setDeleteFailed(false);
              setDeleteOpen(true);
            }}
          />
        </div>
      </div>
      {timeToConfirm || needsPassword || rangeForm ? (
        <div className={styles.more}>
          {timeToConfirm && (
            <>
              <p className="workspace-muted">
                Taken around {((source.captureOffsetMs ?? 0) / 1000).toFixed(1)} seconds into the
                recording
                {source.captureState === "paused" ? " while recording was paused" : ""} · Estimated
                time
              </p>
              <Actions>
                <SmallButton
                  disabled={busy}
                  aria-describedby={nameId}
                  onClick={() => void change({ timeStatus: "user_confirmed" })}
                >
                  Confirm this photo time
                </SmallButton>
              </Actions>
            </>
          )}
          {needsPassword ? (
            <>
              <Field
                label="PDF password"
                hint="Used for this unlock attempt only. It is never stored."
              >
                <input
                  type="password"
                  aria-describedby={nameId}
                  value={password}
                  autoComplete="off"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Actions>
                <SmallButton
                  disabled={busy || !password}
                  aria-describedby={nameId}
                  onClick={() => {
                    const value = password;
                    setPassword("");
                    void unlock(value);
                  }}
                >
                  Unlock PDF
                </SmallButton>
              </Actions>
            </>
          ) : null}
          {rangeForm ? (
            // Kept mounted while closed, so an unsaved selection still holds back processing.
            <details className={styles.disclosure}>
              <summary aria-describedby={nameId}>Use for processing</summary>
              <form
                className="workspace-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void change({
                    ranges: partial
                      ? [
                          {
                            start: Math.round(Number(start) * factor),
                            end: Math.round(Number(end) * factor),
                          },
                        ]
                      : [],
                  });
                }}
              >
                <fieldset disabled={busy} className="workspace-source-selection workspace-stack">
                  <legend className="rc-visually-hidden">Use for processing</legend>
                  <div className="workspace-row">
                    <label className="workspace-check">
                      <input
                        type="radio"
                        name={`extent-${source.assetId}`}
                        checked={!partial}
                        onChange={() => setPartial(false)}
                      />
                      Whole file
                    </label>
                    <label className="workspace-check">
                      <input
                        type="radio"
                        name={`extent-${source.assetId}`}
                        checked={partial}
                        onChange={() => setPartial(true)}
                      />
                      Part of file
                    </label>
                  </div>
                  {partial ? (
                    <div className="workspace-grid">
                      <Field label={isAudio ? "Start (seconds)" : "Start page"}>
                        <input
                          type="number"
                          min={isAudio ? 0 : 1}
                          max={maximum}
                          step={isAudio ? 0.001 : 1}
                          required
                          value={start}
                          onChange={(event) => setStart(event.target.value)}
                        />
                      </Field>
                      <Field
                        label={isAudio ? "End (seconds)" : "End page"}
                        hint={
                          isAudio
                            ? "Only this time range will be processed."
                            : "Includes the start and end pages."
                        }
                      >
                        <input
                          type="number"
                          min={isAudio ? Number(start) + 0.001 : Math.max(1, Number(start))}
                          max={maximum}
                          step={isAudio ? 0.001 : 1}
                          required
                          value={end}
                          onChange={(event) => setEnd(event.target.value)}
                        />
                      </Field>
                    </div>
                  ) : null}
                </fieldset>
                <Actions>
                  <SmallButton disabled={busy || !dirty} type="submit" aria-describedby={nameId}>
                    Save selection
                  </SmallButton>
                </Actions>
                <p className="workspace-muted">
                  This saves what to use for your next processing run. The original file stays
                  intact.
                </p>
              </form>
            </details>
          ) : null}
        </div>
      ) : null}
      <Sheet
        open={deleteOpen}
        title="Delete options"
        onClose={() => {
          if (!busy) setDeleteOpen(false);
        }}
      >
        {deletionBlocked && (
          <p className="workspace-muted">
            Skip this file or cancel its upload group before deleting this material.
          </p>
        )}
        <p className="workspace-muted">
          Deleting the original file keeps its saved extraction. Deleting from all sessions removes
          this material from every session.
        </p>
        <label className="workspace-check">
          <input
            type="checkbox"
            checked={deleteConfirmed}
            onChange={(event) => setDeleteConfirmed(event.target.checked)}
          />
          I understand that deletion cannot be undone.
        </label>
        {deleteFailed && problem ? <Status tone="error">{problem}</Status> : null}
        <Actions>
          {source.kind !== "audio" && source.contentVersionId && !source.originalDeletedAt ? (
            <Button
              danger
              disabled={busy || !deleteConfirmed || deletionBlocked}
              onClick={() => void confirmDelete("original")}
            >
              Delete original file
            </Button>
          ) : null}
          <Button
            danger
            disabled={busy || !deleteConfirmed || deletionBlocked}
            onClick={() => void confirmDelete("all")}
          >
            Delete from all sessions
          </Button>
        </Actions>
      </Sheet>
    </li>
  );
}
