"use client";
import {
  type ClassVoiceView,
  type VoiceAnalysisView,
  type VoiceCandidate,
  voiceCoverage,
} from "@recalino/core/voice-contracts";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { fillCopy, pendingCopy } from "../pending-copy";
import { requestKey, WorkspaceRequestError, workspaceRequest } from "../workspace/api";
import { Actions, Button, LinkButton, Panel, Status } from "../workspace/primitives";
import {
  type ClassVoiceAction,
  ClassVoiceConfirmation,
  classConfirmationActive,
  coveredByClass,
} from "./ClassVoiceConfirmation";
import { voiceSettingsHref } from "./navigation";
import { OriginalRecovery } from "./OriginalRecovery";
import styles from "./Voice.module.css";
import { useLocalVoiceAudio, VoiceClips } from "./VoiceClips";
import { type VoiceLineAction, VoiceLines } from "./VoiceLines";
import { voiceCopy } from "./voice-copy";

type Action =
  | { action: "analyze" }
  | {
      action: "confirm" | "reject" | "none" | "revoke";
      analysisId: string;
      expectedVersion: number;
      speakerId?: string;
    }
  | ClassVoiceAction
  | VoiceLineAction;

/** A service spending limit, not a failed check: retrying cannot help and is not offered. */
function isServiceBlocked(analysis: VoiceAnalysisView) {
  return Boolean(
    analysis.reason?.startsWith("voice_correction_") &&
      analysis.reason.endsWith("_service_blocked"),
  );
}

/** A voice is confirmed by listening (D55); saved lines alone are not enough to decide. */
function hasSpeakerExcerpts(candidate: VoiceCandidate) {
  return candidate.clips.length > 0;
}

