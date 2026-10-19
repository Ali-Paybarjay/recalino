"use client";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { Amounts } from "@recalino/core/quota";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { pendingClassRecordings } from "../recording/processing-readiness";
import { IndexedRecordingStore } from "../recording/store";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import { requestKey, userMessage, workspaceRequest } from "./api";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";
import { sourceKindLabel } from "./source-labels";
import { isRetryableUploadFailure } from "./upload";
import { uploadCopy } from "./upload-copy";

/** Awaiting-upload stops whose saved device original can be sent again with a new attempt. */
const AUDIO_UPLOAD_RETRY_CODES: readonly string[] = [
  "audio_upload_rejected",
  "audio_upload_not_started",
  "audio_upload_incomplete",
];

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
  const background = useAutomaticLearning(sessionId);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const recoverable = useRef(true);
  const automaticAttempt = useRef<string | null>(null);
  const [estimate, setEstimate] = useState(initialEstimate),
    [estimateProblem, setEstimateProblem] = useState(initialEstimateProblem),
    [runs, setRuns] = useState(initialRuns),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true),
    [visible, setVisible] = useState(true),
    [recoveryEvent, setRecoveryEvent] = useState(0),
    [error, setError] = useState<string | null>(null),
    [progressError, setProgressError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const latest = runs[0];
  const transfer = background.manualAudio.find((entry) => entry.runId === latest?.id);
  const uploading = transfer?.phase === "uploading";
  const [pendingRecordings, setPendingRecordings] = useState(0);
  useEffect(() => {
    let disposed = false;
    const local = new IndexedRecordingStore();
    const check = async () => {
      try {
        const rows = await local.list(userId);
        if (!disposed) setPendingRecordings(pendingClassRecordings(rows, sessionId).length);
      } catch {
        /* Confirmation rechecks local readiness before making a server request. */
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [sessionId, userId]);
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
    !["new_confirmation_required", ...AUDIO_UPLOAD_RETRY_CODES].includes(latest.lastError ?? "");
  const operatorMessage =
    latest?.lastError === "provider_timestamps_invalid"
      ? "The transcription service returned invalid timing information. Processing has stopped. Your saved session and earlier notes are available. Contact the operator to review this attempt before retrying."
      : ["provider_outcome_unknown", "provider_outcome_unresolved"].includes(
            latest?.lastError ?? "",
          )
        ? "The result of a processing request could not be confirmed. Processing is paused. Contact the operator before retrying."
        : "Processing is paused and needs an operator review before retrying. Your saved session and earlier notes are available.";
  const outputMessage =
    latest?.lastError === "provider_output_truncated"
      ? "The generated response was incomplete. No new session notes were saved. Retry processing to create a complete result."
      : latest?.lastError?.startsWith("output_") ||
          latest?.lastError === "knowledge_repair_exhausted"
        ? "The generated notes could not be verified against your chosen language and selected sources. No new notes were saved. Retry processing to create a new result."
        : null;
  const showConfirmation = !active && !awaitingOperator && (!completed || selectionChanged);
  const audioUploaded = transfer?.phase === "verifying";
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
    };
  }, []);
  const resumePendingUpload = useEffectEvent((attempt: string) => {
    if (
      latest?.state !== "awaiting_upload" ||
      !contract ||
      !online ||
      !visible ||
      inFlight.current ||
      !recoverable.current ||
      transfer
    )
      return;
    if (automaticAttempt.current === attempt) return;
    automaticAttempt.current = attempt;
    void action(() => sendLocalAudio(latest));
  });
  const readyForUpload = !!contract;
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
    // A hidden or offline page reads nothing; checking resumes when it is shown or reconnects.
    if (!active || !visible || !online) return;
    const timer = setInterval(() => {
      void refreshProcessing().catch(progressUnavailable);
    }, 3000);
    return () => clearInterval(timer);
  }, [active, visible, online, refreshProcessing, progressUnavailable]);
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
        setError(userMessage(failure, "Processing could not start."));
      })
      .finally(() => {
        inFlight.current = null;
        setBusy(false);
      });
    inFlight.current = task;
    return task;
  }
  async function sendLocalAudio(run: ProcessingRun) {
    if (!contract)
      throw new Error("Source settings are unavailable. Keep the local recording and try again.");
    const pending = background.manualAudio.find((entry) => entry.runId === run.id);
    if (pending) {
      if (pending.phase === "attention") await background.retryManualAudio(run.id);
      return;
    }
    const confirmed = await workspaceRequest<{ run: ProcessingRun; snapshot: RunSnapshot | null }>(
      `/api/runs/${run.id}?includeSnapshot=1`,
      "GET",
    );
    if (confirmed.run.state !== "awaiting_upload") {
      setRuns((previous) => [
        confirmed.run,
        ...previous.filter((row) => row.id !== confirmed.run.id),
      ]);
      return;
    }
    if (!confirmed.snapshot)
      throw new Error(
        "The confirmed audio selection is unavailable. Review processing and try again.",
      );
    await background.queueManualAudio(confirmed.run, confirmed.snapshot, contract);
    setMessage(
      "Audio upload is saved. You can leave this page; upload continues while the app is open and resumes when you return.",
    );
  }
  async function cancelProcessing(run: ProcessingRun) {
    await inFlight.current;
    await action(async () => {
      const canceled = await background.cancelManualAudio(run.id);
      setRuns((previous) => [canceled, ...previous.filter((row) => row.id !== canceled.id)]);
      setEstimate(await workspaceRequest(`/api/classes/${sessionId}/estimate`, "GET"));
      setEstimateProblem(null);
    });
  }
  async function confirm() {
    if (!estimate) return;
    const pending = pendingClassRecordings(
      await new IndexedRecordingStore().list(userId),
      sessionId,
    );
    setPendingRecordings(pending.length);
    if (pending.length) {
      setError(
        "Wait for every recorded part to finish saving and be added to this session before confirming processing.",
      );
      return;
    }
    const current = await workspaceRequest<ProcessingEstimate>(
      `/api/classes/${sessionId}/estimate`,
      "GET",
    );
    if (
      current.snapshot.fingerprint !== estimate.snapshot.fingerprint ||
      current.snapshot.sourcesVersion !== estimate.snapshot.sourcesVersion
    ) {
      setEstimate(current);
      setError(
        "The session material has changed. Review the updated estimate and confirm again to include the saved recording parts.",
      );
      return;
    }
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
    router.replace(`/sessions/${sessionId}/processing`);
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
      {message || transfer?.message ? <Status>{message ?? transfer?.message}</Status> : null}
      {transfer?.problem ? <Status tone="error">{transfer.problem}</Status> : null}
      {latest && !active ? (
        <Panel
          title={
            previousSelection
              ? "Previous attempt"
              : completed
                ? "Session notes created"
                : verifiedAudioNeedsConfirmation
                  ? "Audio verified — confirm to create notes"
                  : "Latest result"
          }
          tone={showConfirmation ? "plain" : "hero"}
        >
          <p role="status">
            {previousSelection
              ? "Your material has changed since this attempt. Review the current selection below."
              : latest.state === "ready"
                ? "Your session is ready."
                : latest.state === "partial_ready"
                  ? "A partial result is ready. Some selected material could not be extracted."
                  : latest.state === "cancelled"
                    ? "Processing cancelled. Unused allowance was released."
                    : verifiedAudioNeedsConfirmation
                      ? "Upload and verification are complete. Confirm below to start creating your session notes."
                      : "Processing needs attention. Your saved session and earlier notes are available."}
          </p>
          {completed ? (
            <>
              <p className="preview-muted">Step 3 of 3 · Read notes and prepare flashcards</p>
              <p>
                Next, read and save your session notes. Then prepare flashcards from the learning
                items and add the cards you want to practise.
              </p>
            </>
          ) : null}
          {latest.lastError && !previousSelection ? (
            <Status tone={verifiedAudioNeedsConfirmation ? "neutral" : "error"}>
              {awaitingOperator || latest.lastError === "provider_outcome_unresolved"
                ? operatorMessage
                : latest.lastError === "new_confirmation_required"
                  ? verifiedAudioNeedsConfirmation
                    ? "Your audio is uploaded and verified. Note creation has not started. Review the allowance below and confirm to create your session notes; you do not need to upload the audio again."
                    : "The verified material has changed. Review the selected material and allowance before confirming again."
                  : latest.lastError === "audio_upload_rejected"
                    ? "The audio could not be verified. Review the selected audio, then retry with the saved original on this device or replace it."
                    : latest.lastError === "audio_upload_not_started"
                      ? uploadCopy.audio.notStarted
                      : latest.lastError === "audio_upload_incomplete"
                        ? uploadCopy.audio.incomplete
                        : (outputMessage ??
                          "The selected material could not finish processing. Check your material, then confirm a new attempt.")}
            </Status>
          ) : null}
          <Actions>
            {completed ? (
              <>
                <LinkButton href={`/sessions/${sessionId}/notes`}>Read session notes</LinkButton>
                <LinkButton secondary href={`/sessions/${sessionId}/cards`}>
                  Make flashcards
                </LinkButton>
              </>
            ) : null}
            <LinkButton secondary href={`/sessions/${sessionId}/sources`}>
              {completed ? "Add or change material" : "Change material"}
            </LinkButton>
            <Link href={`/sessions/${sessionId}`}>Back to session</Link>
          </Actions>
        </Panel>
      ) : null}
      {active ? (
        <Panel tone="hero" title="Preparing your session">
          <p className="preview-muted">
            {latest.state === "awaiting_upload"
              ? "Step 1 of 3 · Upload and verify material"
              : "Step 2 of 3 · Create session notes"}
          </p>
          <p role="status">
            {latest.state === "awaiting_upload"
              ? audioUploaded
                ? "Upload complete. Verifying your audio before processing starts automatically."
                : "Waiting for selected audio to be uploaded and verified."
              : latest.state === "queued"
                ? "Queued. You can leave this page; progress is saved."
                : "Extracting the selected material and building your session notes."}
          </p>
          <p>
            When processing finishes, select Read session notes. Save the notes, then choose the
            learning items to turn into flashcards.
          </p>
          <Actions>
            {latest.state === "awaiting_upload" && !audioUploaded ? (
              <Button disabled={busy} onClick={() => void action(() => sendLocalAudio(latest))}>
                {uploading
                  ? online
                    ? "Uploading audio…"
                    : "Waiting for connection…"
                  : "Resume audio upload"}
              </Button>
            ) : null}
            <LinkButton secondary href={`/sessions/${sessionId}`}>
              Continue to session
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
          {pendingRecordings > 0 ? (
            <Status>
              {pendingRecordings} recorded parts are still being saved or added to this session.
              Stop the active recording and wait for all parts before confirming processing.
            </Status>
          ) : null}
          {!estimate ? (
            <>
              <p role="status">
                {estimateProblem === "no_selected_sources"
                  ? "No material is selected for this session. Add or select saved material before processing."
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
                <LinkButton href={`/sessions/${sessionId}/sources`}>
                  {estimateProblem === "no_selected_sources"
                    ? "Add or select material"
                    : "Review material"}
                </LinkButton>
              </Actions>
            </>
          ) : (
            <>
              <p>
                Confirm below to create session notes from your selected material. After processing,
                you can read and save the notes, then prepare flashcards. Audio leaves this device
                for transcription after you confirm.
              </p>
              <ul>
                {estimate.snapshot.sources.map((source) => (
                  <li key={source.sourceId}>
                    {sourceKindLabel(source.kind)} ·{" "}
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
                <Status>AI is awaiting operator configuration. Your material remains saved.</Status>
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
                  disabled={
                    busy ||
                    !estimate.providerConfigured ||
                    !enough ||
                    awaitingOperator ||
                    pendingRecordings > 0
                  }
                  onClick={() => void action(confirm)}
                >
                  {busy
                    ? "Starting…"
                    : latest?.lastError === "new_confirmation_required"
                      ? "Review and confirm"
                      : AUDIO_UPLOAD_RETRY_CODES.includes(latest?.lastError ?? "")
                        ? "Review and retry"
                        : latest &&
                            !selectionChanged &&
                            ["failed", "cancelled"].includes(latest.state)
                          ? "Retry processing"
                          : "Confirm and process"}
                </Button>
                <LinkButton secondary href={`/sessions/${sessionId}/sources`}>
                  Change material
                </LinkButton>
              </Actions>
            </>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
