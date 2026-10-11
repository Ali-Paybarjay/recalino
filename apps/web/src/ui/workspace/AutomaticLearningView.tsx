"use client";
import Link from "next/link";
import { type ReactNode, useRef, useState, useSyncExternalStore } from "react";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import styles from "./AutomaticLearningView.module.css";
import { requestKey, workspaceRequest } from "./api";
import { type AutomaticLearningStatus, notifyAutomaticLearning } from "./automatic-learning";
import { automaticLearningRecovery } from "./automatic-learning-recovery";
import { LearningProgress } from "./LearningProgress";
import { learningProgress } from "./learning-progress";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";
import { useUploadBatches } from "./UploadProvider";

function subscribeConnection(changed: () => void) {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}
const connectionSnapshot = () => navigator.onLine;
const connectedServerSnapshot = () => true;

function RecoveryLinks({
  sessionId,
  kind,
}: {
  sessionId: string;
  kind: ReturnType<typeof automaticLearningRecovery>["kind"];
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
              href: `/sessions/${sessionId}/processing#processing-review`,
              label: "View processing review",
            },
          ]
        : kind === "material"
          ? [{ href: `/sessions/${sessionId}/sources`, label: "Review material" }]
          : kind === "setup"
            ? [{ href: "/setup", label: "Review account setup" }]
            : [];
  return links.map(({ href, label }, index) => (
    <LinkButton key={href} href={href} secondary={index > 0}>
      {label}
    </LinkButton>
  ));
}

function useLearningRetry(sessionId: string, live: ReturnType<typeof useAutomaticLearning>) {
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"retry" | "review" | "refresh" | null>(null);
  const [feedback, setFeedback] = useState("");
  const focusRef = useRef<HTMLElement>(null);
  function begin(action: "retry" | "review" | "refresh") {
    setAction(action);
    setFeedback("");
    setProblem("");
    setProgressProblem("");
    if (typeof window !== "undefined")
      window.requestAnimationFrame(() => {
        focusRef.current?.focus({ preventScroll: true });
        focusRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      });
  }
  const [problem, setProblem] = useState("");
  const lock = useRef(false);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const [progressProblem, setProgressProblem] = useState("");
  async function refreshProgress() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    begin("refresh");
    try {
      await live.refresh();
      setFeedback("Progress is up to date.");
      setProgressProblem("");
    } catch {
      setProgressProblem("Progress could not be refreshed. Check your connection and try again.");
    } finally {
      lock.current = false;
      setBusy(false);
      setAction(null);
    }
  }
  async function retry() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    begin("retry");
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
      setAction(null);
      if (status?.state !== "blocked")
        setFeedback("Retry accepted. Follow the live progress below.");
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
      setAction(null);
    }
  }
  async function requestReview(runId: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    begin("review");
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
      setFeedback("Your processing review request is recorded. You can follow its status below.");
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
      setAction(null);
    }
  }
  return {
    busy,
    action,
    feedback,
    focusRef,
    problem,
    progressProblem,
    retry,
    refreshProgress,
    requestReview,
  };
}

