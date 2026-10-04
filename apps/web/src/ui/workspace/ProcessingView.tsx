"use client";
import type { ProcessingRun, RunSnapshot } from "@recalino/core/proc";
import type { Amounts } from "@recalino/core/quota";
import type { InputContract } from "@recalino/core/src";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IndexedRecordingStore } from "../recording/store";
import { requestKey, workspaceRequest } from "./api";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";
import { uploadWithConfirmation } from "./upload";

export interface ProcessingEstimate {
  snapshot: RunSnapshot;
  requested: Amounts | null;
  allowance: { remaining: Amounts };
  providerConfigured: boolean;
  models: { language: string; image: string; transcription: string } | null;
}
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
  initialRuns,
  contract,
}: {
  sessionId: string;
  userId: string;
  initialEstimate: ProcessingEstimate | null;
  initialRuns: ProcessingRun[];
  contract: InputContract | null;
}) {
  const router = useRouter();
  const key = useRef<{ payload: string; key: string } | null>(null);
  const [estimate, setEstimate] = useState(initialEstimate),
    [runs, setRuns] = useState(initialRuns),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const latest = runs[0];
  const active = latest && ["awaiting_upload", "queued", "processing"].includes(latest.state);
  const awaitingOperator =
    latest?.state === "needs_input" &&
    !["new_confirmation_required", "audio_upload_rejected"].includes(latest.lastError ?? "");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void workspaceRequest<ProcessingRun[]>(`/api/classes/${sessionId}/processing`, "GET")
        .then((next) => {
          setRuns(next);
          if (!["awaiting_upload", "queued", "processing"].includes(next[0]?.state ?? "")) {
            void workspaceRequest<ProcessingEstimate>(`/api/classes/${sessionId}/estimate`, "GET")
              .then(setEstimate)
              .catch(() => setEstimate(null));
            router.refresh();
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [active, sessionId, router]);
  async function action(effect: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await effect();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Processing could not start.");
    } finally {
      setBusy(false);
    }
  }
  async function sendLocalAudio(run: ProcessingRun) {
    if (!contract || !estimate)
      throw new Error("Source settings are unavailable. Keep the local recording and try again.");
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
      if ((await sha256(blob)) !== source.sha256)
        throw new Error("The local recording does not match the selected source.");
      const parts: { index: number; sizeBytes: number; sha256: string }[] = [];
      for (let offset = 0; offset < blob.size; offset += contract.partBytes) {
        const part = blob.slice(offset, offset + contract.partBytes);
        parts.push({ index: parts.length, sizeBytes: part.size, sha256: await sha256(part) });
      }
      const started = await workspaceRequest<{ uploadId: string }>(
        `/api/sources/${source.sourceId}/audio`,
        "POST",
        { action: "start", runId: run.id, reservationId: run.reservationId, parts },
        `audio-start:${run.id}:${source.sourceId}`,
      );
      const manifest = await workspaceRequest<{
        parts: { index: number; verifiedAt: string | null }[];
      }>(`/api/sources/${source.sourceId}/audio?uploadId=${started.uploadId}`, "GET");
      for (const part of parts) {
        if (manifest.parts.some((p) => p.index === part.index && p.verifiedAt)) continue;
        setMessage(`Uploading audio part ${part.index + 1} of ${parts.length}…`);
        const link = await workspaceRequest<{ url: string }>(
          `/api/sources/${source.sourceId}/audio?uploadId=${started.uploadId}&index=${part.index}`,
          "GET",
        );
        await uploadWithConfirmation(
          () =>
            fetch(link.url, {
              method: "PUT",
              headers: { "content-type": source.mimeType },
              body: blob.slice(
                part.index * contract.partBytes,
                Math.min(blob.size, (part.index + 1) * contract.partBytes),
              ),
            }),
          () =>
            workspaceRequest(`/api/sources/${source.sourceId}/audio`, "POST", {
              action: "confirm_part",
              runId: run.id,
              uploadId: started.uploadId,
              index: part.index,
            }),
          "Audio upload interrupted. The original remains on this device; retry to resume.",
        );
      }
      await workspaceRequest(
        `/api/sources/${source.sourceId}/audio`,
        "POST",
        { action: "complete", runId: run.id, uploadId: started.uploadId },
        `audio-complete:${run.id}:${source.sourceId}`,
      );
    }
    setMessage("Audio uploaded for verification. The original is still on this device.");
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
    setRuns([run, ...runs.filter((row) => row.id !== run.id)]);
    if (run.state === "awaiting_upload") await sendLocalAudio(run);
  }
  const enough =
    !!estimate?.requested &&
    Object.entries(estimate.requested).every(
      ([dimension, needed]) =>
        needed <= (estimate.allowance.remaining[dimension as keyof Amounts] ?? 0),
    );
  return (
    <div className="preview-stack">
      {error ? <Status tone="error">{error}</Status> : null}
      {message ? <Status>{message}</Status> : null}
      {active ? (
        <Panel tone="hero" title="Preparing your class">
          <p role="status">
            {latest.state === "awaiting_upload"
              ? "Waiting for selected audio to be uploaded and verified."
              : latest.state === "queued"
                ? "Queued. You can leave this page; progress is saved."
                : "Extracting the selected sources and building your class notes."}
          </p>
          <Actions>
            {latest.state === "awaiting_upload" ? (
              <Button disabled={busy} onClick={() => void action(() => sendLocalAudio(latest))}>
                Resume audio upload
              </Button>
            ) : null}
            <Button
              secondary
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const canceled = await workspaceRequest<ProcessingRun>(
                    `/api/runs/${latest.id}`,
                    "DELETE",
                  );
                  setRuns([canceled, ...runs.slice(1)]);
                  setEstimate(await workspaceRequest(`/api/classes/${sessionId}/estimate`, "GET"));
                })
              }
            >
              Cancel processing
            </Button>
          </Actions>
        </Panel>
      ) : (
        <Panel tone="hero" title="Check before processing">
          {!estimate ? (
            <p>No selected source is ready. Add material to this class first.</p>
          ) : (
            <>
              <p>
                Only the sources selected below will be processed. Audio leaves this device for
                transcription after you confirm.
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
                      ? ` · ${source.ranges.length} selected ranges`
                      : " · full source"}
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
                  {busy ? "Starting…" : "Confirm and process"}
                </Button>
                <LinkButton secondary href={`/classes/${sessionId}/sources`}>
                  Change sources
                </LinkButton>
              </Actions>
            </>
          )}
        </Panel>
      )}
      {latest && !active ? (
        <Panel title="Latest result">
          <p>
            {latest.state === "ready"
              ? "Your class is ready."
              : latest.state === "partial_ready"
                ? "A partial result is ready. Some selected material could not be extracted."
                : latest.state === "cancelled"
                  ? "Processing cancelled. Unused allowance was released."
                  : "Processing needs attention. Your saved class and earlier notes are available."}
          </p>
          {latest.lastError ? (
            <p className="preview-muted">
              {awaitingOperator || latest.lastError === "provider_outcome_unresolved"
                ? "A provider result is still being checked. Contact the operator before retrying."
                : latest.lastError === "new_confirmation_required"
                  ? "The verified source has changed. Review the selected sources and allowance before confirming again."
                  : latest.lastError === "audio_upload_rejected"
                    ? "The audio could not be verified. Check or replace the selected audio before trying again."
                    : "The selected material could not finish processing. Check your sources, then confirm a new attempt."}
            </p>
          ) : null}
          <Actions>
            {["ready", "partial_ready"].includes(latest.state) ? (
              <>
                <LinkButton href={`/classes/${sessionId}/notes`}>Open notes</LinkButton>
                <LinkButton secondary href={`/classes/${sessionId}/cards`}>
                  Open class cards
                </LinkButton>
              </>
            ) : null}
            <Link href={`/classes/${sessionId}`}>Back to class</Link>
          </Actions>
        </Panel>
      ) : null}
    </div>
  );
}
