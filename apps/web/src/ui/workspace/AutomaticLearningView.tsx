"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import { requestKey, workspaceRequest } from "./api";
import { type AutomaticLearningStatus, notifyAutomaticLearning } from "./automatic-learning";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";

export function AutomaticLearningNotice({ sessionId }: { sessionId: string }) {
  const { status, problem } = useAutomaticLearning(sessionId);
  if (!problem && (!status || status.state === "idle" || status.state === "ready")) return null;
  return (
    <Status tone={status?.state === "blocked" || problem ? "error" : undefined}>
      {problem ?? status?.message}{" "}
      <Link href={`/classes/${sessionId}/processing`}>View progress</Link>
    </Status>
  );
}
export function AutomaticLearningView({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: AutomaticLearningStatus;
}) {
  const live = useAutomaticLearning(sessionId);
  const status = live.status ?? initial;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const lock = useRef(false);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const pausedForOperator = [
    "provider_outcome_unresolved",
    "provider_outcome_unknown",
    "provider_timestamps_invalid",
  ].includes(status.lastError ?? "");
  const canRetry =
    status.state === "blocked" &&
    !pausedForOperator &&
    !["upload_needs_attention", "quota_insufficient", "acceptance_required"].includes(
      status.lastError ?? "",
    );
  async function retry() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem("");
    try {
      const body = { action: "retry" };
      await workspaceRequest(
        `/api/classes/${sessionId}/learning`,
        "POST",
        body,
        requestKey(key, body),
      );
      key.current = null;
      notifyAutomaticLearning(sessionId);
      await live.refresh();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "This attempt could not be resumed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="preview-stack">
      <Link className="preview-back" href={`/classes/${sessionId}`}>
        ← Back to class
      </Link>
      <Panel
        title={
          status.state === "ready"
            ? "Notes and flashcards are ready"
            : "Automatic notes and flashcards"
        }
      >
        <p role="status">{status.message}</p>
        {problem || live.problem ? <Status tone="error">{problem || live.problem}</Status> : null}
        <Actions>
          {status.notesReady ? (
            <LinkButton href={`/classes/${sessionId}/notes`}>Class notes</LinkButton>
          ) : null}
          {status.cardsReady ? (
            <LinkButton secondary href={`/classes/${sessionId}/cards`}>
              Flashcards
            </LinkButton>
          ) : null}
          <LinkButton secondary href={`/classes/${sessionId}/sources`}>
            Add material
          </LinkButton>
          {canRetry ? (
            <Button secondary disabled={busy} onClick={retry}>
              {busy ? "Resuming…" : "Retry failed attempt"}
            </Button>
          ) : null}
        </Actions>
        <p className="preview-muted">
          New material updates this class automatically. Your saved edits and card review history
          stay available.
        </p>
      </Panel>
    </div>
  );
}