function LearningStatusCard({
  sessionId,
  status,
  live,
  retry,
  compact = false,
  children,
}: {
  sessionId: string;
  status: AutomaticLearningStatus;
  live: ReturnType<typeof useAutomaticLearning>;
  retry: ReturnType<typeof useLearningRetry>;
  compact?: boolean;
  children: ReactNode;
}) {
  const batches = useUploadBatches(sessionId);
  const progress = learningProgress(status, batches, live.uploadProgress);
  const online = useSyncExternalStore(
    subscribeConnection,
    connectionSnapshot,
    connectedServerSnapshot,
  );
  const disconnected = !online && progress.active;
  const problem =
    live.problem || (status.state !== "ready" ? retry.problem || retry.progressProblem : "");
  const attention =
    !!problem || disconnected || status.state === "blocked" || progress.needsMaterialReview;
  const pending = retry.action;
  const heading =
    pending === "retry"
      ? "Retrying your session…"
      : pending === "review"
        ? "Requesting a processing review…"
        : pending === "refresh"
          ? "Checking your progress…"
          : disconnected
            ? progress.stage === "upload"
              ? "Upload paused"
              : "Reconnect to see progress"
            : problem
              ? "Progress needs your attention"
              : progress.heading;
  const guidance =
    pending === "retry"
      ? "Please wait while we restart using your saved material."
      : pending === "review"
        ? "Please wait while we record your request."
        : pending === "refresh"
          ? "Please wait while we check the latest status."
          : disconnected
            ? progress.stage === "upload"
              ? "Reconnect this device to the internet. Your upload will resume automatically; keep this app open."
              : "Processing can continue, but this device needs an internet connection to show the latest progress."
            : problem
              ? "Check the message below for your next step. Your saved material is still available."
              : compact && automaticLearningRecovery(status).kind === "service"
                ? status.processingReview?.requestedAt
                  ? "Your review request is recorded. Open View processing review to follow its status."
                  : "Open View processing review for the next step."
                : progress.guidance;
  return (
    <section
      ref={retry.focusRef}
      tabIndex={-1}
      aria-label="Session progress"
      className={styles.card}
      data-tone={
        pending ? "active" : attention ? "attention" : status.state === "ready" ? "ready" : "active"
      }
    >
      <div className={styles.statusHeading} role="status" aria-atomic="true">
        <p className={styles.eyebrow}>
          {pending
            ? "Updating your session"
            : attention
              ? "Action needed"
              : status.state === "ready"
                ? "Ready to learn"
                : "Your session progress"}
        </p>
        <h2>{heading}</h2>
        <p className={styles.guidance}>{guidance}</p>
      </div>
      {pending ? (
        <div className={styles.pending}>
          <progress aria-label="Updating session status" />
        </div>
      ) : (
        <>
          {problem ? <Status tone="error">{problem}</Status> : null}
          {retry.feedback && !problem && status.state !== "blocked" && status.state !== "ready" ? (
            <Status tone="success">{retry.feedback}</Status>
          ) : null}
          {status.state === "blocked" ? <p className={styles.detail}>{status.message}</p> : null}
          <LearningProgress
            progress={progress}
            compact={compact}
            paused={!!problem || disconnected}
            pausedLabel={disconnected ? "Waiting to reconnect" : "Check status"}
          />
          {!progress.preparing &&
          status.state !== "blocked" &&
          status.state !== "ready" &&
          status.state !== "idle" ? (
            <p className={styles.detail} role="status">
              {status.message}
            </p>
          ) : null}
        </>
      )}
      <div className={styles.cardActions}>
        {progress.needsMaterialReview && automaticLearningRecovery(status).kind !== "material" ? (
          <LinkButton href={`/sessions/${sessionId}/sources`}>Review material</LinkButton>
        ) : null}
        {children}
      </div>
      {(retry.progressProblem && status.state !== "ready") || live.problem ? (
        <Button secondary disabled={retry.busy} onClick={retry.refreshProgress}>
          {retry.action === "refresh" ? "Checking progress…" : "Check progress again"}
        </Button>
      ) : null}
    </section>
  );
}

