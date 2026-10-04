"use client";
import type { InputContract, SourceKind } from "@recalino/core/src";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IndexedRecordingStore } from "../recording/store";
import { workspaceRequest } from "./api";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
import { uploadWithConfirmation } from "./upload";

export interface SourceRow {
  assetId: string;
  displayName: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  pageCount: number | null;
  verifiedAt: string | null;
  originalDeletedAt: string | null;
  selected: boolean;
  role: string;
  ranges: { start: number; end: number }[];
  timeStatus: string;
  contentVersionId: string | null;
  uploadId: string | null;
  uploadState: string | null;
  rejectionReason: string | null;
  anchorSourceId: string | null;
  captureOffsetMs: number | null;
  captureState: string | null;
}
interface OwnSource {
  id: string;
  display_name: string;
  kind: string;
  uploadId: string | null;
  uploadState: string | null;
  original_deleted_at: string | null;
}
async function checksum(blob: Blob) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function kindOf(file: File): SourceKind | null {
  if (/\.(jpe?g|png|webp)$/i.test(file.name)) return "image";
  if (/\.pdf$/i.test(file.name)) return "pdf";
  if (/\.(html?|xhtml)$/i.test(file.name)) return "html";
  if (/\.txt$/i.test(file.name)) return "text";
  if (/\.(m4a|mp3|wav|webm|ogg)$/i.test(file.name)) return "audio";
  return null;
}
function mimeOf(file: File, kind: SourceKind) {
  if (kind === "text") return "text/plain";
  if (kind === "html") return "text/html";
  if (kind === "pdf") return "application/pdf";
  if (kind === "audio")
    return /\.m4a$/i.test(file.name)
      ? "audio/mp4"
      : /\.mp3$/i.test(file.name)
        ? "audio/mpeg"
        : /\.wav$/i.test(file.name)
          ? "audio/wav"
          : /\.ogg$/i.test(file.name)
            ? "audio/ogg"
            : "audio/webm";
  return /\.png$/i.test(file.name)
    ? "image/png"
    : /\.webp$/i.test(file.name)
      ? "image/webp"
      : "image/jpeg";
}
async function audioDuration(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0)
          reject(
            new Error(
              "This audio file has no readable duration. Use a supported file with duration metadata.",
            ),
          );
        else resolve(Math.ceil(audio.duration * 1000));
        audio.src = "";
      };
      audio.onerror = () => reject(new Error("This browser cannot read that audio format."));
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function SourcesView({
  sessionId,
  userId,
  sources,
  contract,
  noticeAccepted: initiallyAccepted,
  storageConfigured,
}: {
  sessionId: string;
  userId: string;
  sources: SourceRow[];
  contract: InputContract;
  noticeAccepted: boolean;
  storageConfigured: boolean;
}) {
  const router = useRouter(),
    fileInput = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  const [accepted, setAccepted] = useState(initiallyAccepted),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [message, setMessage] = useState(""),
    [previous, setPrevious] = useState<OwnSource[]>([]),
    [reuse, setReuse] = useState("");
  const [localAudio, setLocalAudio] = useState<Set<string> | null>(null);
  useEffect(() => {
    let active = true;
    new IndexedRecordingStore()
      .list(userId)
      .then((rows) => {
        if (active) setLocalAudio(new Set(rows.map((row) => row.sourceAssetId ?? row.id)));
      })
      .catch(() => {
        if (active) setLocalAudio(new Set());
      });
    return () => {
      active = false;
    };
  }, [userId]);
  const waiting = sources.some(
    (source) =>
      ["pending", "verifying"].includes(source.uploadState ?? "") ||
      ["needs_password", "wrong_password"].includes(source.rejectionReason ?? ""),
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [waiting, router]);
  async function action(effect: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem("");
    try {
      await effect();
      router.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function notice() {
    await workspaceRequest("/api/sources/notice", "POST", {
      version: contract.noticeVersion,
      confirmed,
    });
    setAccepted(true);
    setMessage("Source notice accepted.");
  }
  async function upload(file: File) {
    if (/\.(heic|heif)$/i.test(file.name) || ["image/heic", "image/heif"].includes(file.type)) {
      if (file.size > contract.formats.image.maxBytes)
        throw new Error("This image exceeds the source size limit.");
      setMessage("Converting the HEIC photo to JPEG on this device…");
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(file);
        if (bitmap.width * bitmap.height > (contract.formats.image.maxPixels ?? 0))
          throw new Error("This image exceeds the pixel limit.");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image conversion unavailable");
        context.drawImage(bitmap, 0, 0);
        const jpeg = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Image conversion unavailable"))),
            "image/jpeg",
            0.92,
          ),
        );
        file = new File([jpeg], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
          type: "image/jpeg",
        });
      } catch {
        throw new Error(
          "This browser cannot convert that HEIC photo. Convert it to JPEG, then add it again.",
        );
      } finally {
        bitmap?.close();
      }
    }
    const kind = kindOf(file);
    if (!kind)
      throw new Error(
        "Choose audio, JPEG, PNG, WebP, PDF, HTML or plain text. Convert HEIC images to JPEG first.",
      );
    if (file.size <= 0 || file.size > contract.formats[kind].maxBytes)
      throw new Error("The file is empty or exceeds the source limit.");
    if (kind !== "audio" && !storageConfigured)
      throw new Error("Private file storage has not been configured yet.");
    setMessage("Checking the file…");
    const sha256 = await checksum(file),
      mimeType = mimeOf(file, kind),
      durationMs = kind === "audio" ? await audioDuration(file) : undefined;
    if (durationMs && durationMs > (contract.formats.audio.maxDurationMs ?? 0))
      throw new Error("This audio file exceeds the duration limit.");
    const parts: { index: number; sizeBytes: number; sha256: string }[] = [];
    if (kind !== "audio")
      for (let start = 0; start < file.size; start += contract.partBytes) {
        const part = file.slice(start, start + contract.partBytes);
        parts.push({ index: parts.length, sizeBytes: part.size, sha256: await checksum(part) });
      }
    const matches = await workspaceRequest<OwnSource[]>(`/api/sources?checksum=${sha256}`, "GET");
    const resumable = matches.find(
      (source) =>
        source.kind === kind &&
        source.uploadState === "pending" &&
        source.uploadId &&
        !source.original_deleted_at,
    );
    const created = resumable
      ? { assetId: resumable.id, uploadId: resumable.uploadId }
      : await workspaceRequest<{ assetId: string; uploadId: string | null }>(
          "/api/sources",
          "POST",
          {
            sessionId,
            kind,
            mimeType,
            sizeBytes: file.size,
            sha256,
            displayName: file.name,
            ...(durationMs ? { durationMs } : {}),
            parts,
          },
          crypto.randomUUID(),
        );
    if (resumable)
      await workspaceRequest(`/api/classes/${sessionId}/sources`, "POST", {
        assetId: created.assetId,
      });
    if (kind === "audio") {
      const local = new IndexedRecordingStore(),
        now = new Date().toISOString();
      const manifest = {
        id: created.assetId,
        userId,
        sessionId,
        mimeType,
        status: "saved" as const,
        createdAt: now,
        updatedAt: now,
        activeMs: durationMs ?? 0,
        chunks: 0,
        bytes: 0,
        creationKey: crypto.randomUUID(),
        sourceAssetId: created.assetId,
      };
      await local.put(manifest);
      await local.append(manifest, file);
      setLocalAudio((previous) => new Set([...(previous ?? []), created.assetId]));
      setMessage("Audio saved on this device. It will be sent only after you confirm processing.");
      return;
    }
    if (!created.uploadId) throw new Error("The upload could not be created.");
    const uploadId = created.uploadId;
    const manifest = await workspaceRequest<{
      parts: { index: number; verifiedAt: string | null }[];
    }>(`/api/sources/uploads/${uploadId}`, "GET");
    for (const part of parts) {
      if (manifest.parts.find((value) => value.index === part.index)?.verifiedAt) continue;
      setMessage(`Uploading part ${part.index + 1} of ${parts.length}…`);
      const link = await workspaceRequest<{ url: string }>(
        `/api/sources/uploads/${uploadId}/parts/${part.index}`,
        "GET",
      );
      await uploadWithConfirmation(
        () =>
          fetch(link.url, {
            method: "PUT",
            headers: { "Content-Type": mimeType },
            body: file.slice(
              part.index * contract.partBytes,
              (part.index + 1) * contract.partBytes,
            ),
          }),
        () => workspaceRequest(`/api/sources/uploads/${uploadId}/parts/${part.index}`, "POST"),
        "Upload interrupted. Select the same file to resume.",
      );
    }
    await workspaceRequest(`/api/sources/uploads/${uploadId}/complete`, "POST");
    setMessage("File uploaded. Server verification is in progress.");
  }
  async function change(source: SourceRow, patch: Partial<SourceRow>) {
    await workspaceRequest(`/api/classes/${sessionId}/sources/${source.assetId}`, "PATCH", {
      role: source.role,
      selected: source.selected,
      ranges: source.ranges,
      timeStatus: source.timeStatus,
      contentVersionId: source.contentVersionId,
      ...patch,
    });
  }
  return (
    <div className="preview-stack">
      <Link className="preview-back" href={`/classes/${sessionId}`}>
        ← Back to class
      </Link>
      <Actions>
        <LinkButton href={`/classes/${sessionId}/record`}>Record class</LinkButton>
        <Button secondary disabled={busy || !accepted} onClick={() => fileInput.current?.click()}>
          Add files
        </Button>
        <Button
          secondary
          disabled={busy || !accepted}
          onClick={() =>
            action(async () => {
              setPrevious(await workspaceRequest<OwnSource[]>("/api/sources", "GET"));
              setMessage("Choose an existing source below.");
            })
          }
        >
          Use an existing source
        </Button>
      </Actions>
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept=".m4a,.mp3,.wav,.webm,.ogg,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.html,.htm,.txt"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void action(async () => {
            for (const file of files) await upload(file);
          });
        }}
      />
      {!accepted ? (
        <Panel title="Before adding sources">
          <p>
            Sources are used to create notes and cards for your private study. Audio stays on this
            device; a temporary server copy is used only for transcription. Other files are stored
            privately.
          </p>
          <p>Follow your institution’s rules for recording and using class materials.</p>
          <label className="preview-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I have the right to use these materials for private study.
          </label>
          <Actions>
            <Button disabled={!confirmed || busy} onClick={() => action(notice)}>
              Accept and continue
            </Button>
          </Actions>
        </Panel>
      ) : null}
      {!storageConfigured ? (
        <Status>
          Private file storage is being configured. Audio can still be saved on this device.
        </Status>
      ) : null}
      {previous.length ? (
        <Panel title="Your existing sources">
          <Field label="Source">
            <select value={reuse} onChange={(event) => setReuse(event.target.value)}>
              <option value="">Choose a source</option>
              {previous.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            disabled={busy || !reuse}
            onClick={() =>
              action(async () => {
                await workspaceRequest(`/api/classes/${sessionId}/sources`, "POST", {
                  assetId: reuse,
                });
                setPrevious([]);
                setReuse("");
                setMessage("Source added without uploading it again.");
              })
            }
          >
            Add to this class
          </Button>
        </Panel>
      ) : null}
      {problem ? (
        <Status tone="error">{problem}</Status>
      ) : message ? (
        <Status>{message}</Status>
      ) : null}
      <Panel title="Class sources">
        {!sources.length ? (
          <div className="preview-empty">
            <h3>Add your first source</h3>
            <p>Bring together your recording, handouts, photos and notes.</p>
          </div>
        ) : (
          <ul className="preview-list">
            {sources.map((source) => (
              <SourceItem
                key={source.assetId}
                source={source}
                busy={busy}
                localAvailable={localAudio === null ? null : localAudio.has(source.assetId)}
                unlock={(password) =>
                  action(async () => {
                    await workspaceRequest(`/api/sources/${source.assetId}/unlock`, "POST", {
                      password,
                    });
                    setMessage("Trying the password. It is not stored.");
                  })
                }
                deleteSource={(mode) =>
                  action(async () => {
                    await workspaceRequest(`/api/sources/${source.assetId}`, "DELETE", { mode });
                    if (mode === "all" && ["audio", "image"].includes(source.kind)) {
                      const local = new IndexedRecordingStore();
                      const recordings = await local.list(userId);
                      for (const recording of recordings) {
                        if (
                          source.kind === "audio" &&
                          (recording.sourceAssetId === source.assetId ||
                            recording.id === source.assetId)
                        )
                          await local.remove(userId, recording.id);
                        if (source.kind === "image")
                          for (const photo of await local.photos(userId, recording.id))
                            if (photo.sourceAssetId === source.assetId)
                              await local.removePhoto(userId, recording.id, photo.id);
                      }
                    }
                    setMessage(
                      mode === "original"
                        ? "Original file deleted. The saved extraction is retained."
                        : "Source deleted from all classes.",
                    );
                  })
                }
                change={(patch) => action(() => change(source, patch))}
                remove={() =>
                  action(async () => {
                    await workspaceRequest(
                      `/api/classes/${sessionId}/sources/${source.assetId}`,
                      "DELETE",
                    );
                    setMessage("Source removed from this class.");
                  })
                }
                read={() =>
                  action(async () => {
                    const link = await workspaceRequest<{ url: string }>(
                      `/api/sources/${source.assetId}/read`,
                      "GET",
                    );
                    window.open(link.url, "_blank", "noopener,noreferrer");
                  })
                }
              />
            ))}
          </ul>
        )}
      </Panel>
      <Actions>
        <LinkButton href={`/classes/${sessionId}/estimate`}>Continue to processing</LinkButton>
      </Actions>
      <p className="preview-muted">
        Changing sources creates a new source version. Existing notes and cards stay as they are.
      </p>
    </div>
  );
}
function SourceItem({
  source,
  busy,
  change,
  remove,
  read,
  unlock,
  localAvailable,
  deleteSource,
}: {
  source: SourceRow;
  busy: boolean;
  change: (patch: Partial<SourceRow>) => Promise<void>;
  remove: () => Promise<void>;
  read: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  localAvailable: boolean | null;
  deleteSource: (mode: "original" | "all") => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const needsPassword = ["needs_password", "wrong_password"].includes(source.rejectionReason ?? "");
  const [start, setStart] = useState(
      String(
        source.kind === "audio"
          ? (source.ranges[0]?.start ?? 0) / 1000
          : (source.ranges[0]?.start ?? 1),
      ),
    ),
    [end, setEnd] = useState(
      String(
        (source.ranges[0]?.end ??
          (source.kind === "audio"
            ? (source.durationMs ?? 0)
            : (source.pageCount ?? (source.kind === "image" ? 1 : 0)))) /
          (source.kind === "audio" ? 1000 : 1),
      ),
    );
  const status = source.originalDeletedAt
    ? "Original file is no longer kept"
    : source.kind === "audio"
      ? localAvailable === null
        ? "Checking this device…"
        : localAvailable
          ? "On this device — not sent for processing"
          : "Original audio is not on this device"
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
  return (
    <li>
      <div className="preview-row">
        <label className="preview-check">
          <input
            type="checkbox"
            checked={source.selected}
            disabled={busy || !ready}
            onChange={(event) => void change({ selected: event.target.checked })}
          />
          <strong dir="auto">{source.displayName}</strong>
        </label>
        <span className="preview-muted">
          {source.kind} · {(source.sizeBytes / 1_000_000).toFixed(1)} MB
        </span>
      </div>
      <p className="preview-muted">{status}</p>
      {source.anchorSourceId && source.captureOffsetMs !== null && (
        <div className="preview-stack">
          <p className="preview-muted">
            Taken around {(source.captureOffsetMs / 1000).toFixed(1)} seconds into the recording
            {source.captureState === "paused" ? " while recording was paused" : ""} ·{" "}
            {source.timeStatus === "user_confirmed" ? "Time confirmed by you" : "Estimated time"}
          </p>
          {source.timeStatus !== "user_confirmed" && (
            <Button
              secondary
              disabled={busy}
              onClick={() => void change({ timeStatus: "user_confirmed" })}
            >
              Confirm this photo time
            </Button>
          )}
        </div>
      )}
      {needsPassword ? (
        <>
          <Field label="PDF password" hint="Used for this unlock attempt only. It is never stored.">
            <input
              type="password"
              value={password}
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Actions>
            <Button
              secondary
              disabled={busy || !password}
              onClick={() => {
                const value = password;
                setPassword("");
                void unlock(value);
              }}
            >
              Unlock PDF
            </Button>
          </Actions>
        </>
      ) : null}
      <div className="preview-grid">
        <Field label="Source role">
          <select
            value={source.role}
            disabled={busy}
            onChange={(event) => void change({ role: event.target.value })}
          >
            <option value="class_audio">Class teaching</option>
            <option value="board_photo">Board photo</option>
            <option value="class_material">Class material</option>
            <option value="user_notes">My notes</option>
          </select>
        </Field>
        {ready && ["audio", "pdf"].includes(source.kind) ? (
          <>
            <Field label={source.kind === "audio" ? "Start (seconds)" : "Start page"}>
              <input
                type="number"
                min={source.kind === "audio" ? 0 : 1}
                step={source.kind === "audio" ? 0.1 : 1}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </Field>
            <Field label={source.kind === "audio" ? "End (seconds)" : "End page"}>
              <input
                type="number"
                min={source.kind === "audio" ? 0.1 : 1}
                step={source.kind === "audio" ? 0.1 : 1}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </Field>
          </>
        ) : null}
      </div>
      <Actions>
        {ready && ["audio", "pdf"].includes(source.kind) ? (
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              void change({
                ranges: [
                  {
                    start: Math.round(Number(start) * (source.kind === "audio" ? 1000 : 1)),
                    end: Math.round(Number(end) * (source.kind === "audio" ? 1000 : 1)),
                  },
                ],
              })
            }
          >
            Save range
          </Button>
        ) : null}
        {source.verifiedAt && !source.originalDeletedAt ? (
          <Button secondary disabled={busy} onClick={() => void read()}>
            Open original
          </Button>
        ) : null}
        <Button secondary disabled={busy} onClick={() => void remove()}>
          Remove from class
        </Button>
      </Actions>
      <details>
        <summary>Delete options</summary>
        <p className="preview-muted">
          Deleting the original file keeps its saved extraction. Deleting the entire source removes
          it from every class.
        </p>
        <label className="preview-check">
          <input
            type="checkbox"
            checked={deleteConfirmed}
            onChange={(event) => setDeleteConfirmed(event.target.checked)}
          />
          I understand that deletion cannot be undone.
        </label>
        <Actions>
          {source.kind !== "audio" && source.contentVersionId && !source.originalDeletedAt ? (
            <Button
              secondary
              disabled={busy || !deleteConfirmed}
              onClick={() => void deleteSource("original")}
            >
              Delete original file
            </Button>
          ) : null}
          <Button
            secondary
            disabled={busy || !deleteConfirmed}
            onClick={() => void deleteSource("all")}
          >
            Delete entire source
          </Button>
        </Actions>
      </details>
    </li>
  );
}
