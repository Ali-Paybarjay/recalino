"use client";
import { useId, useState } from "react";
import { IconButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { ConfirmDialog } from "../components/Sheet";
import { DownloadSimple, Play, Trash, Waveform } from "../icons";
import { Button, Panel } from "../workspace/primitives";
import { captureIsQuiet } from "./capture-phase";
import type { CaptureState } from "./controller";
import { partMissingLabel } from "./MissingAudioNotice";
import styles from "./Recording.module.css";
import { recordingCopy } from "./recording-copy";
import { SavedPartStatus } from "./SavedPartStatus";
import type { Recording } from "./store";

/** Audio length as m:ss, as the recording clock shows it. */
export function partDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "Part {n} · {duration}" (D107): every part is numbered, Part 1 included. */
export function partTitle(row: Pick<Recording, "segment">, ms: number) {
  return recordingCopy.partTitle
    .replace("{n}", String(row.segment ?? 1))
    .replace("{duration}", partDuration(ms));
}

/** What the page lets the learner do with a finished part; absent during capture. */
export type PartActions = {
  listen(row: Recording): void;
  exportAudio(row: Recording): void;
  remove(row: Recording): void;
};

/**
 * The recording page's list (D107): one compact numbered line per part, in the order recorded.
 * During capture a line shows only its number, length and status: playback would be recorded, and
 * nothing may ask for attention until Stop (PRD-REC-02), so the lines have no controls and no
 * live region. After Stop each line has three small controls, told apart by the line's title.
 */
export function RecordedParts({
  rows,
  phase,
  live = null,
  actions,
  busy = false,
  player = null,
}: {
  rows: readonly Recording[];
  phase: CaptureState["phase"];
  /** The part being recorded now and its running length, during capture only. */
  live?: { id: string; ms: number; recovering: boolean } | null;
  /** Absent during capture. */
  actions?: PartActions;
  busy?: boolean;
  /** The part whose audio is open for listening. */
  player?: { id: string; url: string } | null;
}) {
  return (
    <ol className={`workspace-list ${styles.parts}`}>
      {rows.map((row) => (
        <PartLine
          key={row.id}
          row={row}
          phase={phase}
          live={live?.id === row.id ? live : null}
          actions={actions}
          busy={busy}
          playing={player?.id === row.id ? player.url : null}
        />
      ))}
    </ol>
  );
}

function PartLine({
  row,
  phase,
  live,
  actions,
  busy,
  playing,
}: {
  row: Recording;
  phase: CaptureState["phase"];
  live: { ms: number; recovering: boolean } | null;
  actions?: PartActions;
  busy: boolean;
  playing: string | null;
}) {
  const titleId = useId();
  const [removing, setRemoving] = useState(false);
  const missing = row.gaps?.reduce((sum, gap) => sum + gap.missingMs, 0) ?? 0;
  return (
    <li>
      <div className={styles.part}>
        <span className={styles.partTile}>
          <Icon icon={Waveform} size={20} />
        </span>
        <div className={styles.partText}>
          <strong id={titleId} className={styles.partTitle}>
            {partTitle(row, live ? live.ms : row.activeMs)}
            {/* Minutes not recorded are told after Stop only (PRD-REC-02). */}
            {missing && !live && !captureIsQuiet(phase) ? ` · ${partMissingLabel(missing)}` : null}
          </strong>
          {live ? (
            <p>
              {live.recovering
                ? "Recording interrupted; automatic recovery in progress"
                : "Recording in progress"}
            </p>
          ) : (
            <SavedPartStatus row={row} phase={phase} />
          )}
        </div>
        {actions && !live ? (
          <div className={styles.partActions}>
            <IconButton
              icon={Play}
              label="Listen"
              aria-describedby={titleId}
              disabled={busy}
              onClick={() => actions.listen(row)}
            />
            <IconButton
              icon={DownloadSimple}
              label="Export audio"
              aria-describedby={titleId}
              disabled={busy}
              onClick={() => actions.exportAudio(row)}
            />
            <IconButton
              icon={Trash}
              label="Remove from this device"
              aria-describedby={titleId}
              disabled={busy || row.awaitingFinalData}
              onClick={() => setRemoving(true)}
            />
          </div>
        ) : null}
      </div>
      {/* No player during capture: its sound would be recorded (PRD-REC-02). */}
      {playing && actions ? (
        <audio controls src={playing} className={styles.player} aria-describedby={titleId}>
          <track kind="captions" />
        </audio>
      ) : null}
      {actions ? (
        <ConfirmDialog
          open={removing}
          onClose={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            actions.remove(row);
          }}
          title="Remove from this device"
          consequences={[
            "This removes the local audio and board photos. Export a copy first if you need it.",
          ]}
          safeLabel={recordingCopy.photoRemove.keep}
          confirmLabel="Confirm local removal"
          // Audio that never reached the server cannot be got back (frame C3).
          requireAck={!row.sourceAssetId}
        />
      ) : null}
    </li>
  );
}

/**
 * "{added} parts added · {pending} remaining" for the listed parts (D107), or the sync's message
 * while it waits or failed, with its retry. The page shows it only after Stop (PRD-REC-02, UX-11).
 */
export function PartsSyncStatus({
  added,
  pending,
  phase,
  error,
  onRetry,
}: {
  added: number;
  pending: number;
  phase: "idle" | "syncing" | "waiting" | "failed";
  error: string | null;
  onRetry?: () => void;
}) {
  if (!pending) return null;
  return (
    <Panel title="Adding recorded parts to your session">
      <p role={phase === "failed" ? "alert" : "status"}>
        {phase === "syncing" || !error ? `${added} parts added · ${pending} remaining` : error}
      </p>
      {phase === "failed" ? <Button onClick={onRetry}>Retry adding session material</Button> : null}
    </Panel>
  );
}