/** Children are hidden while a changed attribution and its refreshed notes are being reconciled. */
export function VoiceConfirmation({
  sessionId,
  userId,
  children,
  compact = false,
}: {
  sessionId: string;
  userId: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<ClassVoiceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [choosing, setChoosing] = useState<Set<string>>(() => new Set());
  const [notesSafe, setNotesSafe] = useState(true);
  const [refreshRequested, setRefreshRequested] = useState(false);
  // Sources that ask for a choice but cannot play their excerpts on this device (D55).
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(() => new Set());
  const reportWaiting = useCallback((analysisId: string, value: boolean) => {
    setWaiting((current) => {
      if (current.has(analysisId) === value) return current;
      const next = new Set(current);
      if (value) next.add(analysisId);
      else next.delete(analysisId);
      return next;
    });
  }, []);
  const [refreshing, startTransition] = useTransition();
  const inFlight = useRef(false);
  const playing = useRef<HTMLAudioElement | null>(null);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const endpoint = `/api/classes/${sessionId}/voice`;
  const processing = Boolean(
    view?.processing || view?.analyses.some((analysis) => analysis.status === "processing"),
  );
  const confirmable =
    view?.analyses.filter(
      (analysis) =>
        analysis.status === "unverified" && analysis.candidates.some(hasSpeakerExcerpts),
    ) ?? [];
  const needsConfirmation = confirmable.length > 0;
  const confirmationWaits = needsConfirmation && confirmable.every(({ id }) => waiting.has(id));
  const hasFailedCheck = Boolean(
    view?.analyses.some(
      (analysis) =>
        analysis.status === "failed" ||
        (analysis.reason?.startsWith("voice_correction_") && !isServiceBlocked(analysis)),
    ),
  );
  const hasServiceBlock = Boolean(view?.analyses.some(isServiceBlocked));
  const hasUnavailableExcerpts = Boolean(
    view?.analyses.some(
      (analysis) =>
        analysis.status === "unavailable" ||
        (analysis.status === "unverified" && !analysis.candidates.some(hasSpeakerExcerpts)),
    ),
  );
  async function load(signal?: AbortSignal) {
    const result = await workspaceRequest<ClassVoiceView>(endpoint, "GET", undefined, undefined, {
      signal,
    });
    setView(result);
    return result;
  }
  useEffect(() => {
    const abort = new AbortController();
    void workspaceRequest<ClassVoiceView>(endpoint, "GET", undefined, undefined, {
      signal: abort.signal,
    })
      .then(setView)
      .catch((error) => {
        if (!abort.signal.aborted)
          setProblem(
            error instanceof Error ? error.message : "Voice confirmation could not be loaded.",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      playing.current?.pause();
    };
  }, [endpoint]);
  useEffect(() => {
    if (
      !(view?.processing || view?.analyses.some((analysis) => analysis.status === "processing")) ||
      busy ||
      pending
    )
      return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void workspaceRequest<ClassVoiceView>(endpoint, "GET", undefined, undefined, {
        signal: abort.signal,
      })
        .then((result) => {
          setView(result);
          setProblem("");
          if (
            !result.processing &&
            !result.analyses.some((analysis) => analysis.status === "processing")
          ) {
            setNotesSafe(false);
            setRefreshRequested(true);
            startTransition(() => router.refresh());
          }
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setProblem(
              error instanceof Error
                ? error.message
                : "Voice analysis status could not be refreshed.",
            );
        });
    }, 4000);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [view, busy, pending, endpoint, router]);
  useEffect(() => {
    if (refreshRequested && !refreshing) {
      setNotesSafe(true);
      setRefreshRequested(false);
    }
  }, [refreshRequested, refreshing]);
  function refreshNotes() {
    setRefreshRequested(true);
    startTransition(() => router.refresh());
  }
  async function act(payload: Action) {
    if (inFlight.current || refreshing) return;
    inFlight.current = true;
    setBusy(true);
    setProblem("");
    setPending(payload);
    setNotesSafe(false);
    playing.current?.pause();
    let submitted = false;
    try {
      await workspaceRequest(endpoint, "POST", payload, requestKey(key, payload));
      submitted = true;
      await load();
      if (
        !("scope" in payload) &&
        "analysisId" in payload &&
        (payload.action === "reject" || payload.action === "revoke")
      )
        setChoosing((current) => new Set(current).add(payload.analysisId));
      setPending(null);
      key.current = null;
      refreshNotes();
    } catch (error) {
      setProblem(
        error instanceof WorkspaceRequestError &&
          error.fields?.voice?.includes("original_audio_required")
          ? "The temporary session recording is no longer available. Checking session voices needs the original session recording, even if you have saved a personal voice sample."
          : error instanceof Error
            ? error.message
            : "Your choice could not be saved. Try again.",
      );
      if (
        "action" in payload &&
        payload.action === "analyze" &&
        !submitted &&
        error instanceof WorkspaceRequestError &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 409, 429].includes(error.status)
      ) {
        // A rejected check changed no attribution. Do not treat it as an uncertain voice choice.
        if (!pending) {
          setPending(null);
          key.current = null;
          setNotesSafe(true);
          await load().catch(() => {});
        } else {
          // An earlier interrupted attempt may have been accepted. Reconcile its notes first.
          try {
            await load();
            setPending(null);
            key.current = null;
            refreshNotes();
          } catch {
            /* Keep the uncertain request until the server can be read again. */
          }
        }
      }
      if (error instanceof WorkspaceRequestError && error.status === 409) {
        try {
          await load();
          setPending(null);
          key.current = null;
          refreshNotes();
          setProblem(
            "action" in payload && payload.action === "analyze"
              ? "The session changed or is already being processed. Check its current sources and voice status before trying again."
              : "These voice excerpts have changed. Please check the current excerpts before choosing again.",
          );
        } catch {
          /* Keep the same pending request and notes hidden until recovery succeeds. */
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function onPlayback(element: HTMLAudioElement) {
    if (playing.current !== element) playing.current?.pause();
    playing.current = element;
  }
  const locked = busy || !!pending || refreshing || processing;
  const controls = (
    <Panel title="Your voice in this session">
      {loading ? <Status>Loading voice confirmation…</Status> : null}
      {problem ? <Status tone="error">{problem}</Status> : null}
      {pending && !busy ? (
        <>
          <p>
            {"action" in pending && pending.action === "analyze"
              ? "The server has not confirmed your voice check yet. Retry to resolve it before showing the notes."
              : "Your last choice still needs to be confirmed by the server. The notes stay hidden until this is resolved."}
          </p>
          <Button disabled={busy} onClick={() => void act(pending)}>
            {"action" in pending && pending.action === "analyze"
              ? "Retry voice check"
              : "Retry voice choice"}
          </Button>
        </>
      ) : !view && !loading ? (
        <Button
          secondary
          onClick={() => {
            setLoading(true);
            setProblem("");
            void load()
              .catch((error) =>
                setProblem(
                  error instanceof Error ? error.message : "Could not load voice confirmation.",
                ),
              )
              .finally(() => setLoading(false));
          }}
        >
          Retry voice confirmation
        </Button>
      ) : problem && view ? (
        <Button
          secondary
          disabled={busy || refreshing}
          onClick={() => {
            setBusy(true);
            void load()
              .then(() => {
                setProblem("");
                refreshNotes();
              })
              .catch((error) =>
                setProblem(
                  error instanceof Error ? error.message : "Could not refresh voice confirmation.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Refresh voice status
        </Button>
      ) : null}
      {view && !view.enabled ? (
        <>
          <p>
            Voice identification is optional. Enable it to identify your speech before Recalino
            includes your spoken mistakes.
          </p>
          <LinkButton secondary href={voiceSettingsHref(sessionId)}>
            Set up your voice
          </LinkButton>
        </>
      ) : view ? (
        <div className={styles.stack}>
          {/* With one choice per class (D64) the parts are not checked one by one. */}
          {classConfirmationActive(view) ? null : (
            <p className="preview-muted">
              Check each source separately. A speaker label in one recording may belong to someone
              else in another. Written mistakes remain available independently.
            </p>
          )}
          {!view.engineAvailable ? (
            <Status>
              Audio matching is not available. Labelled transcripts can still be confirmed by
              checking the excerpts below.
            </Status>
          ) : null}
          <p className="preview-muted">
            Check the selected session recordings for speakers, then identify which voice is yours.
            A saved voice sample can help suggest a match.
          </p>
          {!processing &&
            (view.analysisBlockedReason === "transcript_required" ||
            view.analysisBlockedReason === "sources_unavailable" ? (
              <Status>
                Select a session recording in Sources and process it before checking session voices.
                <LinkButton secondary href={`/sessions/${sessionId}/sources`}>
                  Open session sources
                </LinkButton>
              </Status>
            ) : view.analysisBlockedReason === "original_audio_required" ? (
              <Status>
                The temporary session recording is no longer available. Checking session voices
                needs the original session recording, even if you have saved a personal voice
                sample.
                <LinkButton secondary href={`/sessions/${sessionId}/sources`}>
                  Open session sources
                </LinkButton>
              </Status>
            ) : view.analysisBlockedReason === "explanation_language_missing" ? (
              <Status>
                Choose your explanation language in your profile before checking session voices.
              </Status>
            ) : null)}
          <Actions>
            <Button
              secondary
              disabled={locked || Boolean(view.analysisBlockedReason)}
              onClick={() => void act({ action: "analyze" })}
            >
              {processing ? "Checking session voices…" : "Check session voices"}
            </Button>
            <LinkButton secondary href={voiceSettingsHref(sessionId)}>
              Voice settings
            </LinkButton>
          </Actions>
          {processing ? (
            <Status>Preparing speaker excerpts from the session sources…</Status>
          ) : !view.analyses.length ? (
            <p>No speaker excerpts have been prepared for this session yet.</p>
          ) : (
            <Status>
              {confirmationWaits
                ? voiceCopy.confirmBlockedSummary
                : needsConfirmation
                  ? "Voice check finished. Next, confirm which speaker is you below. Checking voices prepares suggestions; your spoken mistakes are included only after your voice is verified."
                  : hasFailedCheck
                    ? "Some recordings could not be checked. Retry the voice check below, or continue with your session notes."
                    : hasServiceBlock
                      ? voiceCopy.serviceBlockedSummary
                      : hasUnavailableExcerpts
                        ? "Voice check finished, but some recordings have no usable speaker excerpts. Check their source material below, or continue with your session notes."
                        : "Your voice choices are saved. The session notes below reflect those choices."}
            </Status>
          )}
          {classConfirmationActive(view) ? (
            <ClassVoiceConfirmation
              view={view}
              userId={userId}
              disabled={locked}
              onAction={act}
              onPlayback={onPlayback}
            />
          ) : null}
          {view.analyses.map((analysis, index) => (
            <Analysis
              covered={coveredByClass(view, analysis)}
              key={`${analysis.id}-${analysis.version}`}
              analysis={analysis}
              index={index}
              sessionId={sessionId}
              userId={userId}
              disabled={locked}
              retryDisabled={locked || Boolean(view.analysisBlockedReason)}
              chooseAll={choosing.has(analysis.id)}
              onWaiting={reportWaiting}
              onAction={act}
              onPlayback={onPlayback}
            />
          ))}
          {children && !locked && view.analyses.length ? (
            <Actions>
              <LinkButton href="#class-notes">Read session notes</LinkButton>
            </Actions>
          ) : null}
        </div>
      ) : null}
      {busy || refreshing ? (
        <Status>
          {busy
            ? pending && "action" in pending && pending.action === "analyze"
              ? "Requesting a session voice check…"
              : "Saving your voice choice…"
            : "Refreshing your session notes…"}
        </Status>
      ) : null}
    </Panel>
  );
  return (
    <>
      {compact ? (
        <details
          className={styles.readerVoice}
          open={!!problem || !!pending || !notesSafe || needsConfirmation || undefined}
        >
          <summary>Voice settings for this session</summary>
          {controls}
        </details>
      ) : (
        controls
      )}
      {children ? (
        notesSafe ? (
          <div id="class-notes" className="preview-stack">
            {children}
          </div>
        ) : (
          <Status>Updating voice attribution before showing the session notes…</Status>
        )
      ) : null}
    </>
  );
}

function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function Analysis({
  covered,
  analysis,
  index,
  sessionId,
  userId,
  disabled,
  retryDisabled,
  chooseAll,
  onWaiting,
  onAction,
  onPlayback,
}: {
  /** The class-level choice (D64) decides this part; it shows status and recovery only. */
  covered: boolean;
  analysis: VoiceAnalysisView;
  index: number;
  sessionId: string;
  userId: string;
  disabled: boolean;
  retryDisabled: boolean;
  chooseAll: boolean;
  /** Whether this source asks for a choice it cannot offer until its excerpts play here. */
  onWaiting: (analysisId: string, value: boolean) => void;
  onAction: (payload: Action) => Promise<void>;
  onPlayback: (element: HTMLAudioElement) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [linked, setLinked] = useState(false);
  const linkedStatus = useRef<HTMLDivElement>(null);
  const audio = useLocalVoiceAudio(userId, analysis.sourceId, revision);
  // After a relink the recovery controls give way to the excerpts; say so and keep focus here.
  useEffect(() => {
    if (linked && audio.state === "playable") linkedStatus.current?.focus();
  }, [linked, audio.state]);
  const coverage = voiceCoverage(analysis.reason);
  const verified = analysis.status === "verified";
  // Fragments are never suggested or offered one by one; they wait in their own group.
  const short = new Set(analysis.shortCandidateIds ?? []);
  const available = analysis.candidates.filter(
    (candidate) => hasSpeakerExcerpts(candidate) && !short.has(candidate.id),
  );
  const shortVoices = analysis.candidates.filter(
    (candidate) => hasSpeakerExcerpts(candidate) && short.has(candidate.id),
  );
  const suggested = available.find((candidate) => candidate.id === analysis.candidateId);
  const speaker = analysis.candidates.find(
    (candidate) => candidate.id === analysis.verifiedSpeakerId,
  );
  const listing = !(suggested && !chooseAll);
  const candidates = verified
    ? []
    : !listing && suggested
      ? [suggested]
      : available.length
        ? available
        : shortVoices;
  const grouped = listing && available.length ? shortVoices : [];
  const waitsForPlayback =
    analysis.status === "unverified" &&
    candidates.length > 0 &&
    audio.state !== "loading" &&
    audio.state !== "playable";
  useEffect(() => {
    onWaiting(analysis.id, waitsForPlayback);
    return () => onWaiting(analysis.id, false);
  }, [analysis.id, waitsForPlayback, onWaiting]);
  const labels: Record<VoiceAnalysisView["status"], string> = {
    verified: "Voice verified",
    processing: "Preparing excerpts",
    none: "No voice selected",
    unavailable: "No usable excerpts",
    failed: "Voice check failed",
    unverified: candidates.length ? "Needs confirmation" : "No usable excerpts",
  };
  function action(kind: "confirm" | "reject" | "none" | "revoke", speakerId?: string) {
    void onAction({
      action: kind,
      analysisId: analysis.id,
      expectedVersion: analysis.version,
      ...(speakerId ? { speakerId } : {}),
    });
  }
  const card = (candidate: VoiceCandidate) => (
    <div key={candidate.id} className={styles.aside}>
      <strong dir="auto">{candidate.label}</strong>
      <VoiceClips
        candidate={candidate}
        audioUrl={audio.url}
        limit={suggested && !chooseAll ? 3 : 1}
        onPlayback={onPlayback}
      />
      <p className={styles.question} lang="fa" dir="rtl">
        این صدای توست؟
      </p>
      <Actions>
        <Button disabled={disabled} onClick={() => action("confirm", candidate.id)}>
          Yes, this is my voice
        </Button>
        {suggested && !chooseAll ? (
          <Button secondary disabled={disabled} onClick={() => action("reject", candidate.id)}>
            No, show other speakers
          </Button>
        ) : null}
      </Actions>
    </div>
  );
  return (
    <section className={styles.candidate} aria-label={`Source ${index + 1} voice confirmation`}>
      <div className={styles.heading}>
        <h3 dir="auto">{analysis.source?.name ?? `Session source ${index + 1}`}</h3>
        <span className={styles.badge}>{labels[analysis.status]}</span>
      </div>
      {analysis.source ? (
        <p className="preview-muted">
          Session source {index + 1}
          {analysis.source.durationMs ? ` · ${duration(analysis.source.durationMs)}` : ""}
        </p>
      ) : null}
      {coverage === "sampled_audio" || coverage === "sampled_partial_audio" ? (
        <p className="preview-muted">
          This long recording was checked using excerpts sampled across your selected class audio.
          Only speech in those checked excerpts can contribute spoken mistakes. Your full transcript
          and session notes remain available.
        </p>
      ) : null}
      {coverage === "partial_audio" || coverage === "sampled_partial_audio" ? (
        <p className="preview-muted">{voiceCopy.partialCoverage}</p>
      ) : null}
      {isServiceBlocked(analysis) ? (
        <Status>{voiceCopy.serviceBlockedDetail}</Status>
      ) : analysis.reason?.startsWith("voice_correction_") ? (
        <Status tone="error">
          Speakers were prepared, but spoken mistakes could not be checked. You can confirm your
          speaker below and retry the session voice check when you are ready.
        </Status>
      ) : null}
      {verified ? (
        <>
          <p>
            {speaker?.label ?? "Your speaker"} ·{" "}
            {analysis.verificationMethod === "automatic"
              ? "Matched from your previously confirmed voice."
              : "Confirmed by you."}
          </p>
          <p className="preview-muted">
            Only eligible speech attributed to this speaker can contribute spoken mistakes.
          </p>
          {analysis.verificationMethod === "manual" && analysis.referenceStatus ? (
            <p className="preview-muted">{voiceCopy.reference[analysis.referenceStatus]}</p>
          ) : null}
          <Button secondary disabled={disabled} onClick={() => action("revoke")}>
            This is not my voice
          </Button>
        </>
      ) : analysis.status === "processing" ? (
        <Status>Preparing speaker excerpts. You can keep using the rest of your session.</Status>
      ) : analysis.status === "none" ? (
        <p>
          None of these speakers was selected as you. Spoken mistakes from this source are withheld.
        </p>
      ) : analysis.status === "failed" ? (
        <>
          <p>
            The voices in this source could not be checked. Your saved session notes remain
            available.
          </p>
          <Button
            secondary
            disabled={retryDisabled}
            onClick={() => void onAction({ action: "analyze" })}
          >
            Retry session voice check
          </Button>
        </>
      ) : analysis.status === "unavailable" || !candidates.length ? (
        <>
          <p>
            This source does not have usable speaker excerpts to confirm. Spoken mistakes from it
            are withheld; your other session notes remain available.
          </p>
          <LinkButton secondary href={`/sessions/${sessionId}/sources`}>
            Check source material
          </LinkButton>
        </>
      ) : (
        <>
          {analysis.matchReason ? (
            <p className="preview-muted">{voiceCopy.match[analysis.matchReason]}</p>
          ) : null}
          {audio.state === "playable" ? (
            <>
              {linked ? (
                <div ref={linkedStatus} tabIndex={-1}>
                  <Status tone="success">{voiceCopy.playback.linked}</Status>
                </div>
              ) : null}
              {covered ? (
                <p>{pendingCopy.voiceDetection.coveredByClass}</p>
              ) : (
                <>
                  <p>{voiceCopy.listenPrompt}</p>
                  {candidates.map(card)}
                  {grouped.length ? (
                    <details>
                      <summary>
                        {fillCopy(pendingCopy.voiceDetection.shortVoices, {
                          count: grouped.length,
                        })}
                      </summary>
                      <p className="preview-muted">
                        {pendingCopy.voiceDetection.shortVoicesDetail}
                      </p>
                      {grouped.map(card)}
                    </details>
                  ) : null}
                </>
              )}
              {covered ? null : (
                <Actions>
                  <Button secondary disabled={disabled} onClick={() => action("none")}>
                    None of these voices is mine
                  </Button>
                </Actions>
              )}
            </>
          ) : (
            <>
              {/* Nothing to confirm until the excerpts can play here (D55): the warning names the
                  next step, and the excerpts it refers to stay readable without any choice. */}
              <OriginalRecovery
                userId={userId}
                sessionId={sessionId}
                sourceId={analysis.sourceId}
                source={analysis.source}
                state={audio.state}
                disabled={disabled}
                onChanged={(wasLinked) => {
                  if (wasLinked) setLinked(true);
                  setRevision((value) => value + 1);
                }}
              />
              {audio.state === "loading"
                ? null
                : candidates.map((candidate) => (
                    <div key={candidate.id} className={styles.aside}>
                      <strong dir="auto">{candidate.label}</strong>
                      <VoiceClips
                        candidate={candidate}
                        audioUrl={null}
                        limit={suggested && !chooseAll ? 3 : 1}
                        onPlayback={onPlayback}
                      />
                    </div>
                  ))}
            </>
          )}
        </>
      )}
      {analysis.status !== "processing" && analysis.status !== "failed" ? (
        <VoiceLines analysis={analysis} disabled={disabled} onAction={onAction} />
      ) : null}
    </section>
  );
}
