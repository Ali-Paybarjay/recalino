"use client";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileSelectionQueue } from "../components/FileSelectionQueue";
import { UploadProgress } from "../components/UploadProgress";
import { IndexedRecordingStore } from "../recording/store";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import { requestKey, workspaceRequest } from "./api";
import {
  type AutomaticLearningStatus,
  inAutomaticLearningBatch,
  notifyAutomaticLearning,
  pendingLearningBatch,
} from "./automatic-learning";
import { declaredUploadIssues } from "./declared-upload-issues";
import { type FileProcessingReceipt, fileProcessingFeedback } from "./file-processing";
import { appendSelectedFiles, type SelectedFile, selectedFileProblem } from "./file-selection";
import { openOriginalTab } from "./open-original";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
import type { SourceRow } from "./source-types";
import { useUploads } from "./UploadProvider";
import type { UploadEntry } from "./upload-store";

export type { SourceRow } from "./source-types";

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
  const recentSources = new Map(fileUploads.map((file, index) => [file.source?.assetId, index]));
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
    )
    .sort((a, b) => (recentSources.get(b.assetId) ?? -1) - (recentSources.get(a.assetId) ?? -1));
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
  const waiting =
    batch?.active ||
    processingBatch ||
    visibleSources.some(
      (source) =>
        ["pending", "verifying"].includes(source.uploadState ?? "") ||
        ["needs_password", "wrong_password"].includes(source.rejectionReason ?? ""),
    );
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [waiting, router]);
  useEffect(() => {
    if (!selectedFiles.length) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [selectedFiles.length]);
  async function action(effect: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem("");
    setOriginalLink(null);
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
    <div className="preview-stack">
      <Link className="preview-back" href={`/sessions/${sessionId}`}>
        ← Back to session
      </Link>
      <Actions>
        <LinkButton href={`/sessions/${sessionId}/record`}>Record a session</LinkButton>
        <Button
          secondary
          disabled={!interactive || busy || !accepted}
          onClick={() => fileInput.current?.click()}
        >
          {visibleSources.length || selectedFiles.length ? "Add More Files" : "Add Files"}
        </Button>
        <Button
          secondary
          disabled={!interactive || busy || !accepted}
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
      {!accepted ? (
        <Panel title="Before adding sources">
          <p>
            Choosing Upload &amp; Process creates and saves your session notes and flashcards. Audio
            remains on this device, with a temporary copy uploaded for transcription. Other files
            are stored privately.
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
                  <>
                    {feedback.retry && (
                      <Button disabled={busy} onClick={() => void action(retryProcessing)}>
                        Retry processing
                      </Button>
                    )}
                    <LinkButton secondary href={`/sessions/${sessionId}/estimate`}>
                      Review processing
                    </LinkButton>
                  </>
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
                await inAutomaticLearningBatch(userId, sessionId, () =>
                  workspaceRequest(`/api/classes/${sessionId}/sources`, "POST", { assetId: reuse }),
                );
                setPrevious([]);
                setReuse("");
                setMessage("Source added without uploading it again.");
              })
            }
          >
            Add to this session
          </Button>
        </Panel>
      ) : null}
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
      <Panel title="Session sources">
        <p className="preview-muted">
          File formats are detected automatically. During processing, Recalino identifies session
          audio, board photos, session material and notes from their content. Use the whole file or
          choose part of a PDF or audio recording.
        </p>
        {batch?.active ? (
          <Status>
            Sending saved file {batch.current} of {batch.total}. You can use other pages.
          </Status>
        ) : null}
        {!visibleSources.length && !pendingFiles.length ? (
          <div className="preview-empty">
            <h3>Add your first source</h3>
            <p>Bring together your recording, handouts, photos and notes.</p>
          </div>
        ) : (
          <ul className="preview-list" ref={uploadList}>
            {pendingFiles
              .slice()
              .reverse()
              .map((file) => (
                <FileUploadItem
                  key={file.id}
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
              ))}
            {listedSources.map((source) => (
              <SourceItem
                key={source.assetId}
                source={source}
                busy={busy}
                removeLabel={declaredEntry(source.assetId) ? "Skip this file" : undefined}
                deletionBlocked={!!declaredEntry(source.assetId)}
                selectionDirty={selectionDirty}
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
                        : "Source deleted from all sessions.",
                    );
                  })
                }
                change={(patch) => action(() => change(source, patch))}
                remove={() =>
                  action(async () => {
                    const entry = declaredEntry(source.assetId);
                    if (entry && declaredBatch) {
                      if (await uploads.manager.skip(declaredBatch.id, entry.id)) {
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
                    forgetSource(source.assetId);
                    setFileUploads((previous) =>
                      previous.filter((file) => file.source?.assetId !== source.assetId),
                    );
                    setMessage("Source removed from this session.");
                  })
                }
                read={() => openOriginal(source)}
              />
            ))}
          </ul>
        )}
      </Panel>
      {!receipt && learning.status && learning.status.state !== "idle" && (
        <Status tone={learning.status.state === "blocked" ? "error" : "neutral"}>
          {learning.status.message}
        </Status>
      )}
      {!receipt && learning.problem && <Status tone="error">{learning.problem}</Status>}
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
        <nav aria-label="Session learning" className="preview-actions">
          <Link href={`/sessions/${sessionId}/notes`} className="preview-index-link">
            Read session notes
          </Link>
          {learning.status.cardsReady && (
            <Link href={`/sessions/${sessionId}/cards`} className="preview-index-link">
              Flashcards
            </Link>
          )}
        </nav>
      )}
      {unsavedSelections.size > 0 ? (
        <Status>Save your file selection to use it in the automatic update.</Status>
      ) : null}
      <p className="preview-muted">
        Choose Upload &amp; Process when all your files are selected. Your earlier notes stay
        available while added material is processed.
      </p>
    </div>
  );
}
function FileUploadItem({
  file,
  busy,
  remove,
  retry,
}: {
  file: FileUpload;
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
    <li aria-busy={active || undefined} className="preview-upload-file">
      <div className="preview-row">
        <strong dir="auto">{file.displayName}</strong>
        <span className="preview-muted">{(file.sizeBytes / 1_000_000).toFixed(1)} MB</span>
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
              <Button disabled={busy} onClick={retry}>
                Retry saved file
              </Button>
            )}
            <Button secondary disabled={busy} onClick={remove}>
              {retry ? "Skip this file" : file.source ? "Remove from session" : "Dismiss"}
            </Button>
          </Actions>
        </>
      ) : null}
    </li>
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
  selectionDirty,
  removeLabel,
  deletionBlocked,
}: {
  source: SourceRow;
  busy: boolean;
  change: (patch: Partial<SourceRow>) => Promise<void>;
  remove: () => Promise<void>;
  read: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  localAvailable: boolean | null;
  deleteSource: (mode: "original" | "all") => Promise<void>;
  selectionDirty: (assetId: string, dirty: boolean) => void;
  removeLabel?: string;
  deletionBlocked?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
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
          {source.kind === "audio"
            ? "Class audio"
            : source.role === "board_photo"
              ? "Board photo"
              : source.role === "user_notes"
                ? "Notes"
                : source.kind}{" "}
          · {(source.sizeBytes / 1_000_000).toFixed(1)} MB
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
      {ready && supportsRange ? (
        <form
          className="preview-stack"
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
          <fieldset disabled={busy} className="preview-source-selection preview-stack">
            <legend>Use for processing</legend>
            <div className="preview-row">
              <label className="preview-check">
                <input
                  type="radio"
                  name={`extent-${source.assetId}`}
                  checked={!partial}
                  onChange={() => setPartial(false)}
                />
                Whole file
              </label>
              <label className="preview-check">
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
              <div className="preview-grid">
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
            <Button secondary disabled={busy || !dirty} type="submit">
              Save selection
            </Button>
          </Actions>
          <p className="preview-muted">
            This saves what to use for your next processing run. The original file stays intact.
          </p>
        </form>
      ) : null}
      <Actions>
        {(isAudio ? localAvailable === true : source.verifiedAt && !source.originalDeletedAt) ? (
          <Button secondary disabled={busy} onClick={() => void read()}>
            Open original
          </Button>
        ) : null}
        <Button secondary disabled={busy} onClick={() => void remove()}>
          {removeLabel ?? "Remove from session"}
        </Button>
      </Actions>
      <details>
        <summary>Delete options</summary>
        {deletionBlocked && (
          <p className="preview-muted">
            Skip this file or cancel its upload group before deleting the source.
          </p>
        )}
        <p className="preview-muted">
          Deleting the original file keeps its saved extraction. Deleting the entire source removes
          it from every session.
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
              disabled={busy || !deleteConfirmed || deletionBlocked}
              onClick={() => void deleteSource("original")}
            >
              Delete original file
            </Button>
          ) : null}
          <Button
            secondary
            disabled={busy || !deleteConfirmed || deletionBlocked}
            onClick={() => void deleteSource("all")}
          >
            Delete entire source
          </Button>
        </Actions>
      </details>
    </li>
  );
}
