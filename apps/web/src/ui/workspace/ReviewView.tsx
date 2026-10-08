"use client";
import type { MediaAsset } from "@recalino/core/media";
import type { ReviewInput, ReviewQueue, ReviewReceipt } from "@recalino/core/srs";
import { useEffect, useRef, useState } from "react";
import { workspaceRequest } from "./api";
import { CardFace } from "./CardFace";
import { ClaimEvidence } from "./NoteView";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";
import { RecallPronunciation } from "./RecallPronunciation";

type StudySet = "production" | "recognition" | "legacy";
function preferredStudySet(queue: ReviewQueue): StudySet {
  return queue.studySet ?? queue.availableStudySets?.[0] ?? "legacy";
}
function reviewQueuePath(sessionId: string | undefined, studySet: StudySet): string {
  const query = new URLSearchParams({ studySet });
  if (sessionId) query.set("sessionId", sessionId);
  return `/api/review?${query}`;
}

export function ReviewView({
  initial,
  userId,
  sessionId,
}: {
  initial: ReviewQueue;
  userId: string;
  sessionId?: string;
}) {
  const [queue, setQueue] = useState(initial),
    [shown, setShown] = useState(false),
    [busy, setBusy] = useState(
      () =>
        !initial.studySet && initial.availableStudySets?.some((set) => set !== "legacy") === true,
    ),
    [problem, setProblem] = useState(""),
    [receipt, setReceipt] = useState<ReviewReceipt | null>(null),
    [reviewed, setReviewed] = useState(0),
    [softStop, setSoftStop] = useState(false),
    [frontMedia, setFrontMedia] = useState<{
      url: string;
      mime: string;
      synthetic: boolean;
    } | null>(null),
    [backMedia, setBackMedia] = useState<{ url: string; mime: string; synthetic: boolean } | null>(
      null,
    ),
    [mediaProblem, setMediaProblem] = useState("");
  const pending = useRef<ReviewInput | null>(null),
    started = useRef(Date.now()),
    cardStarted = useRef(Date.now()),
    softBudget = useRef(initial.settings.timeBudgetMinutes * 60000);
  const [selectedSet, setSelectedSet] = useState<StudySet>(() => preferredStudySet(initial));
  const requestInFlight = useRef(false);
  const availableSets = queue.availableStudySets ?? initial.availableStudySets ?? [];
  const grouped = availableSets.some((set) => set !== "legacy");
  const queueMatchesSelection = !grouped || queue.studySet === selectedSet;
  const current = queueMatchesSelection ? queue.cards[0] : undefined;
  useEffect(() => {
    if (initial.studySet || !initial.availableStudySets?.some((set) => set !== "legacy")) return;
    let active = true;
    const studySet = preferredStudySet(initial);
    setBusy(true);
    requestInFlight.current = true;
    void workspaceRequest<ReviewQueue>(reviewQueuePath(sessionId, studySet), "GET")
      .then((value) => {
        if (!active) return;
        setQueue(value);
        setSelectedSet(studySet);
        setShown(false);
        cardStarted.current = Date.now();
      })
      .catch(() => {
        if (active) setProblem("Could not load this review set. Reload review to try again.");
      })
      .finally(() => {
        if (active) {
          setBusy(false);
          requestInFlight.current = false;
        }
      });
    return () => {
      active = false;
    };
  }, [initial, sessionId]);
  useEffect(() => {
    setFrontMedia(null);
    setBackMedia(null);
    setMediaProblem("");
    let active = true;
    for (const [id, update] of [
      [current?.card.frontMediaId, setFrontMedia],
      [current?.card.backMediaId, setBackMedia],
    ] as const) {
      if (!id) continue;
      void Promise.all([
        workspaceRequest<MediaAsset>(`/api/media/${id}`, "GET"),
        workspaceRequest<{ url: string }>(`/api/media/${id}/read`, "GET"),
      ])
        .then(([asset, link]) => {
          if (active && asset.mimeType)
            update({ url: link.url, mime: asset.mimeType, synthetic: asset.synthetic });
        })
        .catch(() => {
          if (active)
            setMediaProblem(
              "Attached media is unavailable. Text remains available. Open the card to repair its attachment.",
            );
        });
    }
    return () => {
      active = false;
    };
  }, [current?.card.frontMediaId, current?.card.backMediaId]);
  function media(value: { url: string; mime: string; synthetic: boolean }) {
    return (
      <div>
        {value.synthetic && <p className="preview-muted">Synthetic audio</p>}
        {value.mime.startsWith("audio/") ? (
          <audio controls src={value.url}>
            <track kind="captions" />
            Audio playback is unavailable.
          </audio>
        ) : (
          // biome-ignore lint/performance/noImgElement: Private signed media must not be sent through an image proxy.
          <img
            src={value.url}
            alt="Card learning material"
            style={{ maxWidth: "100%", height: "auto" }}
          />
        )}
      </div>
    );
  }
  async function refresh(studySet = selectedSet) {
    const value = await workspaceRequest<ReviewQueue>(reviewQueuePath(sessionId, studySet), "GET");
    setQueue(value);
    setShown(false);
    cardStarted.current = Date.now();
  }
  async function changeStudySet(studySet: StudySet) {
    if (busy || pending.current || requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setProblem("");
    setSelectedSet(studySet);
    setShown(false);
    try {
      await refresh(studySet);
    } catch {
      setProblem("Could not load this review set. Reload review to try again.");
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }
  async function grade(choice: ReviewInput["choice"]) {
    if (!current || busy || requestInFlight.current) return;
    if (pending.current && pending.current.cardId !== current.card.id) {
      setProblem("Reload review before answering another card.");
      return;
    }
    requestInFlight.current = true;
    setBusy(true);
    setProblem("");
    if (!pending.current)
      pending.current = {
        eventId: crypto.randomUUID(),
        cardId: current.card.id,
        expectedVersion: current.schedule.version,
        expectedContentVersion: current.card.contentVersion,
        mode: queue.settings.mode,
        choice,
        durationMs: Math.min(3600000, Date.now() - cardStarted.current),
      };
    try {
      const result = await workspaceRequest<ReviewReceipt>(
        "/api/review/events",
        "POST",
        pending.current,
      );
      pending.current = null;
      setReceipt(result);
      setReviewed((n) => n + 1);
      await refresh();
      if (Date.now() - started.current >= softBudget.current) setSoftStop(true);
    } catch (failure) {
      setProblem(
        failure instanceof Error
          ? failure.message
          : "Your answer could not be saved. Retry the same answer.",
      );
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }
  async function undo() {
    if (!receipt) return;
    setBusy(true);
    setProblem("");
    try {
      await workspaceRequest(`/api/review/events/${receipt.eventId}/undo`, "POST", {
        expectedVersion: receipt.version,
      });
      setReceipt(null);
      setReviewed((n) => Math.max(0, n - 1));
      await refresh();
    } catch (failure) {
      setProblem(
        failure instanceof Error ? failure.message : "The last answer could not be undone.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="preview-stack">
      <Actions>
        <LinkButton secondary href="/me/review-settings">
          Review settings
        </LinkButton>
        {sessionId && (
          <LinkButton secondary href={`/classes/${sessionId}/cards`}>
            Class cards
          </LinkButton>
        )}
      </Actions>
      <p className="preview-muted">
        {reviewed} reviewed · {queue.dueCount} due · Up to {queue.newRemaining} new today ·{" "}
        {queue.timezone}
      </p>
      {grouped && (
        <Actions>
          {(["production", "recognition", "legacy"] as const).map((set) => {
            if (!availableSets.includes(set) && selectedSet !== set) return null;
            return (
              <Button
                key={set}
                secondary
                disabled={busy || !!pending.current}
                aria-pressed={selectedSet === set}
                onClick={() => void changeStudySet(set)}
              >
                {set === "production"
                  ? "Core · production"
                  : set === "recognition"
                    ? "Supplementary · recognition"
                    : "Other cards"}
              </Button>
            );
          })}
        </Actions>
      )}
      {problem && <Status tone="error">{problem}</Status>}
      {mediaProblem && <Status>{mediaProblem}</Status>}
      {!queueMatchesSelection ? (
        <Panel title="Your review cards">
          <p>{busy ? "Loading this set…" : "Reload review to load this set."}</p>
        </Panel>
      ) : softStop ? (
        <Panel title="A little practice goes a long way">
          <p>
            You reached your {queue.settings.timeBudgetMinutes}-minute target. Take a break, or
            continue if you feel ready.
          </p>
          <Actions>
            <LinkButton href="/today">Finish for now</LinkButton>
            <Button
              secondary
              onClick={() => {
                setSoftStop(false);
                started.current = Date.now();
              }}
            >
              Keep practising
            </Button>
          </Actions>
        </Panel>
      ) : current ? (
        <Panel
          title={
            current.card.template === "listening"
              ? "Listen and recall"
              : "Take a moment to remember"
          }
        >
          {current.card.template === "listening" ? (
            frontMedia ? (
              media(frontMedia)
            ) : (
              <p>Loading listening audio…</p>
            )
          ) : (
            <CardFace
              card={current.card}
              revealed={shown}
              pronunciation={
                current.card.pronunciationTarget && current.card.sessionIds[0]
                  ? {
                      target: current.card.pronunciationTarget,
                      control: (
                        <RecallPronunciation
                          key={`${selectedSet}:${current.card.id}:${current.card.contentVersion}`}
                          cardId={current.card.id}
                          contentVersion={current.card.contentVersion}
                          sessionId={sessionId ?? current.card.sessionIds[0]}
                          target={current.card.pronunciationTarget}
                        />
                      ),
                    }
                  : undefined
              }
            />
          )}
          {current.card.template !== "listening" && frontMedia && media(frontMedia)}
          {!shown ? (
            <Button disabled={busy} onClick={() => setShown(true)}>
              Show answer
            </Button>
          ) : (
            <div className="preview-stack">
              {current.card.template === "listening" &&
                (current.card.contentFormat === "lesson_html" ? (
                  <CardFace
                    card={current.card}
                    revealed
                    pronunciation={
                      current.card.pronunciationTarget && current.card.sessionIds[0]
                        ? {
                            target: current.card.pronunciationTarget,
                            control: (
                              <RecallPronunciation
                                key={`${selectedSet}:${current.card.id}:${current.card.contentVersion}`}
                                cardId={current.card.id}
                                contentVersion={current.card.contentVersion}
                                sessionId={sessionId ?? current.card.sessionIds[0]}
                                target={current.card.pronunciationTarget}
                              />
                            ),
                          }
                        : undefined
                    }
                  />
                ) : (
                  <p style={{ whiteSpace: "pre-wrap" }}>{current.card.back}</p>
                ))}
              {backMedia && media(backMedia)}
              <ClaimEvidence claim={current.card.provenance} userId={userId} />
              <Actions>
                {(queue.settings.mode === "simple"
                  ? (["forgot", "remembered"] as const)
                  : (["again", "hard", "good", "easy"] as const)
                ).map((choice) => (
                  <Button
                    key={choice}
                    secondary={choice === "forgot" || choice === "again"}
                    disabled={busy || (!!pending.current && pending.current.choice !== choice)}
                    onClick={() => grade(choice)}
                  >
                    {choice === "forgot"
                      ? "Forgot"
                      : choice === "remembered"
                        ? "Remembered"
                        : choice[0]?.toUpperCase() + choice.slice(1)}
                  </Button>
                ))}
              </Actions>
              <LinkButton secondary href={`/cards/${current.card.id}`}>
                Fix this card
              </LinkButton>
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="You’re ready for a break">
          <p>
            {grouped && availableSets.some((set) => set !== selectedSet)
              ? "This set is finished for now. Choose another set above to keep practising."
              : reviewed
                ? `You reviewed ${reviewed} cards.`
                : "No cards are due right now."}
          </p>
          {queue.nextDueAt && (
            <p>
              Next scheduled review:{" "}
              {new Date(queue.nextDueAt).toLocaleString("en-GB", { timeZone: queue.timezone })}
            </p>
          )}
          {queue.buriedSiblings > 0 && (
            <p>{queue.buriedSiblings} related cards are saved for a later study day.</p>
          )}
          <LinkButton href="/classes">Open your classes</LinkButton>
        </Panel>
      )}
      {receipt && (
        <Status tone="success">
          Answer saved. Next review:{" "}
          {new Date(receipt.dueAt).toLocaleString("en-GB", { timeZone: queue.timezone })}{" "}
          <Button secondary disabled={busy || !!pending.current} onClick={undo}>
            Undo last answer
          </Button>
        </Status>
      )}
      {problem && (
        <Button
          secondary
          disabled={busy}
          onClick={async () => {
            if (requestInFlight.current) return;
            requestInFlight.current = true;
            setBusy(true);
            setProblem("");
            try {
              await refresh();
              pending.current = null;
            } catch {
              setProblem("Could not reload review. Try again.");
            } finally {
              requestInFlight.current = false;
              setBusy(false);
            }
          }}
        >
          Reload latest review
        </Button>
      )}
    </div>
  );
}