export function AutomaticLearningNotice({ sessionId }: { sessionId: string }) {
  const live = useAutomaticLearning(sessionId);
  const batches = useUploadBatches(sessionId);
  const { status, problem } = live;
  const retry = useLearningRetry(sessionId, live);
  const recovery = automaticLearningRecovery(status);
  const review = status?.processingReview;
  const canRetry = !!recovery.retryLabel && recovery.kind !== "service";
  const fallback: AutomaticLearningStatus = {
    state: "idle",
    revision: 0,
    batchId: null,
    run: null,
    snapshot: null,
    lastError: null,
    message: "Checking session progress…",
    notesReady: false,
    cardsReady: false,
  };
  const progress = learningProgress(status ?? fallback, batches, live.uploadProgress);
  if (
    !problem &&
    (!status || status.state === "idle") &&
    !progress.active &&
    !progress.needsMaterialReview
  )
    return null;
  return (
    <LearningStatusCard
      sessionId={sessionId}
      status={status ?? fallback}
      live={live}
      retry={retry}
      compact
    >
      <Actions>
        {canRetry ? (
          <Button disabled={retry.busy} onClick={retry.retry}>
            {retry.action === "retry" ? "Retrying…" : recovery.retryLabel}
          </Button>
        ) : null}
        <RecoveryLinks sessionId={sessionId} kind={recovery.kind} />
        {status?.state === "ready" ? (
          <>
            {status.notesReady ? (
              <LinkButton href={`/sessions/${sessionId}/notes`}>Session notes</LinkButton>
            ) : null}
            {status.cardsReady ? (
              <LinkButton secondary href={`/sessions/${sessionId}/cards`}>
                Flashcards
              </LinkButton>
            ) : null}
          </>
        ) : null}
        {recovery.kind === "service" && review?.canRequest ? (
          <Button disabled={retry.busy} onClick={() => retry.requestReview(review.runId)}>
            {retry.action === "review" ? "Requesting review…" : "Request processing review"}
          </Button>
        ) : null}
        <LinkButton
          secondary={canRetry || !!recovery.kind || status?.state === "ready"}
          href={`/sessions/${sessionId}/processing`}
        >
          View progress
        </LinkButton>
      </Actions>
    </LearningStatusCard>
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
      <Link className="preview-back" href={`/sessions/${sessionId}`}>
        ← Back to session
      </Link>
      <LearningStatusCard sessionId={sessionId} status={status} live={live} retry={retry}>
        <Actions>
          {recovery.kind !== "service" ? (
            <RecoveryLinks sessionId={sessionId} kind={recovery.kind} />
          ) : null}
          {canRetry ? (
            <Button disabled={retry.busy} onClick={retry.retry}>
              {retry.action === "retry" ? "Retrying…" : recovery.retryLabel}
            </Button>
          ) : null}
          {status.notesReady ? (
            <LinkButton
              secondary={status.state === "blocked"}
              href={`/sessions/${sessionId}/notes`}
            >
              Session notes
            </LinkButton>
          ) : null}
          {status.cardsReady ? (
            <LinkButton secondary href={`/sessions/${sessionId}/cards`}>
              Flashcards
            </LinkButton>
          ) : null}
          {(status.state === "idle" || status.state === "ready") && !recovery.kind ? (
            <LinkButton secondary href={`/sessions/${sessionId}/sources`}>
              Add material
            </LinkButton>
          ) : null}
        </Actions>
        {status.state === "blocked" ? (
          <p className={styles.detail}>
            {recovery.kind === "service"
              ? review?.requestedAt
                ? "Your processing review is recorded. Follow its status below; your saved material will be used when processing continues."
                : "Request a review below so the Recalino team can help continue processing."
              : "Your saved edits and card review history stay available."}
          </p>
        ) : null}
      </LearningStatusCard>
      {review || recovery.kind === "service" ? (
        <section id="processing-review" aria-label="Processing review">
          <Panel title="Processing review">
            <p role="status">
              {review?.state === "resolved"
                ? review.partialResult
                  ? // Approved by the product owner on 2026-10-10.
                    "Your session notes and flashcards are available with some source limitations. Open the notes to see what could not be processed."
                  : "Processing has finished. Your session notes and flashcards are ready."
                : review?.state === "retrying"
                  ? "Processing is continuing with your saved material. You will receive a notification when the result is ready."
                  : review?.requestedAt
                    ? "Your request is recorded for this session. The Recalino team will check the cause and continue processing when it is safe. You will receive a notification with the result."
                    : review
                      ? "This session's stopped processing is already visible to the Recalino team. Request a review to flag this exact attempt for attention; you do not need to send a separate message or upload these files again."
                      : "The service needs attention before automatic creation can continue. Check the current session status again."}
            </p>
            {review?.canRequest ? (
              <Button disabled={retry.busy} onClick={() => retry.requestReview(review.runId)}>
                {retry.action === "review" ? "Requesting review…" : "Request processing review"}
              </Button>
            ) : null}
            {!review ? (
              <p className="preview-muted">
                No failed session attempt is available to attach yet. Check the current status
                again.
              </p>
            ) : null}
            <Actions>
              <Button secondary disabled={retry.busy} onClick={retry.refreshProgress}>
                {retry.action === "refresh" ? "Checking progress…" : "Check review status"}
              </Button>
              {review?.state === "resolved" ? (
                <LinkButton href={`/sessions/${sessionId}/notes`}>Open session notes</LinkButton>
              ) : null}
            </Actions>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
