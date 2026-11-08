"use client";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button as SmallButton } from "../components/Button";
import { FileSelectionQueue } from "../components/FileSelectionQueue";
import { UploadProgress } from "../components/UploadProgress";
import { Plus } from "../icons";
import { IndexedRecordingStore } from "../recording/store";
import { AllowanceActions, AllowanceRequest } from "./AllowanceActions";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import { requestKey, userMessage, workspaceRequest } from "./api";
import {
  type AutomaticLearningStatus,
  inAutomaticLearningBatch,
  notifyAutomaticLearning,
  pendingLearningBatch,
} from "./automatic-learning";
import { declaredUploadIssues } from "./declared-upload-issues";
import { type FileProcessingReceipt, fileProcessingFeedback } from "./file-processing";
import { appendSelectedFiles, type SelectedFile, selectedFileProblem } from "./file-selection";
import { sessionMaterialRows } from "./material-order";
import { openOriginalTab } from "./open-original";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
import styles from "./SessionMaterial.module.css";
import { FileUploadItem, SourceItem } from "./SessionMaterialItems";
import { addMaterialLabel } from "./session-material-copy";
import { showsThumbnail, useSourceThumbnails } from "./source-thumbnails";
import type { SourceRow } from "./source-types";
import { useUploads } from "./UploadProvider";
import type { UploadEntry } from "./upload-store";

export type { SourceRow } from "./source-types";

/** How long the page keeps refreshing for the result of a PDF unlock attempt. */
const UNLOCK_REFRESH_MS = 60_000;

interface OwnSource {
  id: string;
  display_name: string;
  kind: string;
  uploadId: string | null;
  uploadState: string | null;
  original_deleted_at: string | null;
}
type FileUpload = UploadEntry;

