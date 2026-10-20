"use client";
import type { ClassVoiceView } from "@recalino/core/voice-contracts";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { RecordLauncher, useWaitingRecordings } from "../recording/RecordingProvider";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import {
  connectedServerSnapshot,
  connectionSnapshot,
  subscribeConnection,
  useLearningRetry,
} from "./AutomaticLearningView";
import styles from "./AutomaticLearningView.module.css";
import { useAccountGate } from "./account-gate";
import { userMessage, workspaceRequest } from "./api";
import type { AutomaticLearningStatus } from "./automatic-learning";
import { LearningProgress } from "./LearningProgress";
import { learningProgress } from "./learning-progress";
import { ProcessSession } from "./ProcessSession";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";
import { sessionNavigationCopy } from "./session-navigation-copy";
import { type SessionAction, sessionNextStep } from "./session-state";
import { openTermsNotice } from "./terms-notice-event";
import { useUploadBatches } from "./UploadProvider";

/** Whether this session's voice check waits for the learner's optional confirmation (D55). */
export function voiceConfirmationPending(view: ClassVoiceView | null) {
  return !!view?.enabled && view.analyses.some((analysis) => analysis.status === "unverified");
}

export function useVoicePending(sessionId: string, enabled: boolean) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void workspaceRequest<ClassVoiceView>(
      `/api/classes/${sessionId}/voice`,
      "GET",
      undefined,
      undefined,
      { signal: abort.signal },
    )
      .then((view) => setPending(voiceConfirmationPending(view)))
      .catch(() => {
        /* The voice step is optional; the session card never waits for it. */
      });
    return () => abort.abort();
  }, [sessionId, enabled]);
  return enabled && pending;
}

/**
 * The session's state and its one next step, from `sessionNextStep`. Used at the top of the
 * session page and on Today, so both name the same action.
 */
