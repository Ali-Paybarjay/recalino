"use client";

import type { LessonReviewView } from "@recalino/core/eval";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContentBlock } from "../components/ContentBlock";
import { requestKey, WorkspaceRequestError, workspaceRequest } from "./api";
import { lessonQualityCopy } from "./lesson-quality-copy";
import { lessonReviewCopy as copy } from "./lesson-review-copy";
import {
  canRequestLessonReview,
  lessonReviewComplete,
  lessonReviewNeedsOperator,
  lessonReviewPending,
} from "./lesson-review-state";
import styles from "./NoteView.module.css";
import { Actions, Button, Panel, Status } from "./primitives";

type Props = {
  sessionId: string;
  knowledgeVersionId: string;
  knowledgeVersion?: number;
  hasEdits?: boolean;
};

/** Remount on version change so an old request cannot appear under a new lesson. */
export function LessonReview(props: Props) {
  return <VersionLessonReview key={`${props.sessionId}:${props.knowledgeVersionId}`} {...props} />;
}

function VersionLessonReview({ sessionId, knowledgeVersionId, knowledgeVersion, hasEdits }: Props) {
  const [review, setReview] = useState<LessonReviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [awaitingReport, setAwaitingReport] = useState(false);
  const [problem, setProblem] = useState("");
  const [uncertainRequest, setUncertainRequest] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [operatorRequired, setOperatorRequired] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pendingRun = useRef<{ runId: string; previousRunId: string | null } | null>(null);
  const submittedFromRun = useRef<string | null | undefined>(undefined);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const path = `/api/classes/${sessionId}/lesson-review`;

  const load = useCallback(async () => {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    const request = new AbortController();
    controller.current = request;
    setChecking(true);
    setProblem("");
    try {
      const value = await workspaceRequest<LessonReviewView | null>(
        `${path}?versionId=${encodeURIComponent(knowledgeVersionId)}`,
        "GET",
        undefined,
        undefined,
        { signal: request.signal },
      );
      if (!mounted.current || request.signal.aborted) return;
      if (value && value.knowledgeVersionId !== knowledgeVersionId)
        throw new Error("Wrong lesson version");
      setLoaded(true);
      // Ignore only a missing or known older result after POST. GET returns the latest review:
      // another tab may already have retried our failed run, so its newer result must be shown.
      const requested = pendingRun.current;
      if (
        requested &&
        (!value || (value.runId === requested.previousRunId && value.runId !== requested.runId))
      ) {
        setAwaitingReport(true);
        return;
      }
      setReview(value);
      setAwaitingReport(false);
      if (value) {
        // A stale GET of the previous failed job cannot acknowledge the new POST.
        if (submittedFromRun.current === undefined || value.runId !== submittedFromRun.current) {
          setUncertainRequest(false);
          submittedFromRun.current = undefined;
        }
        setOperatorRequired(lessonReviewNeedsOperator(value));
        if (!lessonReviewPending(value)) pendingRun.current = null;
      }
    } catch (failure) {
      if (!mounted.current || request.signal.aborted) return;
      const removed =
        failure instanceof WorkspaceRequestError && [401, 403, 404].includes(failure.status ?? 0);
      setUnavailable(removed);
      if (removed) {
        setReview(null);
        setAwaitingReport(false);
        pendingRun.current = null;
      }
      setProblem(removed ? copy.unavailable : copy.loadError);
    } finally {
      if (mounted.current && !request.signal.aborted) {
        inFlight.current = false;
        setLoading(false);
        setChecking(false);
      }
    }
  }, [path, knowledgeVersionId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      inFlight.current = false;
      controller.current?.abort();
    };
  }, [load]);

  const pending = awaitingReport || lessonReviewPending(review);
  useEffect(() => {
    if (!pending || problem || checking || submitting) return;
    const timer = setTimeout(() => void load(), 2500);
    return () => clearTimeout(timer);
  }, [pending, problem, checking, submitting, load]);

  async function requestReview() {
    if (inFlight.current || unavailable || operatorRequired || !canRequestLessonReview(review))
      return;
    inFlight.current = true;
    const request = new AbortController();
    controller.current = request;
    setSubmitting(true);
    setProblem("");
    const body = { knowledgeVersionId };
    // A confirmed terminal failure permits a new job; uncertain acknowledgements reuse the key.
    if (review && !uncertainRequest) key.current = null;
    submittedFromRun.current = review?.runId ?? null;
    try {
      const accepted = await workspaceRequest<{ runId: string; knowledgeVersionId: string }>(
        path,
        "POST",
        body,
        requestKey(key, body),
        { signal: request.signal },
      );
      if (!mounted.current || request.signal.aborted) return;
      if (accepted.knowledgeVersionId !== knowledgeVersionId)
        throw new Error("Wrong lesson version");
      pendingRun.current = {
        runId: accepted.runId,
        previousRunId: submittedFromRun.current ?? null,
      };
      setReview(null);
      setAwaitingReport(true);
      setUncertainRequest(false);
      submittedFromRun.current = undefined;
    } catch (failure) {
      if (!mounted.current || request.signal.aborted) return;
      const reasons =
        failure instanceof WorkspaceRequestError ? Object.values(failure.fields ?? {}).flat() : [];
      const unresolved = reasons.includes("provider_outcome_unresolved");
      const removed =
        failure instanceof WorkspaceRequestError && [401, 403, 404].includes(failure.status ?? 0);
      // A definite refusal of this lesson's size: no request or retry button can change it.
      const tooLarge = reasons.includes("lesson_review_input_too_large");
      setOperatorRequired(unresolved);
      setUnavailable(removed || tooLarge);
      setUncertainRequest(!unresolved && !removed && !tooLarge);
      setProblem(
        unresolved
          ? copy.unresolved
          : tooLarge
            ? lessonQualityCopy.review.tooLarge
            : removed
              ? copy.unavailable
              : reasons.includes("configuration_unavailable")
                ? copy.providerUnavailable
                : copy.requestError,
      );
    } finally {
      if (mounted.current && !request.signal.aborted) {
        inFlight.current = false;
        setSubmitting(false);
      }
    }
  }

  const complete = lessonReviewComplete(review);
  const version = review?.knowledgeVersion ?? knowledgeVersion;
  const canRequest =
    loaded &&
    !loading &&
    !unavailable &&
    !operatorRequired &&
    !pending &&
    canRequestLessonReview(review);
  const stateText = loading
    ? copy.loading
    : submitting
      ? copy.submitting
      : pending
        ? review?.state === "processing"
          ? copy.processing
          : copy.queued
        : lessonReviewNeedsOperator(review) || operatorRequired
          ? copy.unresolved
          : review?.state === "failed"
            ? copy.failed
            : review?.state === "cancelled"
              ? copy.cancelled
              : review && !complete
                ? copy.incomplete
                : null;

  return (
    <section aria-label={copy.title}>
      <Panel title={copy.title}>
        <p>{copy.intro}</p>
        <p>
          <strong>{version ? copy.generatedVersion(version) : copy.originalVersion}</strong>
        </p>
        <p>{hasEdits ? copy.edited : copy.scope}</p>
        <p className="workspace-muted">{copy.advisory}</p>
        {stateText ? <Status>{stateText}</Status> : null}
        {problem ? <Status tone="error">{problem}</Status> : null}
        {complete && review?.response && review.verdict ? (
          <>
            <Status>{copy.verdict[review.verdict]}</Status>
            {review.response.checks.map((check) => (
              <details className={styles.evidence} key={check.criterion}>
                <summary>
                  {copy.criterion[check.criterion]} · {copy.status[check.status]}
                </summary>
                <div className={styles.evidenceBody}>
                  <ContentBlock as="p" dir="auto">
                    {check.reason}
                  </ContentBlock>
                  {check.findings.map((finding) => (
                    <article className="workspace-list-item" key={JSON.stringify(finding)}>
                      <p className={styles.issueName}>
                        {copy.target}: <bdi>{finding.targetId}</bdi>
                      </p>
                      <ContentBlock as="p" dir="auto">
                        “{finding.quote}”
                      </ContentBlock>
                      <ContentBlock as="p" dir="auto">
                        {finding.explanation}
                      </ContentBlock>
                      {finding.suggestion ? (
                        <>
                          <p>
                            <strong>{copy.suggestion}:</strong>
                          </p>
                          <ContentBlock as="p" dir="auto">
                            {finding.suggestion}
                          </ContentBlock>
                        </>
                      ) : null}
                      {finding.evidenceKeys.length ? (
                        <p className={styles.issueName}>
                          {copy.evidence}: <bdi>{finding.evidenceKeys.join(", ")}</bdi>
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </details>
            ))}
          </>
        ) : null}
        <Actions>
          {canRequest ? (
            <Button
              secondary
              disabled={submitting || checking}
              onClick={() => void requestReview()}
            >
              {uncertainRequest ? copy.retryRequest : review ? copy.retry : copy.start}
            </Button>
          ) : null}
          {!loading && !unavailable && (pending || problem || review) ? (
            <Button secondary disabled={submitting || checking} onClick={() => void load()}>
              {copy.check}
            </Button>
          ) : null}
        </Actions>
        <details className={styles.evidence}>
          <summary>{copy.details}</summary>
          <div className={styles.evidenceBody}>
            <p className={styles.issueName}>
              {copy.versionId}: <bdi>{knowledgeVersionId}</bdi>
            </p>
            {review ? (
              <>
                <p>{copy.checked(new Date(review.createdAt).toLocaleString("en-GB"))}</p>
                <p className={styles.issueName}>
                  {copy.model}: <bdi>{review.reviewerModel}</bdi>
                </p>
                <p className={styles.issueName}>
                  {copy.rubric}: <bdi>{review.rubricVersion}</bdi>
                </p>
              </>
            ) : null}
          </div>
        </details>
      </Panel>
    </section>
  );
}