export function SourcesView({
  sessionId,
  userId,
  sources,
  contract,
  noticeAccepted: initiallyAccepted,
  storageConfigured,
  withStatus = false,
}: {
  sessionId: string;
  userId: string;
  sources: SourceRow[];
  contract: InputContract;
  noticeAccepted: boolean;
  storageConfigured: boolean;
  /**
   * The session status card is shown above on the same page; its retry and recovery actions are
   * not repeated here (one place for material and status).
   */
  withStatus?: boolean;
}) {
  const router = useRouter(),
    fileInput = useRef<HTMLInputElement>(null),
    uploadList = useRef<HTMLUListElement>(null),
    lock = useRef(false);
  const processingRetryKey = useRef<{ payload: string; key: string } | null>(null);
  const learning = useAutomaticLearning(sessionId);
  const uploads = useUploads(sessionId);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const managedBatch = uploads.batches.at(-1);
  const declaredBatch = uploads.batches.find(
    (row) => row.id === learning.status?.batchId && row.phase !== "cancelled",
  );
  const declaredEntry = (assetId: string) =>
    declaredBatch?.entries.find(
      (entry) => entry.phase !== "skipped" && entry.source?.assetId === assetId,
    );
  const verificationIssues = declaredUploadIssues(
    declaredBatch,
    sources,
    learning.status?.lastError ?? null,
  );
  const localSavedIds =
    managedBatch?.entries
      .filter((entry) => entry.phase === "local_saved")
      .map((entry) => entry.source?.assetId)
      .filter(Boolean)
      .join(",") ?? "";
  const [interruptedBatch, setInterruptedBatch] = useState(false);
  useEffect(() => {
    setInterruptedBatch(!!pendingLearningBatch(userId, sessionId));
  }, [userId, sessionId]);
  const [accepted, setAccepted] = useState(initiallyAccepted),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [message, setMessage] = useState(""),
    [previous, setPrevious] = useState<OwnSource[]>([]),
    [reuse, setReuse] = useState("");
  const [localAudio, setLocalAudio] = useState<Set<string> | null>(null);
  // When the last unlock attempt was sent; its result arrives without a state change to wait on.
  const [unlockSentAt, setUnlockSentAt] = useState<number | null>(null);
  const localOriginalUrls = useRef(new Map<string, string>());
  const originalViewActive = useRef(true);
  const [originalLink, setOriginalLink] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => {
    originalViewActive.current = true;
    const urls = localOriginalUrls.current;
    return () => {
      originalViewActive.current = false;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  const [fileUploads, setFileUploads] = useState<FileUpload[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [receipt, setReceipt] = useState<FileProcessingReceipt | null>(null);
  const [batch, setBatch] = useState<{ total: number; current: number; active: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!managedBatch) return;
    if (managedBatch.phase === "cancelled") {
      setFileUploads([]);
      setBatch(null);
      setReceipt(null);
      setMessage("Saved upload cancelled. You can add another file.");
      return;
    }
    setFileUploads(managedBatch.entries.filter((entry) => entry.phase !== "skipped"));
    setBatch({
      total: managedBatch.entries.length,
      current: Math.min(
        managedBatch.entries.length,
        managedBatch.entries.filter((entry) =>
          ["local_saved", "verifying", "complete", "skipped"].includes(entry.phase),
        ).length + 1,
      ),
      active: ["queued", "uploading"].includes(managedBatch.phase),
    });
    setReceipt({
      ...managedBatch.receipt,
      ...(managedBatch.problem ? { problem: managedBatch.problem } : {}),
    });
  }, [managedBatch]);
  useEffect(() => {
    setFileUploads((previous) => {
      let changed = false;
      const next = previous.map((file) => {
        if (
          file.serverSeen ||
          !file.source ||
          !sources.some((source) => source.assetId === file.source?.assetId)
        )
          return file;
        changed = true;
        return { ...file, serverSeen: true };
      });
      return changed ? next : previous;
    });
  }, [sources]);
  const visibleSources = [
    ...sources,
    ...fileUploads.flatMap((file) =>
      file.source &&
      !file.serverSeen &&
      !sources.some((source) => source.assetId === file.source?.assetId)
        ? [file.source]
        : [],
    ),
  ];
  const feedback = receipt
    ? fileProcessingFeedback(receipt, learning.status, visibleSources)
    : null;
  const processingBatch = feedback?.state === "processing";
  const pendingFiles = fileUploads.filter((file) => {
    if (file.phase === "failed" && selectedFiles.some((selected) => selected.id === file.id))
      return false;
    if (["queued", "checking", "uploading", "saving", "failed"].includes(file.phase)) return true;
    if (["complete", "local_saved", "skipped"].includes(file.phase)) return false;
    const source = visibleSources.find((source) => source.assetId === file.source?.assetId);
    return (
      !!source && !source.verifiedAt && !source.rejectionReason && source.uploadState !== "rejected"
    );
  });
  // Listed in class order (material-order.ts, D106); uploads on their way follow the saved rows.
  const listedSources = visibleSources
    .filter((source) => !pendingFiles.some((file) => file.source?.assetId === source.assetId))
    .filter(
      (source) =>
        !fileUploads.some(
          (file) =>
            file.phase === "failed" &&
            file.source?.assetId === source.assetId &&
            selectedFiles.some((selected) => selected.id === file.id),
        ),
    );
  const thumbnails = useSourceThumbnails(userId, listedSources);
  const [unsavedSelections, setUnsavedSelections] = useState(() => new Set<string>());
  const selectionDirty = useCallback((assetId: string, dirty: boolean) => {
    setUnsavedSelections((previous) => {
      if (previous.has(assetId) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(assetId);
      else next.delete(assetId);
      return next;
    });
  }, []);
  useEffect(() => {
    let active = true;
    new IndexedRecordingStore()
      .list(userId)
      .then((rows) => {
        if (active)
          setLocalAudio(
            new Set([
              ...rows.map((row) => row.sourceAssetId ?? row.id),
              ...localSavedIds.split(",").filter(Boolean),
            ]),
          );
      })
      .catch(() => {
        if (active) setLocalAudio(new Set());
      });
    return () => {
      active = false;
    };
  }, [userId, localSavedIds]);
  const passwordNeeded = visibleSources.some((source) =>
    ["needs_password", "wrong_password"].includes(source.rejectionReason ?? ""),
  );
  const waiting =
    batch?.active ||
    processingBatch ||
    (passwordNeeded && unlockSentAt !== null) ||
    visibleSources.some((source) => ["pending", "verifying"].includes(source.uploadState ?? ""));
  useEffect(() => {
    if (unlockSentAt === null) return;
    const timer = setTimeout(() => setUnlockSentAt(null), UNLOCK_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [unlockSentAt]);
  useEffect(() => {
    // Each refresh renders the page on the server again. A hidden or offline page reads nothing;
    // returning to it reads once. A file waiting for its password waits for the learner, so it
    // refreshes on a timer only after an unlock attempt.
    if (!waiting && !passwordNeeded) return;
    const refresh = () => {
      if (!document.hidden && navigator.onLine) router.refresh();
    };
    const timer = waiting ? setInterval(refresh, 3000) : undefined;
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [waiting, passwordNeeded, router]);
  useEffect(() => {
    if (!selectedFiles.length) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [selectedFiles.length]);
  /** Runs one change at a time; resolves to whether it was saved. */
  async function action(effect: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setProblem("");
    setOriginalLink(null);
    try {
      await effect();
      router.refresh();
      return true;
    } catch (error) {
      setProblem(userMessage(error, "The change could not be saved."));
      return false;
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
    setMessage("Material notice accepted.");
  }
  function openOriginal(source: SourceRow) {
    return action(async () => {
      setMessage("Opening original…");
      const result = await openOriginalTab(async () => {
        if (source.kind === "audio") {
          const store = new IndexedRecordingStore();
          const recordings = await store.list(userId);
          if (!originalViewActive.current) throw new Error("Original opening was cancelled.");
          const recording = recordings.find(
            (row) => (row.sourceAssetId ?? row.id) === source.assetId,
          );
          if (!recording)
            throw new Error(
              "The original audio is not on this device. Open the device that saved it to play the original.",
            );
          const existing = localOriginalUrls.current.get(source.assetId);
          if (existing) return existing;
          const blob = await store.blob(userId, recording.id);
          if (!originalViewActive.current) throw new Error("Original opening was cancelled.");
          const url = URL.createObjectURL(blob);
          localOriginalUrls.current.set(source.assetId, url);
          return url;
        }
        const link = await workspaceRequest<{ url: string }>(
          `/api/sources/${source.assetId}/read`,
          "GET",
        );
        return link.url;
      });
      if (!result.opened) {
        setOriginalLink({ url: result.url, name: source.displayName });
        setMessage("Your original is ready. Select Open file below to open it.");
      } else setMessage("Original opened in a new tab.");
    });
  }
  async function addFiles(files: SelectedFile[]) {
    if (!files.length || files.some((file) => file.invalid)) return;
    setMessage("Saving your upload on this device…");
    await uploads.manager.enqueue(sessionId, files, contract, storageConfigured);
    setSelectedFiles((previous) =>
      previous.filter((entry) => !files.some((file) => file.id === entry.id)),
    );
    setMessage(
      "Files saved. You can use other pages while they upload. If your browser pauses, upload resumes when you return.",
    );
  }
  async function resumeProcessing() {
    if (selectedFiles.length) return addFiles(selectedFiles);
    setReceipt((previous) => (previous ? { ...previous, problem: undefined } : null));
    setMessage(
      "Resuming your upload. Verification and processing progress will update automatically.",
    );
    try {
      await inAutomaticLearningBatch(userId, sessionId, async () => {}, workspaceRequest, {
        onCompleted: (status) =>
          setReceipt((previous) =>
            previous
              ? {
                  ...previous,
                  revision: status.revision,
                  confirmedRunId: status.state === "ready" ? status.run?.id : null,
                }
              : previous,
          ),
      });
    } catch (error) {
      setReceipt((previous) =>
        previous
          ? {
              ...previous,
              problem:
                "Processing could not be resumed. Check your connection, then choose Resume processing again.",
            }
          : previous,
      );
      throw error;
    } finally {
      setInterruptedBatch(Boolean(pendingLearningBatch(userId, sessionId)));
    }
  }
  async function retryProcessing() {
    const body = { action: "retry" };
    const status = await workspaceRequest<AutomaticLearningStatus>(
      `/api/classes/${sessionId}/learning`,
      "POST",
      body,
      requestKey(processingRetryKey, body),
    );
    processingRetryKey.current = null;
    setReceipt((previous) =>
      previous
        ? {
            ...previous,
            revision: status.revision,
            confirmedRunId: status.state === "ready" ? status.run?.id : null,
            problem: undefined,
          }
        : previous,
    );
    notifyAutomaticLearning(sessionId);
  }
  function forgetSource(assetId: string) {
    setReceipt((previous) => {
      if (!previous?.sourceIds.includes(assetId)) return previous;
      const sourceIds = previous.sourceIds.filter((id) => id !== assetId);
      return sourceIds.length ? { ...previous, sourceIds, total: previous.total - 1 } : null;
    });
  }
  function removeSelectedFile(id: string) {
    const entry = fileUploads.find((file) => file.id === id);
    const remove = () => {
      setSelectedFiles((previous) => previous.filter((file) => file.id !== id));
      setFileUploads((previous) => previous.filter((file) => file.id !== id));
      setReceipt((previous) => {
        if (!previous || entry?.phase !== "failed") return previous;
        return previous.sourceIds.length
          ? { ...previous, failed: Math.max(0, previous.failed - 1), total: previous.total - 1 }
          : null;
      });
    };
    if (entry?.source)
      void action(async () => {
        await workspaceRequest(
          `/api/classes/${sessionId}/sources/${entry.source?.assetId}`,
          "DELETE",
        );
        remove();
      });
    else remove();
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
    await workspaceRequest(`/api/classes/${sessionId}/learning`, "POST", { action: "sync" });
    notifyAutomaticLearning(sessionId);
    if (patch.ranges)
      setMessage(
        patch.ranges.length
          ? "Selected range saved. Your notes and flashcards will update automatically."
          : "The whole file will be used. Your notes and flashcards will update automatically.",
      );
  }
  return (
    <div className="workspace-stack" id="session-material">
      {withStatus ? null : (
        <Link className="workspace-back" href={`/sessions/${sessionId}`}>
          ← Back to session
        </Link>
      )}
      {/* UX-13: the one tick that unlocks adding files comes before the buttons it unlocks. */}
      {!accepted ? (
        <Panel title="Before adding material">
          <p>
            Choosing Upload &amp; Process creates and saves your session notes and flashcards. Audio
            remains on this device, with a temporary copy uploaded for transcription. Other files
            are stored privately.
          </p>
          <p>Follow your institution’s rules for recording and using class materials.</p>
          <label className="workspace-check">
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
      <Actions>
        <LinkButton href={`/sessions/${sessionId}/record`}>Record a session</LinkButton>
      </Actions>
      <input
        ref={fileInput}
        type="file"
        hidden
        aria-label="Choose session files"
        disabled={!interactive || busy || !accepted}
        multiple
        accept=".m4a,.mp3,.wav,.webm,.ogg,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.html,.htm,.xhtml,.txt"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length)
            setSelectedFiles((previous) =>
              appendSelectedFiles(previous, files).map((entry) => {
                const problem = selectedFileProblem(entry.file, contract);
                return problem ? { ...entry, problem, invalid: true } : entry;
              }),
            );
        }}
      />
      {!storageConfigured ? (
        <Status>
          Private file storage is being configured. Audio can still be saved on this device.
        </Status>
      ) : null}
      {receipt && feedback && (
        <Panel title={batch?.active ? "Uploading your files" : "File processing"}>
          {batch?.active || processingBatch ? (
            <div aria-busy="true">
              <UploadProgress
                label="Session file processing progress"
                status={
                  batch?.active
                    ? `Uploading file ${batch.current} of ${batch.total}…`
                    : feedback.message
                }
                detail={
                  batch?.active
                    ? "You can use other pages while these saved files upload. Processing continues on the server after receiving them."
                    : feedback.detail
                }
                startedAt={receipt.startedAt}
              />
              {batch?.active && message && <Status>{message}</Status>}
            </div>
          ) : feedback.state === "awaiting_process" ? (
            // D107: the files wait for Process this session (the session card above has it).
            <Status tone="neutral">{feedback.message}</Status>
          ) : (
            <>
              <Status tone={feedback.state === "success" ? "success" : "error"}>
                {feedback.message} {feedback.detail}
              </Status>
              <Actions>
                {feedback.state === "success" ? (
                  <>
                    <LinkButton href={`/sessions/${sessionId}/notes`}>
                      Read session notes
                    </LinkButton>
                    <LinkButton secondary href={`/sessions/${sessionId}/cards`}>
                      Flashcards
                    </LinkButton>
                  </>
                ) : (
                  !withStatus && (
                    <>
                      {feedback.retry && (
                        <Button disabled={busy} onClick={() => void action(retryProcessing)}>
                          Retry processing
                        </Button>
                      )}
                      <AllowanceRequest block={feedback.allowance} />
                      <LinkButton secondary href={`/sessions/${sessionId}/estimate`}>
                        Review processing
                      </LinkButton>
                    </>
                  )
                )}
              </Actions>
            </>
          )}
          {learning.problem && (
            <>
              <Status tone="error">
                Progress could not be checked. Your files are saved. Check your connection and try
                again.
              </Status>
              <Button secondary disabled={busy} onClick={() => void action(learning.refresh)}>
                Check progress again
              </Button>
            </>
          )}
        </Panel>
      )}
      {problem ? (
        <Status tone="error">{problem}</Status>
      ) : message && !receipt ? (
        <Status>{message}</Status>
      ) : null}
      {originalLink ? (
        <Actions>
          <a
            className="btn btn-secondary rc-btn-lg"
            href={originalLink.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open file: ${originalLink.name}`}
          >
            Open file
          </a>
        </Actions>
      ) : null}
      {declaredBatch && verificationIssues.length > 0 && (
        <Panel title="Resolve uploaded files">
          <p>
            Some uploaded files could not finish verification. Enter a PDF password below, skip a
            file, or cancel this upload group before choosing replacements.
          </p>
          {verificationIssues
            .filter(
              (entry) => !listedSources.some((source) => source.assetId === entry.source?.assetId),
            )
            .map((entry) => (
              <div key={entry.id}>
                <strong dir="auto">{entry.displayName}</strong>
                <p>
                  This saved upload entry needs attention. Skip it or cancel the group to select a
                  replacement.
                </p>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await uploads.manager.skip(declaredBatch.id, entry.id);
                      await learning.refresh();
                    })
                  }
                >
                  Skip this file
                </Button>
              </div>
            ))}
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await uploads.manager.cancel(declaredBatch.id);
                await learning.refresh();
              })
            }
          >
            Cancel saved upload
          </Button>
        </Panel>
      )}
      <Panel title="Session material">
        <p className="workspace-muted">
          Files added to this session. Checked files are used to create your notes and flashcards.
        </p>
        {!visibleSources.length && !pendingFiles.length ? (
          <div className="workspace-empty">
            <h3>Add your first material</h3>
            <p>Bring together your recording, handouts, photos and notes.</p>
          </div>
        ) : (
          <ul className="workspace-list" ref={uploadList}>
            {sessionMaterialRows(listedSources, pendingFiles).map((row) => {
              if (row.type === "pending") {
                const file = row.file;
                return (
                  <FileUploadItem
                    key={row.key}
                    file={file}
                    busy={busy}
                    retry={
                      managedBatch
                        ? () => void action(() => uploads.manager.retry(managedBatch.id, file.id))
                        : undefined
                    }
                    remove={() => {
                      if (
                        managedBatch?.entries.some(
                          (entry) => entry.id === file.id && entry.phase === "failed",
                        )
                      ) {
                        void action(async () => {
                          await uploads.manager.skip(managedBatch.id, file.id);
                        });
                        return;
                      }
                      if (selectedFiles.some((entry) => entry.id === file.id)) {
                        removeSelectedFile(file.id);
                        return;
                      }
                      if (!file.source) {
                        setFileUploads((previous) =>
                          previous.filter((entry) => entry.id !== file.id),
                        );
                        return;
                      }
                      void action(async () => {
                        await workspaceRequest(
                          `/api/classes/${sessionId}/sources/${file.source?.assetId}`,
                          "DELETE",
                        );
                        if (file.source) forgetSource(file.source.assetId);
                        setFileUploads((previous) =>
                          previous.filter((entry) => entry.id !== file.id),
                        );
                      });
                    }}
                  />
                );
              }
              const source = row.source;
              return (
                <SourceItem
                  key={row.key}
                  source={source}
                  busy={busy}
                  removeLabel={declaredEntry(source.assetId) ? "Skip this file" : undefined}
                  deletionBlocked={!!declaredEntry(source.assetId)}
                  selectionDirty={selectionDirty}
                  localAvailable={localAudio === null ? null : localAudio.has(source.assetId)}
                  problem={problem}
                  picture={thumbnails.picture(source.assetId)}
                  pictureTile={showsThumbnail(source) ? thumbnails.tile(source.assetId) : undefined}
                  pictureFailed={(url) => thumbnails.failed(source.assetId, url)}
                  unlock={(password) =>
                    action(async () => {
                      await workspaceRequest(`/api/sources/${source.assetId}/unlock`, "POST", {
                        password,
                      });
                      setUnlockSentAt(Date.now());
                      setMessage("Trying the password. It is not stored.");
                    })
                  }
                  deleteSource={(mode) =>
                    action(async () => {
                      await workspaceRequest(`/api/sources/${source.assetId}`, "DELETE", { mode });
                      thumbnails.forget(source.assetId);
                      if (mode === "all") forgetSource(source.assetId);
                      if (mode === "all") {
                        const url = localOriginalUrls.current.get(source.assetId);
                        if (url) URL.revokeObjectURL(url);
                        localOriginalUrls.current.delete(source.assetId);
                      }
                      setFileUploads((previous) =>
                        previous.filter((file) => file.source?.assetId !== source.assetId),
                      );
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
                          : "Material deleted from all sessions.",
                      );
                    })
                  }
                  change={(patch) => action(() => change(source, patch))}
                  remove={() =>
                    action(async () => {
                      const entry = declaredEntry(source.assetId);
                      if (entry && declaredBatch) {
                        if (await uploads.manager.skip(declaredBatch.id, entry.id)) {
                          thumbnails.forget(source.assetId);
                          forgetSource(source.assetId);
                          setMessage("File skipped from this upload group.");
                        }
                        await learning.refresh();
                        return;
                      }
                      await workspaceRequest(
                        `/api/classes/${sessionId}/sources/${source.assetId}`,
                        "DELETE",
                      );
                      thumbnails.forget(source.assetId);
                      forgetSource(source.assetId);
                      setFileUploads((previous) =>
                        previous.filter((file) => file.source?.assetId !== source.assetId),
                      );
                      setMessage("Material removed from this session.");
                    })
                  }
                  read={() => openOriginal(source)}
                />
              );
            })}
          </ul>
        )}
        <div className={styles.add}>
          <SmallButton
            block
            icon={Plus}
            disabled={!interactive || busy || !accepted}
            onClick={() => fileInput.current?.click()}
          >
            {addMaterialLabel({
              saved: visibleSources.length,
              pending: pendingFiles.length,
              selected: selectedFiles.length,
            })}
          </SmallButton>
          <SmallButton
            variant="ghost"
            disabled={!interactive || busy || !accepted}
            onClick={() =>
              action(async () => {
                setPrevious(await workspaceRequest<OwnSource[]>("/api/sources", "GET"));
                setMessage("Choose existing material below.");
              })
            }
          >
            Use existing material
          </SmallButton>
        </div>
      </Panel>
      {accepted && (
        <FileSelectionQueue
          files={selectedFiles}
          busy={busy}
          disabled={!!batch?.active || unsavedSelections.size > 0}
          label={
            selectedFiles.some((file) => file.problem && !file.invalid)
              ? "Retry Upload & Process"
              : "Upload & Process"
          }
          remove={removeSelectedFile}
          submit={() => void action(() => addFiles(selectedFiles))}
        />
      )}
      {previous.length ? (
        <Panel title="Your existing material">
          <Field label="Material">
            <select value={reuse} onChange={(event) => setReuse(event.target.value)}>
              <option value="">Choose material</option>
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
                await inAutomaticLearningBatch(userId, sessionId, () =>
                  workspaceRequest(`/api/classes/${sessionId}/sources`, "POST", { assetId: reuse }),
                );
                setPrevious([]);
                setReuse("");
                setMessage("Material added without uploading it again.");
              })
            }
          >
            Add to this session
          </Button>
        </Panel>
      ) : null}
      {!withStatus && !receipt && learning.status && learning.status.state !== "idle" && (
        <Status tone={learning.status.state === "blocked" ? "error" : "neutral"}>
          {learning.status.message}
        </Status>
      )}
      {/* Without this device's upload receipt, an allowance stop still names its next step. */}
      {!withStatus && !receipt && (
        <AllowanceActions
          status={learning.status}
          busy={busy}
          onRetry={() => void action(retryProcessing)}
        />
      )}
      {!withStatus && !receipt && learning.problem && (
        <Status tone="error">{learning.problem}</Status>
      )}
      {interruptedBatch && (
        <Panel title="Resume an interrupted upload">
          <Status>
            An earlier upload was interrupted. Select any remaining files, then choose Resume
            processing. If every file was sent, resume without selecting them again.
          </Status>
          <Button
            disabled={busy || selectedFiles.some((file) => file.invalid)}
            onClick={() => void action(resumeProcessing)}
          >
            Resume processing
          </Button>
        </Panel>
      )}
      {learning.status?.notesReady && (
        <nav aria-label="Session learning" className="workspace-actions">
          <Link href={`/sessions/${sessionId}/notes`} className="workspace-index-link">
            Read session notes
          </Link>
          {learning.status.cardsReady && (
            <Link href={`/sessions/${sessionId}/cards`} className="workspace-index-link">
              Flashcards
            </Link>
          )}
        </nav>
      )}
      {unsavedSelections.size > 0 ? (
        <Status>Save your file selection to use it in the automatic update.</Status>
      ) : null}
      <p className="workspace-muted">
        Choose Upload &amp; Process when all your files are selected. Your earlier notes stay
        available while added material is processed.
      </p>
    </div>
  );
}
