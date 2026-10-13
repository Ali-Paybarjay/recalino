"use client";
import type {
  ClassVoiceEntry,
  ClassVoiceView,
  VoiceAnalysisView,
  VoiceCandidate,
} from "@recalino/core/voice-contracts";
import { useCallback, useEffect, useState } from "react";
import { fillCopy, pendingCopy } from "../pending-copy";
import { Actions, Button, Status } from "../workspace/primitives";
import styles from "./Voice.module.css";
import { useLocalVoiceAudio, VoiceClips } from "./VoiceClips";
import { voiceCopy } from "./voice-copy";

const copy = pendingCopy.voiceDetection;

/** One choice for the whole class (D64), as sent to `/api/classes/:id/voice`. */
export type ClassVoiceAction = {
  scope: "class";
  action: "confirm" | "reject" | "none" | "revoke";
  classVoiceId?: string;
  expected: { analysisId: string; version: number }[];
};

/** Whether the class view asks for one class-level choice (D64, kill switch `classConfirmation`). */
export function classConfirmationActive(view: ClassVoiceView | null): boolean {
  return Boolean(view?.features?.classConfirmation && view.classVoices?.length);
}

/** The parts a class voice covers that the class-level choice decides. */
export function coveredByClass(view: ClassVoiceView, analysis: VoiceAnalysisView): boolean {
  return (
    classConfirmationActive(view) &&
    Object.keys(analysis.speakerLinks ?? {}).some(
      (speakerId) => !(analysis.shortCandidateIds ?? []).includes(speakerId),
    )
  );
}

function memberCandidate(
  view: ClassVoiceView,
  member: ClassVoiceEntry["members"][number],
): { analysis: VoiceAnalysisView; candidate: VoiceCandidate } | null {
  const analysis = view.analyses.find((item) => item.id === member.analysisId);
  const candidate = analysis?.candidates.find((item) => item.id === member.speakerId);
  return analysis && candidate ? { analysis, candidate } : null;
}

/**
 * The excerpts of one part's member of a class voice, played from that part's own original on
 * this device (D29, D55). It reports whether they can play, since a voice is confirmed by ear.
 */
function MemberExcerpts({
  userId,
  analysis,
  candidate,
  onPlayable,
  onPlayback,
}: {
  userId: string;
  analysis: VoiceAnalysisView;
  candidate: VoiceCandidate;
  onPlayable: (key: string, playable: boolean) => void;
  onPlayback: (element: HTMLAudioElement) => void;
}) {
  const audio = useLocalVoiceAudio(userId, analysis.sourceId);
  const key = `${analysis.id}:${candidate.id}`;
  useEffect(() => {
    onPlayable(key, audio.state === "playable");
    return () => onPlayable(key, false);
  }, [key, audio.state, onPlayable]);
  return (
    <div>
      <p className="preview-muted" dir="auto">
        {analysis.source?.name ?? candidate.label}
      </p>
      <VoiceClips
        candidate={candidate}
        audioUrl={audio.state === "playable" ? audio.url : null}
        limit={2}
        onPlayback={onPlayback}
      />
    </div>
  );
}

/**
 * One confirmation for the whole class (D64, PRD-SPK-02). Shows the suggested class voice, or all
 * class voices after a "no", with excerpts from the parts it was heard in. Parts are not moved or
 * composed here: the page places this component (and VoiceConfirmation keeps per-part details).
 */
export function ClassVoiceConfirmation({
  view,
  userId,
  disabled,
  onAction,
  onPlayback,
}: {
  view: ClassVoiceView;
  userId: string;
  disabled: boolean;
  onAction: (payload: ClassVoiceAction) => Promise<void> | void;
  onPlayback: (element: HTMLAudioElement) => void;
}) {
  const [chooseAll, setChooseAll] = useState(false);
  const [playable, setPlayable] = useState<ReadonlySet<string>>(() => new Set());
  const reportPlayable = useCallback((key: string, value: boolean) => {
    setPlayable((current) => {
      if (current.has(key) === value) return current;
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const voices = view.classVoices ?? [];
  const total = view.analyses.length;
  const expected = view.analyses.map((item) => ({ analysisId: item.id, version: item.version }));
  const verifiedVoice = voices.find((voice) =>
    voice.members.some((member) =>
      view.analyses.some(
        (item) =>
          item.id === member.analysisId &&
          item.status === "verified" &&
          item.verifiedSpeakerId === member.speakerId,
      ),
    ),
  );
  const open = view.analyses.some((item) => item.status === "unverified");
  const suggested = voices.find((voice) => voice.id === view.classCandidateId);
  const listed = !open ? [] : suggested && !chooseAll ? [suggested] : voices;
  const act = (action: ClassVoiceAction["action"], classVoiceId?: string) =>
    void onAction({ scope: "class", action, ...(classVoiceId ? { classVoiceId } : {}), expected });
  return (
    <section className={styles.candidate} aria-label={copy.classHeading}>
      <div className={styles.heading}>
        <h3>{copy.classHeading}</h3>
      </div>
      {verifiedVoice && !open ? (
        <>
          <Status tone="success">{copy.classConfirmed}</Status>
          <Actions>
            <Button secondary disabled={disabled} onClick={() => act("revoke", verifiedVoice.id)}>
              This is not my voice
            </Button>
          </Actions>
        </>
      ) : (
        <>
          <p className="preview-muted">{copy.classIntro}</p>
          {listed.map((voice) => {
            const members = voice.members.flatMap((member) => {
              const found = memberCandidate(view, member);
              return found?.candidate.clips.length ? [found] : [];
            });
            const canConfirm = members.some(({ analysis, candidate }) =>
              playable.has(`${analysis.id}:${candidate.id}`),
            );
            return (
              <div key={voice.id} className={styles.aside}>
                <strong dir="auto">{voice.label}</strong>
                <p className="preview-muted">
                  {fillCopy(copy.heardIn, { count: voice.members.length, total })}
                </p>
                {voice.ambiguous ? <Status>{copy.ambiguous}</Status> : null}
                {members.slice(0, 2).map(({ analysis, candidate }) => (
                  <MemberExcerpts
                    key={`${analysis.id}:${candidate.id}`}
                    userId={userId}
                    analysis={analysis}
                    candidate={candidate}
                    onPlayable={reportPlayable}
                    onPlayback={onPlayback}
                  />
                ))}
                {canConfirm ? (
                  <>
                    <p className={styles.question} lang="fa" dir="rtl">
                      این صدای توست؟
                    </p>
                    <Actions>
                      <Button disabled={disabled} onClick={() => act("confirm", voice.id)}>
                        Yes, this is my voice
                      </Button>
                      {suggested && !chooseAll ? (
                        <Button
                          secondary
                          disabled={disabled}
                          onClick={() => {
                            setChooseAll(true);
                            act("reject", voice.id);
                          }}
                        >
                          No, show other speakers
                        </Button>
                      ) : null}
                    </Actions>
                  </>
                ) : (
                  <p className="preview-muted">{voiceCopy.playback.listenFirst}</p>
                )}
              </div>
            );
          })}
          {open ? (
            <Actions>
              <Button secondary disabled={disabled} onClick={() => act("none")}>
                None of these voices is mine
              </Button>
            </Actions>
          ) : null}
        </>
      )}
    </section>
  );
}
