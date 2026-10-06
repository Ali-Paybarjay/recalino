"use client";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { Amounts } from "@recalino/core/quota";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { IndexedRecordingStore } from "../recording/store";
import { requestKey, workspaceRequest } from "./api";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";
import {
  isRetryableUploadFailure,
  retryUploadRequest,
  type UploadRecovery,
  uploadWithConfirmation,
} from "./upload";

const interruptedAudio =
  "The audio connection is still unavailable after automatic retries. Your recording is saved on this device. Reconnect or resume the upload.";

export interface ProcessingEstimate {
  snapshot: RunSnapshot;
  selectionFingerprint?: string;
  requested: Amounts | null;
  allowance: { remaining: Amounts };
  providerConfigured: boolean;
  models: { language: string; image: string; transcription: string } | null;
}
type EstimateProblem =
  | "no_selected_sources"
  | "sources_not_ready"
  | "selection_too_large"
  | "unavailable";
async function sha256(blob: Blob) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export function ProcessingView({
  sessionId,
  userId,
  initialEstimate,
  initialEstimateProblem = null,
  initialRuns,
  sourcesVersion,
  contract,
}: {
  sessionId: string;
  userId: string;
  initialEstimate: ProcessingEstimate | null;
  initialEstimateProblem?: EstimateProblem | null;
  initialRuns: ProcessingRun[];
  sourcesVersion?: number;
  contract: InputContract | null;
}) {
  const router = useRouter();
  const key = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const recoverable = useRef(true);
  const automaticAttempt = useRef<string | null>(null);
  const uploaded = useRef(new Set<string>());
  const [estimate, setEstimate] = useState(initialEstimate),
    [estimateProblem, setEstimateProblem] = useState(initialEstimateProblem),
    [runs, setRuns] = useState(initialRuns),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [online, setOnline] = useState(true),
    [visible, setVisible] = useState(true),
    [recoveryEvent, setRecoveryEvent] = useState(0),
    [error, setError] = useState<string | null>(null),
    [progressError, setProgressError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const latest = runs[0];
  const active = latest && ["awaiting_upload", "queued", "processing"].includes(latest.state);
  const completed = latest && ["ready", "partial_ready"].includes(latest.state);
  const selectionChanged =
    !!latest &&
    (estimate?.selectionFingerprint && latest.selectionFingerprint
      ? estimate.selectionFingerprint !== latest.selectionFingerprint
      : (estimate?.snapshot.sourcesVersion ?? sourcesVersion ?? latest.sourcesVersion) !==
        latest.sourcesVersion);
  const awaitingOperator =
    latest?.state === "needs_input" &&
    !["new_confirmation_required", "audio_upload_rejected"].includes(latest.lastError ?? "");
  const showConfirmation = !active && !awaitingOperator && (!completed || selectionChanged);
  const audioUploaded = !!latest && uploaded.current.has(latest.id);
  const previousSelection =
    selectionChanged &&
    !active &&
    !completed &&
    !awaitingOperator &&
    latest?.lastError !== "provider_outcome_unresolved";
  useEffect(() => {
    setEstimate(initialEstimate);
    setEstimateProblem(initialEstimateProblem);
    setRuns(initialRuns);
  }, [initialEstimate, initialEstimateProblem, initialRuns]);
  const refreshProcessing = useCallback(async () => {
    const next = await workspaceRequest<ProcessingRun[]>(
      `/api/classes/${sessionId}/processing`,
      "GET",
    );
    setRuns(next);
    setProgressError(null);
    if (next[0] && !["awaiting_upload", "queued", "processing"].includes(next[0].state)) {
      try {
        const nextEstimate = await workspaceRequest<ProcessingEstimate>(
          `/api/classes/${sessionId}/estimate`,
          "GET",
        );
        setEstimate(nextEstimate);
        setEstimateProblem(null);
      } catch {
        setEstimate(null);
        setEstimateProblem("unavailable");
      }
      router.refresh();
    }
  }, [sessionId, router]);
  const progressUnavailable = useCallback(() => {
    setProgressError(
      "Progress could not be refreshed. Your confirmed job is saved; checking will resume automatically.",
    );
  }, []);
  useEffect(() => {
    const connected = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) setRecoveryEvent((event) => event + 1);
    };
    const shown = () => {
      setVisible(document.visibilityState === "visible");
      if (document.visibilityState === "visible") setRecoveryEvent((event) => event + 1);
    };
    setOnline(navigator.onLine);
    setVisible(document.visibilityState === "visible");
    window.addEventListener("online", connected);
    window.addEventListener("offline", connected);
    document.addEventListener("visibilitychange", shown);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", connected);
      document.removeEventListener("visibilitychange", shown);
      uploadController.current?.abort();
    };
  }, []);
  const resumePendingUpload = useEffectEvent((attempt: string) => {
    if (
      latest?.state !== "awaiting_upload" ||
      !estimate ||
      !contract ||
      !online ||
      !visible ||
      inFlight.current ||
      !recoverable.current ||
      uploaded.current.has(latest.id)
    )
      return;
    if (automaticAttempt.current === attempt) return;
    automaticAttempt.current = attempt;
    void action(() => sendLocalAudio(latest, true));
  });
  const readyForUpload = !!estimate && !!contract;
  useEffect(() => {
    if (latest?.state === "awaiting_upload" && readyForUpload && online && visible && !busy)
      resumePendingUpload(`${latest.id}:${recoveryEvent}`);
  }, [latest?.id, latest?.state, readyForUpload, online, visible, busy, recoveryEvent]);
  useEffect(() => {
    if (latest?.state !== "awaiting_upload") {
      setMessage(null);
      if (recoverable.current) setError(null);
    }
  }, [latest?.state]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void refreshProcessing().catch(progressUnavailable);
    }, 3000);
    return () => clearInterval(timer);
  }, [active, refreshProcessing, progressUnavailable]);
  function action(effect: () => Promise<void>): Promise<void> {
    // React state updates are asynchronous. This ref blocks rapid double clicks
    // and reconnect/visibility events from starting overlapping uploads.
    if (inFlight.current) return inFlight.current;
    setBusy(true);
    setError(null);
    setMessage(null);
    const task = Promise.resolve()
      .then(effect)
      .catch((failure: unknown) => {
        setMessage(null);
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        recoverable.current = isRetryableUploadFailure(failure);
        setError(failure instanceof Error ? failure.message : "Processing could not start.");
      })
      .finally(() => {
        inFlight.current = null;
        setBusy(false);
      });
    inFlight.current = task;
    return task;
  }
  async function sendLocalAudio(run: ProcessingRun, resume = false) {
    if (!contract || !estimate)
      throw new Error("Source settings are unavailable. Keep the local recording and try again.");
    const controller = new AbortController();
    uploadController.current = controller;
    automaticAttempt.current = `${run.id}:${recoveryEvent}`;
    setUploading(true);
    const recovery: UploadRecovery = {
      attempts: 3,
      signal: controller.signal,
      onRetry: (attempt) =>
        setMessage(`Connection interrupted. Retrying audio upload (${attempt} of 3)…`),
      onOffline: () =>
        setMessage(
          "You are offline. Your recording is saved; upload will resume when you reconnect.",
        ),
    };
    const request = <T,>(path: string, method: string, body?: unknown, idempotencyKey?: string) =>
      retryUploadRequest(
        (signal) => workspaceRequest<T>(path, method, body, idempotencyKey, { signal }),
        interruptedAudio,
        recovery,
      );
    try {
      const store = new IndexedRecordingStore();
      const rows = await store.list(userId);
      for (const source of estimate.snapshot.sources.filter(
        (source) => source.kind === "audio" && !source.contentVersionId && !source.objectId,
      )) {
        const local = rows.find(
          (row) => row.sourceAssetId === source.sourceId || row.id === source.sourceId,
        );
        if (!local)
          throw new Error(
            "A selected recording is missing from this device. Open the device that saved it, or remove it from the selection.",
          );
        const blob = await store.blob(userId, local.id);
        controller.signal.throwIfAborted();
        if ((await sha256(blob)) !== source.sha256)
          throw new Error("The local recording does not match the selected source.");
        const parts: { index: number; sizeBytes: number; sha256: string }[] = [];
        for (let offset = 0; offset < blob.size; offset += contract.partBytes) {
          controller.signal.throwIfAborted();
          const part = blob.slice(offset, offset + contract.partBytes);
          parts.push({ index: parts.length, sizeBytes: part.size, sha256: await sha256(part) });
        }
        const started = await request<{ uploadId: string }>(
          `/api/sources/${source.sourceId}/audio`,
          "POST",
          { action: "start", runId: run.id, reservationId: run.reservationId, parts },
          `audio-start:${run.id}:${source.sourceId}`,
        );
        const manifest = await request<{
          parts: { index: number; verifiedAt: string | null }[];
        }>(`/api/sources/${source.sourceId}/audio?uploadId=${started.uploadId}`, "GET");
        for (const part of parts) {
          if (manifest.parts.some((p) => p.index === part.index && p.verifiedAt)) continue;
          setMessage(`Uploading audio part ${part.index + 1} of ${parts.length}…`);
          await uploadWithConfirmation(
            async (signal) => {
              // Every retry gets a fresh signed URL after checking the stored part.
              const link = await workspaceRequest<{ url: string }>(
                `/api/sources/${source.sourceId}/audio?uploadId=${started.uploadId}&index=${part.index}`,
                "GET",
                undefined,
                undefined,
                { signal },
              );
              return fetch(link.url, {
                method: "PUT",
                headers: { "content-type": source.mimeType },
                signal,
                body: blob.slice(
                  part.index * contract.partBytes,
                  Math.min(blob.size, (part.index + 1) * contract.partBytes),
                ),
              });
            },
            (signal) =>
              workspaceRequest(
                `/api/sources/${source.sourceId}/audio`,
                "POST",
                {
                  action: "confirm_part",
                  runId: run.id,
                  uploadId: started.uploadId,
                  index: part.index,
                },
                undefined,
                { signal },
              ),
            interruptedAudio,
            { ...recovery, confirmBeforeWrite: resume, confirmSuccess: true },
          );
        }
        setMessage("All audio parts are uploaded. Starting verification…");
        await request(
          `/api/sources/${source.sourceId}/audio`,
          "POST",
          { action: "complete", runId: run.id, uploadId: started.uploadId },
          `audio-complete:${run.id}:${source.sourceId}`,
        );
      }
      uploaded.current.add(run.id);
      setMessage("Audio uploaded for verification. The original is still on this device.");
      await refreshProcessing().catch(progressUnavailable);
    } finally {
      if (uploadController.current === controller) uploadController.current = null;
      setUploading(false);
    }
  }
  async function cancelProcessing(run: ProcessingRun) {
    uploadController.current?.abort();
    await inFlight.current;
    await action(async () => {
      const canceled = await workspaceRequest<ProcessingRun>(`/api/runs/${run.id}`, "DELETE");
      setRuns((previous) => [canceled, ...previous.filter((row) => row.id !== canceled.id)]);
      setEstimate(await workspaceRequest(`/api/classes/${sessionId}/estimate`, "GET"));
      setEstimateProblem(null);
    });
  }
  async function confirm() {
    if (!estimate) return;
    const body = {
      expectedFingerprint: estimate.snapshot.fingerprint,
      expectedSourcesVersion: estimate.snapshot.sourcesVersion,
    };
    const run = await workspaceRequest<ProcessingRun>(
      `/api/classes/${sessionId}/processing`,
      "POST",
      body,
      requestKey(key, body),
    );
    key.current = null;
    setRuns((previous) => [run, ...previous.filter((row) => row.id !== run.id)]);
    if (run.state === "awaiting_upload") await sendLocalAudio(run);
    router.replace(`/classes/${sessionId}/processing`);
  }
  const enough =
    !!estimate?.requested &&
    Object.entries(estimate.requested).every(
      ([dimension, needed]) =>
        needed <= (estimate.allowance.remaining[dimension as keyof Amounts] ?? 0),
    );
  const verifiedAudioNeedsConfirmation =
    latest?.lastError === "new_confirmation_required" &&
    !previousSelection &&
    !!estimate?.snapshot.sources.some((source) => source.kind === "audio") &&
    estimate.snapshot.sources
      .filter((source) => source.kind === "audio")
      .every((source) => source.objectId || source.contentVersionId);
  return (
    <div className="preview-stack">
      {error ? <Status tone="error">{error}</Status> : null}
      {progressError && active ? <Status tone="error">{progressError}</Status> : null}
      {message ? <Status>{message}</Status> : null}
      {latest && !active ? (
        <Panel
          title={
            previousSelection
              ? "Previous attempt"
              : completed
                ? "Class notes created"
                : verifiedAudioNeedsConfirmation
                  ? "Audio verified — confirm to create notes"
                  : "Latest result"
          }
          tone={showConfirmation ? "plain" : "hero"}
        >
          <p role="status">
            {previousSelection
              ? "Your sources have changed since this attempt. Review the current selection below."
              : latest.state === "ready"
                ? "Your class is ready."
                : latest.state === "partial_ready"
                  ? "A partial result is ready. Some selected material could not be extracted."
                  : latest.state === "cancelled"
                    ? "Processing cancelled. Unused allowance was released."
                    : verifiedAudioNeedsConfirmation
                      ? "Upload and verification are complete. Confirm below to start creating your class notes."
                      : "Processing needs attention. Your saved class and earlier notes are available."}
          </p>
          {completed ? (
            <>
              <p className="preview-muted">Step 3 of 3 · Read notes and prepare flashcards</p>
              <p>
                Next, read and save your class notes. Then prepare flashcards from the learning
                items and add the cards you want to practise.
              </p>
            </>
          ) : null}
          {latest.lastError && !previousSelection ? (
            <Status tone={verifiedAudioNeedsConfirmation ? "neutral" : "error"}>
              {awaitingOperator || latest.lastError === "provider_outcome_unresolved"
                ? "A provider result is still being checked. Contact the operator before retrying."
                : latest.lastError === "new_confirmation_required"
                  ? verifiedAudioNeedsConfirmation
                    ? "Your audio is uploaded and verified. Note creation has not started. Review the allowance below and confirm to create your class notes; you do not need to upload the audio again."
                    : "The verified source has changed. Review the selected sources and allowance before confirming again."
                  : latest.lastError === "audio_upload_rejected"
                    ? "The audio could not be verified. Review the selected audio, then retry with the saved original on this device or replace it."
                    : "The selected material could not finish processing. Check your sources, then confirm a new attempt."}
            </Status>
          ) : null}
          <Actions>
            {completed ? (
              <>
                <LinkButton href={`/classes/${sessionId}/notes`}>Read class notes</LinkButton>
                <LinkButton secondary href={`/classes/${sessionId}/cards`}>
                  Make flashcards
                </LinkButton>
              </>
            ) : null}
            <LinkButton secondary href={`/classes/${sessionId}/sources`}>
              {completed ? "Add or change material" : "Change sources"}
            </LinkButton>
            <Link href={`/classes/${sessionId}`}>Back to class</Link>
          </Actions>
        </Panel>
      ) : null}
      {active ? (
        <Panel tone="hero" title="Preparing your class">
          <p className="preview-muted">
            {latest.state === "awaiting_upload"
              ? "Step 1 of 3 · Upload and verify material"
              : "Step 2 of 3 · Create class notes"}
          </p>
          <p role="status">
            {latest.state === "awaiting_upload"
              ? audioUploaded
                ? "Upload complete. Verifying your audio before processing starts automatically."
                : "Waiting for selected audio to be uploaded and verified."
              : latest.state === "queued"
                ? "Queued. You can leave this page; progress is saved."
                : "Extracting the selected sources and building your class notes."}
          </p>
          <p>
            When processing finishes, select Read class notes. Save the notes, then choose the
            learning items to turn into flashcards.
          </p>
          <Actions>
            {latest.state === "awaiting_upload" && !audioUploaded ? (
              <Button
                disabled={busy}
                onClick={() => void action(() => sendLocalAudio(latest, true))}
              >
                {uploading
                  ? online
                    ? "Uploading audio…"
                    : "Waiting for connection…"
                  : "Resume audio upload"}
              </Button>
            ) : null}
            <LinkButton secondary href={`/classes/${sessionId}`}>
              Continue to class
            </LinkButton>
            <Button
              secondary
              disabled={busy && !uploading}
              onClick={() => void cancelProcessing(latest)}
            >
              Cancel processing
            </Button>
          </Actions>
        </Panel>
      ) : showConfirmation ? (
        <Panel tone="hero" title="Check before processing">
          {!estimate ? (
            <>
              <p role="status">
                {estimateProblem === "no_selected_sources"
                  ? "No material is selected for this class. Add or select saved material before processing."
                  : estimateProblem === "sources_not_ready"
                    ? "Some selected files are still being verified. Wait for verification, or change the selected sources."
                    : estimateProblem === "selection_too_large"
                      ? "The selected material is too large to process together. Select fewer files or smaller ranges."
                      : "The processing estimate could not be loaded. Your saved material is still available. Try again."}
              </p>
              <Actions>
                {(!estimateProblem ||
                  ["unavailable", "sources_not_ready"].includes(estimateProblem)) && (
                  <Button disabled={busy} onClick={() => router.refresh()}>
                    Check again
                  </Button>
                )}
                <LinkButton href={`/classes/${sessionId}/sources`}>
                  {estimateProblem === "no_selected_sources"
                    ? "Add or select material"
                    : "Review sources"}
                </LinkButton>
              </Actions>
            </>
          ) : (
            <>
              <p>
                Confirm below to create class notes from your selected material. After processing,
                you can read and save the notes, then prepare flashcards. Audio leaves this device
                for transcription after you confirm.
              </p>
              <ul>
                {estimate.snapshot.sources.map((source) => (
                  <li key={source.sourceId}>
                    {source.kind} ·{" "}
                    {source.durationMs
                      ? `${Math.ceil(source.durationMs / 60000)} minutes`
                      : source.pageCount
                        ? `${source.pageCount} pages`
                        : `${source.blocks.length} text blocks`}
                    {source.ranges.length
                      ? ` · ${source.ranges
                          .map((range) =>
                            source.kind === "audio"
                              ? `${range.start / 1000}–${range.end / 1000} seconds`
                              : `pages ${range.start}–${range.end}`,
                          )
                          .join(", ")}`
                      : " · whole file"}
                  </li>
                ))}
              </ul>
              {estimate.requested ? (
                <p>
                  Allowance used on successful publication:{" "}
                  {Math.ceil(estimate.requested.audio / 60)} audio minutes,{" "}
                  {estimate.requested.document} pages, {estimate.requested.regeneration}{" "}
                  regeneration.
                </p>
              ) : null}
              {!estimate.providerConfigured ? (
                <Status>AI is awaiting operator configuration. Your sources remain saved.</Status>
              ) : !enough ? (
                <Status>More allowance is needed. Recording and review remain available.</Status>
              ) : null}
              {estimate.models ? (
                <details>
                  <summary>Processing models</summary>
                  <p>
                    {estimate.models.language} · {estimate.models.transcription} ·{" "}
                    {estimate.models.image}
                  </p>
                </details>
              ) : null}
              <Actions>
                <Button
                  disabled={busy || !estimate.providerConfigured || !enough || awaitingOperator}
                  onClick={() => void action(confirm)}
                >
                  {busy
                    ? "Starting…"
                    : latest?.lastError === "new_confirmation_required"
                      ? "Review and confirm"
                      : latest?.lastError === "audio_upload_rejected"
                        ? "Review and retry"
                        : latest &&
                            !selectionChanged &&
                            ["failed", "cancelled"].includes(latest.state)
                          ? "Retry processing"
                          : "Confirm and process"}
                </Button>
                <LinkButton secondary href={`/classes/${sessionId}/sources`}>
                  Change sources
                </LinkButton>
              </Actions>
            </>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
