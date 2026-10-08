"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import styles from "./AutomaticLearningView.module.css";
import { requestKey, workspaceRequest } from "./api";
import { type AutomaticLearningStatus, notifyAutomaticLearning } from "./automatic-learning";
import { automaticLearningRecovery } from "./automatic-learning-recovery";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";

function RecoveryLinks({
  sessionId,
  kind,
  inline = false,
}: {
  sessionId: string;
  kind: ReturnType<typeof automaticLearningRecovery>["kind"];
  inline?: boolean;
}) {
  const links =
    kind === "allowance"
      ? [
          { href: "/me/quota", label: "Review allowance" },
          { href: "/help/new", label: "Ask for more allowance" },
        ]
      : kind === "service"
        ? [
            {
              href: `/classes/${sessionId}/processing#processing-review`,
              label: "View processing review",
            },
          ]
        : kind === "material"
          ? [{ href: `/classes/${sessionId}/sources`, label: "Review material" }]
          : kind === "setup"
            ? [{ href: "/setup", label: "Review account setup" }]
            : [];
  return links.map(({ href, label }, index) =>
    inline ? (
      <span key={href}>
        {" "}
        <Link href={href} prefetch={false} className={styles.inlineRetry}>
          {label}
        </Link>{" "}
      </span>
    ) : (
      <LinkButton key={href} href={href} secondary={index > 0}>
        {label}
      </LinkButton>
    ),
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
  async function requestReview(runId: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem("");
    try {
      const body = { action: "request_review", runId };
      const status = await workspaceRequest<AutomaticLearningStatus>(
        `/api/classes/${sessionId}/learning`,
        "POST",
        body,
        requestKey(key, body),
      );
      key.current = null;
      live.acceptStatus(status);
      notifyAutomaticLearning(sessionId);
    } catch (failure) {
      setProblem(
        failure instanceof Error
          ? failure.message
          : "The processing review could not be requested. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, problem, progressProblem, retry, refreshProgress, requestReview };
}

export function AutomaticLearningNotice({ sessionId }: { sessionId: string }) {
  const live = useAutomaticLearning(sessionId);
  const { status, problem } = live;
  const retry = useLearningRetry(sessionId, live);
  if (!problem && (!status || status.state === "idle" || status.state === "ready")) return null;
  const recovery = automaticLearningRecovery(status);
  const review = status?.processingReview;
  const canRetry = !!recovery.retryLabel && recovery.kind !== "service";
  const message = problem ?? status?.message ?? "";
  const ordinaryRetry = recovery.retryLabel === "Retry failed attempt";
  const retryWord = canRetry && ordinaryRetry ? /\bretry\b/i.exec(message) : null;
  const retryLink = (
    <Button
      className={styles.inlineRetry}
      disabled={retry.busy}
      aria-label={recovery.retryLabel ?? "Retry failed attempt"}
      onClick={retry.retry}
    >
      {retry.busy
        ? "Retrying…"
        : (retryWord?.[0] ?? (ordinaryRetry ? "Retry" : recovery.retryLabel))}
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
          message
        )}{" "}
        <RecoveryLinks sessionId={sessionId} kind={recovery.kind} inline />
        {recovery.kind === "service" && review?.canRequest ? (
          <Button
            className={styles.inlineRetry}
            disabled={retry.busy}
            onClick={() => retry.requestReview(review.runId)}
          >
            {retry.busy ? "Requesting review…" : "Request processing review"}
          </Button>
        ) : null}
        {!retryWord && canRetry ? retryLink : null}{" "}
        <Link href={`/classes/${sessionId}/processing`} className={styles.inlineRetry}>
          View progress
        </Link>
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
  const recovery = automaticLearningRecovery(status);
  const canRetry = !!recovery.retryLabel && recovery.kind !== "service";
  const review = status.processingReview;
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
          {recovery.kind !== "service" ? (
            <RecoveryLinks sessionId={sessionId} kind={recovery.kind} />
          ) : null}
          {canRetry ? (
            <Button secondary disabled={retry.busy} onClick={retry.retry}>
              {retry.busy ? "Retrying…" : recovery.retryLabel}
            </Button>
          ) : null}
          {status.notesReady ? (
            <LinkButton secondary={status.state === "blocked"} href={`/classes/${sessionId}/notes`}>
              Class notes
            </LinkButton>
          ) : null}
          {status.cardsReady ? (
            <LinkButton secondary href={`/classes/${sessionId}/cards`}>
              Flashcards
            </LinkButton>
          ) : null}
          {status.state !== "blocked" && !recovery.kind ? (
            <LinkButton secondary href={`/classes/${sessionId}/sources`}>
              Add material
            </LinkButton>
          ) : null}
        </Actions>
        {status.state === "blocked" ? (
          <p className="preview-muted">
            {recovery.kind === "service"
              ? "The Recalino team needs to review this class's stopped processing. Request a review below; your saved material will be used when processing continues."
              : recovery.retryLabel === "Retry after allowance changes"
                ? "After your allowance is updated, retry using this class's saved material."
                : "Your saved edits and card review history stay available."}
          </p>
        ) : (
          <>
            <p className="preview-muted">
              This page shows whether your notes and flashcards are being created or ready.
              Processing continues when you leave this page.
            </p>
            <p className="preview-muted">
              New material updates this class automatically. Your saved edits and card review
              history stay available.
            </p>
          </>
        )}
      </Panel>
      {review || recovery.kind === "service" ? (
        <section id="processing-review" aria-label="Processing review">
          <Panel title="Processing review">
            <p role="status">
              {review?.state === "resolved"
                ? "Processing has finished. Your class notes and flashcards are ready."
                : review?.state === "retrying"
                  ? "Processing is continuing with your saved material. You will receive a notification when the result is ready."
                  : review?.requestedAt
                    ? "Your request is recorded for this class. The Recalino team will check the cause and continue processing when it is safe. You will receive a notification with the result."
                    : review
                      ? "This class's stopped processing is already visible to the Recalino team. Request a review to flag this exact attempt for attention; you do not need to send a separate message or upload these files again."
                      : "The service needs attention before automatic creation can continue. Check the current class status again."}
            </p>
            {review?.canRequest ? (
              <Button disabled={retry.busy} onClick={() => retry.requestReview(review.runId)}>
                {retry.busy ? "Requesting review…" : "Request processing review"}
              </Button>
            ) : null}
            {!review ? (
              <p className="preview-muted">
                No failed class attempt is available to attach yet. Check the current status again.
              </p>
            ) : null}
            <Actions>
              <Button secondary disabled={retry.busy} onClick={retry.refreshProgress}>
                {retry.busy ? "Checking progress…" : "Check review status"}
              </Button>
              {review?.state === "resolved" ? (
                <LinkButton href={`/classes/${sessionId}/notes`}>Open class notes</LinkButton>
              ) : null}
            </Actions>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