export function SessionNextStep({
  sessionId,
  initial,
  content,
  voicePending = false,
  primarySecondary = false,
  title,
  studyShownBelow = false,
  visibleWhen = "always",
}: {
  sessionId: string;
  initial: AutomaticLearningStatus | null;
  content: { notes: boolean; cards: boolean };
  voicePending?: boolean;
  /** D32: on Today, Record a session stays the only filled primary button. */
  primarySecondary?: boolean;
  /** Shown above the status line on Today, where the card names which session it is. */
  title?: string;
  /** The session page shows notes and flashcards below; secondary actions do not repeat them. */
  studyShownBelow?: boolean;
  /**
   * Today (owner decision 2026-10-13, D71): the latest session shows unless it is still empty,
   * where Record a session above already leads; other sessions show only while work is in progress.
   */
  visibleWhen?: "always" | "not-idle" | "in-progress";
}) {
  const titleId = useId();
  const live = useAutomaticLearning(sessionId);
  const batches = useUploadBatches(sessionId);
  const retry = useLearningRetry(sessionId, live);
  const recordings = useWaitingRecordings(
    sessionId,
    `${live.status?.revision}:${live.status?.state}:${live.status?.processRequest}`,
  );
  const online = useSyncExternalStore(
    subscribeConnection,
    connectionSnapshot,
    connectedServerSnapshot,
  );
  const [actionProblem, setActionProblem] = useState("");
  const account = useAccountGate();
  const status = live.status ?? initial;
  const step = sessionNextStep({
    sessionId,
    status,
    statusProblem: live.problem,
    online,
    content,
    batches,
    uploadProgress: live.uploadProgress,
    audioTransfers: live.manualAudio,
    recordings,
    voicePending,
    account,
  });
  const progress =
    status &&
    status.state !== "idle" &&
    step.tone !== "ready" &&
    // Nothing runs while the session waits for Process this session (D107).
    step.primary.id !== "process_session"
      ? learningProgress(
          status,
          batches,
          live.uploadProgress,
          account.setupComplete && !account.termsPending,
        )
      : null;
  const pending = retry.action;
  const problem = actionProblem || retry.problem;
  const hidden =
    !pending &&
    ((visibleWhen === "not-idle" && step.tone === "idle") ||
      (visibleWhen === "in-progress" && (step.tone === "idle" || step.tone === "ready")));

  function run(action: SessionAction) {
    setActionProblem("");
    if (action.id === "accept_terms") return openTermsNotice();
    if (action.id === "retry_processing") return void retry.retry();
    if (action.id === "request_review" && action.runId)
      return void retry.requestReview(action.runId);
    if (action.id === "retry_upload" && action.runId)
      return void live
        .retryManualAudio(action.runId)
        .catch((failure: unknown) =>
          setActionProblem(userMessage(failure, "The upload could not resume.")),
        );
  }
  function render(action: SessionAction, secondary: boolean) {
    // D107: opens the summary and allowance sheet; nothing starts before its confirmation.
    if (action.id === "process_session")
      return (
        <ProcessSession
          key={action.id}
          sessionId={sessionId}
          secondary={secondary}
          disabled={retry.busy}
          onProblem={setActionProblem}
        />
      );
    // The session page's one-tap capture (D32); in a secondary place it links to the recording page.
    if (action.id === "record" && !secondary)
      return <RecordLauncher key={action.id} sessionId={sessionId} />;
    if (action.href)
      return (
        <LinkButton key={action.id} secondary={secondary} href={action.href}>
          {action.label}
        </LinkButton>
      );
    const busyLabel =
      action.id === "retry_processing" && pending === "retry"
        ? "Retrying…"
        : action.id === "request_review" && pending === "review"
          ? "Requesting review…"
          : action.label;
    return (
      <Button
        key={action.id}
        secondary={secondary}
        disabled={retry.busy}
        onClick={() => run(action)}
      >
        {busyLabel}
      </Button>
    );
  }
  if (hidden) return null;
  return (
    <section
      ref={retry.focusRef}
      tabIndex={-1}
      // Several cards on Today are told apart by their session title.
      aria-label={title ? undefined : "Session progress"}
      aria-labelledby={title ? titleId : undefined}
      className={styles.card}
      data-tone={pending ? "active" : step.tone === "idle" ? "active" : step.tone}
    >
      <div className={styles.statusHeading} role="status" aria-atomic="true">
        <p className={styles.eyebrow} id={titleId} dir={title ? "auto" : undefined}>
          {title ?? sessionNavigationCopy.nextStep}
        </p>
        <h2>
          {pending === "retry"
            ? "Retrying your session…"
            : pending === "review"
              ? "Requesting a processing review…"
              : step.heading}
        </h2>
        {step.detail && !pending ? <p className={styles.guidance}>{step.detail}</p> : null}
      </div>
      {problem ? <Status tone="error">{problem}</Status> : null}
      {retry.feedback && !problem ? <Status tone="success">{retry.feedback}</Status> : null}
      {progress && !pending ? (
        <LearningProgress
          progress={progress}
          compact
          paused={step.tone === "attention"}
          pausedLabel={online ? "Check status" : "Waiting to reconnect"}
        />
      ) : null}
      <div className={styles.cardActions}>
        <Actions>
          {render(step.primary, primarySecondary)}
          {step.secondary
            .filter(
              (action) =>
                !studyShownBelow ||
                (action.id !== "read_notes" &&
                  action.id !== "practise_cards" &&
                  action.id !== "confirm_voice"),
            )
            .map((action) => render(action, true))}
        </Actions>
      </div>
    </section>
  );
}

/**
 * Top of the session page: the next step, then the optional voice step when this session's voice
 * check waits for the learner (no longer above the notes).
 */
export function SessionOverviewTop({
  sessionId,
  initial,
  content,
}: {
  sessionId: string;
  initial: AutomaticLearningStatus | null;
  content: { notes: boolean; cards: boolean };
}) {
  const voicePending = useVoicePending(sessionId, content.notes);
  return (
    <>
      <SessionNextStep
        sessionId={sessionId}
        initial={initial}
        content={content}
        voicePending={voicePending}
        studyShownBelow={content.notes || content.cards}
      />
      {voicePending ? <VoiceStepCard sessionId={sessionId} /> : null}
    </>
  );
}

/** The optional voice step (D55): a card that leads to the confirmation page. */
export function VoiceStepCard({ sessionId }: { sessionId: string }) {
  return (
    <Panel title="Your voice in this session">
      <p>{sessionNavigationCopy.voice.cardBody}</p>
      <Actions>
        <LinkButton secondary href={`/sessions/${sessionId}/voice`}>
          {sessionNavigationCopy.voice.action}
        </LinkButton>
      </Actions>
    </Panel>
  );
}
