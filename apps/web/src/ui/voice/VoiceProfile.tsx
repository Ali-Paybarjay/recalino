"use client";
import { VOICE_CONSENT_VERSION, type VoiceProfileView } from "@recalino/core/voice-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet } from "../components/Sheet";
import { useRecording } from "../recording/RecordingProvider";
import { requestKey, WorkspaceRequestError, workspaceRequest } from "../workspace/api";
import { Actions, Button, LinkButton, Panel, Status } from "../workspace/primitives";
import { sampleBase64, type VoiceCaptureState, VoiceSampleCapture } from "./sample-capture";
import styles from "./Voice.module.css";

export function VoiceProfile() {
  const { state } = useRecording();
  const captureBlocked =
    state.accountDeletionBlocked ||
    ["starting", "recording", "recovering", "paused", "saving"].includes(state.phase);
  return <VoiceProfileForm captureBlocked={captureBlocked} />;
}

/** The standalone form also powers the guarded synthetic browser fixture. */
export function VoiceProfileForm({
  captureBlocked = false,
  onComplete,
}: {
  captureBlocked?: boolean;
  /** Optional onboarding: save a sample or skip without changing voice consent. */
  onComplete?: () => void;
}) {
  const [profile, setProfile] = useState<VoiceProfileView | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [capture, setCapture] = useState<VoiceCaptureState>({
    phase: "idle",
    elapsedMs: 0,
    sample: null,
    error: null,
  });
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [recorder] = useState(() => new VoiceSampleCapture(setCapture));
  const blocked = useRef(captureBlocked);
  blocked.current = captureBlocked;
  const inFlight = useRef(false);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const capturing = capture.phase === "recording" || capture.phase === "requesting";
  const captureError =
    onComplete && capture.error?.startsWith("Microphone access was not allowed.")
      ? 'Microphone access was not allowed. You can try again or choose "Do this later".'
      : capture.error;

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await workspaceRequest<VoiceProfileView>(
      "/api/me/voice",
      "GET",
      undefined,
      undefined,
      { signal },
    );
    setProfile(result);
    setConsent(result.enabled && result.consentVersion === VOICE_CONSENT_VERSION);
    return result;
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal)
      .catch((error) => {
        if (!abort.signal.aborted)
          setProblem(
            error instanceof Error ? error.message : "Your voice settings could not be loaded.",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      recorder.cancel();
    };
  }, [recorder, load]);
  useEffect(() => {
    if (!capture.sample) {
      setSampleUrl(null);
      return;
    }
    const url = URL.createObjectURL(capture.sample.blob);
    setSampleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [capture.sample]);
  useEffect(() => {
    if (captureBlocked && capturing) {
      recorder.cancel();
      setCapture({ phase: "idle", elapsedMs: 0, sample: null, error: null });
      setProblem("Finish your class recording before recording a voice sample.");
    }
  }, [captureBlocked, capturing, recorder]);

  async function save(withSample: boolean) {
    if (!consent || inFlight.current || capturing || (withSample && !capture.sample)) return;
    inFlight.current = true;
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const payload = {
        consent: true,
        consentVersion: VOICE_CONSENT_VERSION,
        ...(profile?.version !== undefined ? { expectedVersion: profile.version } : {}),
        ...(withSample && capture.sample
          ? {
              audioBase64: await sampleBase64(capture.sample.blob),
              mimeType: capture.sample.mimeType,
            }
          : {}),
      };
      await workspaceRequest("/api/me/voice", "PUT", payload, requestKey(key, payload));
      await load();
      key.current = null;
      setCapture({ phase: "idle", elapsedMs: 0, sample: null, error: null });
      setNotice(
        withSample
          ? "Your voice sample is saved. Confirm your voice in the first class before spoken mistakes are shown."
          : "Voice confirmation is enabled. You can identify your voice in each class without a saved sample.",
      );
      if (withSample) onComplete?.();
    } catch (error) {
      if (
        error instanceof WorkspaceRequestError &&
        error.fields?.voice?.some((reason) =>
          ["enrollment_revoked", "voice_settings_changed"].includes(reason),
        )
      ) {
        await load().catch(() => {});
        key.current = null;
        setProblem(
          "Your voice settings changed. Review the current consent choice before saving again.",
        );
        return;
      }
      setProblem(
        error instanceof Error
          ? error.message
          : "Your voice settings could not be saved. Try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const payload = { action: "delete_voice" };
      await workspaceRequest("/api/me/voice", "DELETE", undefined, requestKey(key, payload));
      await load();
      recorder.cancel();
      setCapture({ phase: "idle", elapsedMs: 0, sample: null, error: null });
      key.current = null;
      setDeleting(false);
      setNotice(
        "Voice confirmation is off. Your saved sample and voice identification data have been deleted.",
      );
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Voice data could not be deleted. Try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={styles.stack}>
      {onComplete ? (
        <Actions>
          <Button
            secondary
            disabled={busy}
            onClick={() => {
              if (inFlight.current) return;
              recorder.cancel();
              onComplete();
            }}
          >
            Do this later
          </Button>
        </Actions>
      ) : null}
      <Panel title={onComplete ? undefined : "Your voice · Optional"}>
        <p>
          Help Recalino tell your speech apart from your teacher’s and classmates’. Spoken mistakes
          appear only after your voice is verified.
        </p>
        <p className="preview-muted">
          A voice sample is optional. If you save one, the audio and voice patterns are kept
          privately for your account. Confirmed class samples can improve future matches. You can
          turn this off and delete the voice data {onComplete ? "in Settings" : "here"} at any time.
        </p>
        {loading ? <Status>Loading voice settings…</Status> : null}
        {problem && !deleting ? <Status tone="error">{problem}</Status> : null}
        {notice ? <Status tone="success">{notice}</Status> : null}
        {!loading && !profile ? (
          <Button
            secondary
            onClick={() => {
              setLoading(true);
              setProblem("");
              void load()
                .catch((error) =>
                  setProblem(error instanceof Error ? error.message : "Could not load settings."),
                )
                .finally(() => setLoading(false));
            }}
          >
            Retry loading settings
          </Button>
        ) : null}
        {profile ? (
          <div className={styles.stack}>
            {profile.enabled ? (
              <Status tone="success">
                Voice confirmation is on
                {profile.sampleDurationMs !== null
                  ? " · Voice sample saved"
                  : profile.enrolled
                    ? " · Voice patterns learned from confirmed classes"
                    : " · No sample saved"}
                .{" "}
                {profile.confirmedLessons > 0
                  ? `${profile.confirmedLessons} confirmed ${profile.confirmedLessons === 1 ? "class" : "classes"}.`
                  : "Your first class always needs your confirmation."}
              </Status>
            ) : null}
            {!profile.engineAvailable ? (
              <Status>
                {onComplete ? (
                  'Audio voice matching is not available yet. Choose "Do this later" and try again in Settings → Your voice.'
                ) : (
                  <>
                    Audio voice matching is not available yet. You can enable confirmation for
                    transcripts that already identify separate speakers.
                  </>
                )}
              </Status>
            ) : null}
            <label className={styles.consent}>
              <input
                type="checkbox"
                checked={consent}
                disabled={busy || capturing}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                I agree to Recalino using my voice to identify my speech in my classes, and
                privately storing any sample and voice patterns I choose to provide.
              </span>
            </label>
            {profile.engineAvailable ? (
              <div className={styles.sample}>
                <p>
                  <strong>Record 30 seconds in your own voice</strong>
                </p>
                <p>
                  Use the same phone or microphone you use for class. Read the passage naturally,
                  then add two sentences about your day.
                </p>
                <p lang="en" dir="ltr">
                  “I am learning English so I can speak with more confidence. In class, I like to
                  ask questions, try new expressions, and practise with other people. Making a
                  mistake helps me understand what to work on next.”
                </p>
                {captureBlocked ? (
                  <Status>Finish your class recording before recording a voice sample.</Status>
                ) : null}
                {capturing ? (
                  <>
                    <div
                      className={styles.timer}
                      role="timer"
                      aria-label="Voice sample recording time"
                    >
                      0:{String(Math.floor(capture.elapsedMs / 1000)).padStart(2, "0")}{" "}
                      <small>/ 0:30</small>
                    </div>
                    <Status>
                      {capture.phase === "requesting"
                        ? "Waiting for microphone permission…"
                        : "Recording your sample. It stops automatically at 30 seconds."}
                    </Status>
                    <Actions>
                      {capture.phase === "recording" ? (
                        <Button onClick={() => recorder.stop()}>Stop sample</Button>
                      ) : null}
                      <Button
                        secondary
                        onClick={() => {
                          recorder.cancel();
                          setCapture({ phase: "idle", elapsedMs: 0, sample: null, error: null });
                        }}
                      >
                        Cancel sample
                      </Button>
                    </Actions>
                  </>
                ) : (
                  <>
                    {sampleUrl ? (
                      <>
                        <p>
                          Listen before saving. This draft is only held in this page until you save
                          it.
                        </p>
                        {/* biome-ignore lint/a11y/useMediaCaption: This is the learner's own microphone preview, recorded using the passage immediately above. */}
                        <audio
                          controls
                          preload="metadata"
                          src={sampleUrl}
                          aria-label="Your voice sample preview"
                        />
                      </>
                    ) : null}
                    {captureError ? <Status tone="error">{captureError}</Status> : null}
                    <Actions>
                      <Button
                        secondary
                        disabled={!consent || busy || captureBlocked}
                        onClick={() => {
                          setProblem("");
                          setNotice("");
                          void recorder.start(() => blocked.current);
                        }}
                      >
                        {capture.sample ? "Record again" : "Record voice sample"}
                      </Button>
                      {capture.sample ? (
                        <Button disabled={!consent || busy} onClick={() => void save(true)}>
                          {busy ? "Saving…" : "Save voice sample"}
                        </Button>
                      ) : null}
                    </Actions>
                  </>
                )}
              </div>
            ) : null}
            {!onComplete ? (
              <Actions>
                {!profile.enabled ? (
                  <Button disabled={!consent || busy || capturing} onClick={() => void save(false)}>
                    {busy ? "Saving…" : "Enable without a sample"}
                  </Button>
                ) : null}
                {profile.enabled ? (
                  <Button secondary disabled={busy || capturing} onClick={() => setDeleting(true)}>
                    Turn off and delete voice data
                  </Button>
                ) : null}
                <LinkButton secondary href="/me">
                  Back to settings
                </LinkButton>
              </Actions>
            ) : null}
          </div>
        ) : null}
      </Panel>
      <Sheet
        open={deleting}
        title="Delete your voice data?"
        onClose={() => {
          if (!busy) setDeleting(false);
        }}
      >
        <p>
          This turns off voice identification and deletes your saved voice sample and derived voice
          patterns. You can enable it again later.
        </p>
        {problem && deleting ? <Status tone="error">{problem}</Status> : null}
        <Actions>
          <Button secondary disabled={busy} onClick={() => setDeleting(false)}>
            Keep voice data
          </Button>
          <Button disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete voice data"}
          </Button>
        </Actions>
      </Sheet>
    </div>
  );
}
