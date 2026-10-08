"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import styles from "./AutomaticLearningView.module.css";
import { requestKey, workspaceRequest } from "./api";
import { type AutomaticLearningStatus, notifyAutomaticLearning } from "./automatic-learning";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";

function canRetryLearning(status: AutomaticLearningStatus | null) {
  return (
    status?.state === "blocked" &&
    ![
      "provider_outcome_unresolved",
      "provider_outcome_unknown",
      "provider_timestamps_invalid",
      "upload_needs_attention",
      "quota_insufficient",
      "acceptance_required",
    ].includes(status.lastError ?? "")
  );
}

function useLearningRetry(sessionId: string, live: ReturnType<typeof useAutomaticLearning>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const lock = useRef(false);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const [progressProblem, setProgressProblem] = useState("");
  async function refreshProgress() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await live.refresh();
      setProgressProblem("");
    } catch {
      setProgressProblem("Progress could not be refreshed. Check your connection and try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem("");
    setProgressProblem("");
    try {
      const body = { action: "retry" };
      const status = await workspaceRequest<AutomaticLearningStatus>(
        `/api/classes/${sessionId}/learning`,
        "POST",
        body,
        requestKey(key, body),
      );
      key.current = null;
      live.acceptStatus(status);
      notifyAutomaticLearning(sessionId);
      try {
        await live.refresh();
      } catch {
        setProgressProblem(
          "Retry was accepted, but progress could not be refreshed. Check your connection; progress will update automatically.",
        );
      }
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "This attempt could not be resumed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, problem, progressProblem, retry, refreshProgress };
}

export function AutomaticLearningNotice({ sessionId }: { sessionId: string }) {
  const live = useAutomaticLearning(sessionId);
  const { status, problem } = live;
  const retry = useLearningRetry(sessionId, live);
  if (!problem && (!status || status.state === "idle" || status.state === "ready")) return null;
  const canRetry = canRetryLearning(status);
  const message = problem ?? status?.message ?? "";
  const retryWord = canRetry ? /\bretry\b/i.exec(message) : null;
  const retryLink = (
    <Button
      className={styles.inlineRetry}
      disabled={retry.busy}
      aria-label="Retry failed attempt"
      onClick={retry.retry}
    >
      {retry.busy ? "Retrying…" : (retryWord?.[0] ?? "Retry")}
    </Button>
  );
  return (
    <>
      <Status tone={status?.state === "blocked" || problem ? "error" : undefined}>
        {retryWord ? (
          <>
            {message.slice(0, retryWord.index)}
            {retryLink}
            {message.slice(retryWord.index + retryWord[0].length)}
          </>
        ) : (
          <>
            {message} {canRetry ? retryLink : null}
          </>
        )}{" "}
        <Link href={`/classes/${sessionId}/processing`}>View progress</Link>
      </Status>
      {retry.problem ? <Status tone="error">{retry.problem}</Status> : null}
      {retry.progressProblem ? (
        <>
          <Status tone="error">{retry.progressProblem}</Status>
          <Button secondary disabled={retry.busy} onClick={retry.refreshProgress}>
            {retry.busy ? "Checking progress…" : "Check progress again"}
          </Button>
        </>
      ) : null}
    </>
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
  const retry = useLearningRetry(sessionId, live);
  const canRetry = canRetryLearning(status);
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
        {retry.problem || live.problem ? (
          <Status tone="error">{retry.problem || live.problem}</Status>
        ) : null}
        {retry.progressProblem ? (
          <>
            <Status tone="error">{retry.progressProblem}</Status>
            <Button secondary disabled={retry.busy} onClick={retry.refreshProgress}>
              {retry.busy ? "Checking progress…" : "Check progress again"}
            </Button>
          </>
        ) : null}
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
            <Button secondary disabled={retry.busy} onClick={retry.retry}>
              {retry.busy ? "Retrying…" : "Retry failed attempt"}
            </Button>
          ) : null}
        </Actions>
        <p className="preview-muted">
          This page shows whether your notes and flashcards are being created, ready, or need
          attention. Processing continues when you leave this page. You can also retry a failed
          attempt directly from the class page.
        </p>
        <p className="preview-muted">
          New material updates this class automatically. Your saved edits and card review history
          stay available.
        </p>
      </Panel>
    </div>
  );
}
