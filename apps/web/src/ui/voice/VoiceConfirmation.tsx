"use client";
import type {
  ClassVoiceView,
  VoiceAnalysisView,
  VoiceCandidate,
} from "@recalino/core/voice-contracts";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { requestKey, WorkspaceRequestError, workspaceRequest } from "../workspace/api";
import { Actions, Button, LinkButton, Panel, Status } from "../workspace/primitives";
import { voiceSettingsHref } from "./navigation";
import styles from "./Voice.module.css";
import { useLocalVoiceAudio, VoiceClips } from "./VoiceClips";

type Action =
  | { action: "analyze" }
  | {
      action: "confirm" | "reject" | "none" | "revoke";
      analysisId: string;
      expectedVersion: number;
      speakerId?: string;
    };

/** A service spending limit, not a failed check: retrying cannot help and is not offered. */
function isServiceBlocked(analysis: VoiceAnalysisView) {
  return Boolean(
    analysis.reason?.startsWith("voice_correction_") &&
      analysis.reason.endsWith("_service_blocked"),
  );
}

function hasSpeakerExcerpts(candidate: VoiceCandidate) {
  return candidate.clips.length > 0 || candidate.lines.some((line) => line.trim().length > 0);
}

/** Children are hidden while a changed attribution and its refreshed notes are being reconciled. */
export function VoiceConfirmation({
  sessionId,
  userId,
  children,
}: {
  sessionId: string;
  userId: string;
  children?: ReactNode;
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
  const [refreshing, startTransition] = useTransition();
  const inFlight = useRef(false);
  const playing = useRef<HTMLAudioElement | null>(null);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const endpoint = `/api/classes/${sessionId}/voice`;
  const processing = Boolean(
    view?.processing || view?.analyses.some((analysis) => analysis.status === "processing"),
  );
  const needsConfirmation = Boolean(
    view?.analyses.some(
      (analysis) =>
        analysis.status === "unverified" && analysis.candidates.some(hasSpeakerExcerpts),
    ),
  );
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
      if (payload.action === "reject" || payload.action === "revoke")
        setChoosing((current) => new Set(current).add(payload.analysisId));
      setPending(null);
      key.current = null;
      refreshNotes();
    } catch (error) {
      setProblem(
        error instanceof WorkspaceRequestError &&
          error.fields?.voice?.includes("original_audio_required")
          ? "The temporary class recording is no longer available. Checking class voices needs the original class recording, even if you have saved a personal voice sample. Open class sources to restore the original recording."
          : error instanceof Error
            ? error.message
            : "Your choice could not be saved. Try again.",
      );
      if (
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
            payload.action === "analyze"
              ? "The class changed or is already being processed. Check its current sources and voice status before trying again."
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
  return (
    <>
      <Panel title="Your voice in this class">
        {loading ? <Status>Loading voice confirmation…</Status> : null}
        {problem ? <Status tone="error">{problem}</Status> : null}
        {pending && !busy ? (
          <>
            <p>
              {pending.action === "analyze"
                ? "The server has not confirmed your voice check yet. Retry to resolve it before showing the notes."
                : "Your last choice still needs to be confirmed by the server. The notes stay hidden until this is resolved."}
            </p>
            <Button disabled={busy} onClick={() => void act(pending)}>
              {pending.action === "analyze" ? "Retry voice check" : "Retry voice choice"}
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
                    error instanceof Error
                      ? error.message
                      : "Could not refresh voice confirmation.",
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
            <p className="preview-muted">
              Check each source separately. A speaker label in one recording may belong to someone
              else in another. Written mistakes remain available independently.
            </p>
            {!view.engineAvailable ? (
              <Status>
                Audio matching is not available. Labelled transcripts can still be confirmed by
                checking the excerpts below.
              </Status>
            ) : null}
            <p className="preview-muted">
              Check the selected class recordings for speakers, then identify which voice is yours.
              A saved voice sample can help suggest a match.
            </p>
            {!processing &&
              (view.analysisBlockedReason === "transcript_required" ||
              view.analysisBlockedReason === "sources_unavailable" ? (
                <Status>
                  Select a class recording in Sources and process it before checking class voices.
                  <LinkButton secondary href={`/classes/${sessionId}/sources`}>
                    Open class sources
                  </LinkButton>
                </Status>
              ) : view.analysisBlockedReason === "original_audio_required" ? (
                <Status>
                  The temporary class recording is no longer available. Checking class voices needs
                  the original class recording, even if you have saved a personal voice sample.
                  <LinkButton secondary href={`/classes/${sessionId}/sources`}>
                    Restore class recording
                  </LinkButton>
                </Status>
              ) : view.analysisBlockedReason === "explanation_language_missing" ? (
                <Status>
                  Choose your explanation language in your profile before checking class voices.
                </Status>
              ) : null)}
            <Actions>
              <Button
                secondary
                disabled={locked || Boolean(view.analysisBlockedReason)}
                onClick={() => void act({ action: "analyze" })}
              >
                {processing ? "Checking class voices…" : "Check class voices"}
              </Button>
              <LinkButton secondary href={voiceSettingsHref(sessionId)}>
                Voice settings
              </LinkButton>
            </Actions>
            {processing ? (
              <Status>Preparing speaker excerpts from the class sources…</Status>
            ) : !view.analyses.length ? (
              <p>No speaker excerpts have been prepared for this class yet.</p>
            ) : (
              <Status>
                {needsConfirmation
                  ? "Voice check finished. Next, confirm which speaker is you below. Checking voices prepares suggestions; your spoken mistakes are included only after your voice is verified."
                  : hasFailedCheck
                    ? "Some recordings could not be checked. Retry the voice check below, or continue with your class notes."
                    : hasServiceBlock
                      ? "Spoken mistakes were not checked because this class reached a Recalino service limit. This is not your personal allowance. Your class notes remain available."
                      : hasUnavailableExcerpts
                        ? "Voice check finished, but some recordings have no usable speaker excerpts. Check their source material below, or continue with your class notes."
                        : "Your voice choices are saved. The class notes below reflect those choices."}
              </Status>
            )}
            {view.analyses.map((analysis, index) => (
              <Analysis
                key={`${analysis.id}-${analysis.version}`}
                analysis={analysis}
                index={index}
                sessionId={sessionId}
                userId={userId}
                disabled={locked}
                retryDisabled={locked || Boolean(view.analysisBlockedReason)}
                chooseAll={choosing.has(analysis.id)}
                onAction={act}
                onPlayback={onPlayback}
              />
            ))}
            {children && !locked && view.analyses.length ? (
              <Actions>
                <LinkButton href="#class-notes">Read class notes</LinkButton>
              </Actions>
            ) : null}
          </div>
        ) : null}
        {busy || refreshing ? (
          <Status>
            {busy
              ? pending?.action === "analyze"
                ? "Requesting a class voice check…"
                : "Saving your voice choice…"
              : "Refreshing your class notes…"}
          </Status>
        ) : null}
      </Panel>
      {children ? (
        notesSafe ? (
          <div id="class-notes" className="preview-stack">
            {children}
          </div>
        ) : (
          <Status>Updating voice attribution before showing the class notes…</Status>
        )
      ) : null}
    </>
  );
}

function Analysis({
  analysis,
  index,
  sessionId,
  userId,
  disabled,
  retryDisabled,
  chooseAll,
  onAction,
  onPlayback,
}: {
  analysis: VoiceAnalysisView;
  index: number;
  sessionId: string;
  userId: string;
  disabled: boolean;
  retryDisabled: boolean;
  chooseAll: boolean;
  onAction: (payload: Action) => Promise<void>;
  onPlayback: (element: HTMLAudioElement) => void;
}) {
  const audio = useLocalVoiceAudio(userId, analysis.sourceId);
  const verified = analysis.status === "verified";
  const available = analysis.candidates.filter(hasSpeakerExcerpts);
  const suggested = available.find((candidate) => candidate.id === analysis.candidateId);
  const speaker = analysis.candidates.find(
    (candidate) => candidate.id === analysis.verifiedSpeakerId,
  );
  const candidates = verified ? [] : suggested && !chooseAll ? [suggested] : available;
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
  return (
    <section className={styles.candidate} aria-label={`Source ${index + 1} voice confirmation`}>
      <div className={styles.heading}>
        <h3>Class source {index + 1}</h3>
        <span className={styles.badge}>{labels[analysis.status]}</span>
      </div>
      {analysis.reason?.includes("sampled_audio") ? (
        <p className="preview-muted">
          This long recording was checked using excerpts sampled across your selected class audio.
          Only speech in those checked excerpts can contribute spoken mistakes. Your full transcript
          and class notes remain available.
        </p>
      ) : null}
      {isServiceBlocked(analysis) ? (
        <Status>
          Speakers were prepared, but spoken mistakes were not checked because this class reached a
          Recalino service limit. This is not your personal allowance, and retrying the voice check
          will not change it. You can still confirm your speaker below.
        </Status>
      ) : analysis.reason?.startsWith("voice_correction_") ? (
        <Status tone="error">
          Speakers were prepared, but spoken mistakes could not be checked. You can confirm your
          speaker below and retry the class voice check when you are ready.
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
          <Button secondary disabled={disabled} onClick={() => action("revoke")}>
            This is not my voice
          </Button>
        </>
      ) : analysis.status === "processing" ? (
        <Status>Preparing speaker excerpts. You can keep using the rest of your class.</Status>
      ) : analysis.status === "none" ? (
        <p>
          None of these speakers was selected as you. Spoken mistakes from this source are withheld.
        </p>
      ) : analysis.status === "failed" ? (
        <>
          <p>
            The voices in this source could not be checked. Your saved class notes remain available.
          </p>
          <Button
            secondary
            disabled={retryDisabled}
            onClick={() => void onAction({ action: "analyze" })}
          >
            Retry class voice check
          </Button>
        </>
      ) : analysis.status === "unavailable" || !candidates.length ? (
        <>
          <p>
            This source does not have usable speaker excerpts to confirm. Spoken mistakes from it
            are withheld; your other class notes remain available.
          </p>
          <LinkButton secondary href={`/classes/${sessionId}/sources`}>
            Check source material
          </LinkButton>
        </>
      ) : (
        <>
          <p>
            Listen to the excerpts or read the speaker’s lines, then confirm which voice is yours.
          </p>
          {!audio.loading && !audio.url ? (
            <p className="preview-muted">
              Original audio is not on this device. Use these saved speaker excerpts to identify
              your voice.
            </p>
          ) : null}
          {candidates.map((candidate) => (
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
                  <Button
                    secondary
                    disabled={disabled}
                    onClick={() => action("reject", candidate.id)}
                  >
                    No, show other speakers
                  </Button>
                ) : null}
              </Actions>
            </div>
          ))}
          <Actions>
            <Button secondary disabled={disabled} onClick={() => action("none")}>
              None of these voices is mine
            </Button>
          </Actions>
        </>
      )}
    </section>
  );
}
