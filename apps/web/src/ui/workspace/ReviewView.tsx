"use client";
import type { MediaAsset } from "@recalino/core/media";
import type { ReviewInput, ReviewQueue, ReviewReceipt } from "@recalino/core/srs";
import { useEffect, useRef, useState } from "react";
import { shellStrings as strings } from "../strings-shell";
import { timeZoneCity } from "../time-zone";
import { userMessage, workspaceRequest } from "./api";
import { CardFace } from "./CardFace";
import { studySetLabel } from "./card-labels";
import { mediaAlt } from "./media-alt";
import { ClaimEvidence } from "./NoteView";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";
import { RecallPronunciation } from "./RecallPronunciation";
import { type FocusIntent, reviewFocusTarget } from "./review-focus";

/** Learning and relearning steps are minutes apart; an open page picks such a card up when due. */
const LEARNING_STEP_WAIT_MS = 15 * 60000;
/** The back of a plain listening card. It is learner text, so its direction follows its first letters (A11Y-02). */
export function ListeningAnswer({ text }: { text: string }) {
  return (
    <p dir="auto" style={{ whiteSpace: "pre-wrap" }}>
      {text}
    </p>
  );
}

function reviewQueuePath(sessionId: string | undefined): string {
  return sessionId ? `/api/review?${new URLSearchParams({ sessionId })}` : "/api/review";
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
    [busy, setBusy] = useState(false),
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
  const requestInFlight = useRef(false);
  const current = queue.cards[0];
  const waiting = !current;
  // A11Y-03: the button that had focus is replaced by the next state, so focus is moved on purpose.
  const focusIntent = useRef<FocusIntent>(null);
  const cardRegion = useRef<HTMLDivElement>(null);
  const showAnswerButton = useRef<HTMLButtonElement>(null);
  const donePanel = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when the card, its answer or the busy state changes.
  useEffect(() => {
    const target = reviewFocusTarget(focusIntent.current, { shown, hasCard: !!current });
    if (!target) return;
    const element =
      target === "answer"
        ? cardRegion.current
        : target === "show-answer"
          ? showAnswerButton.current
          : donePanel.current;
    // A button that is still disabled (the answer is being saved) cannot take focus: wait for
    // the next change, which is when `busy` ends.
    if (!element || (element instanceof HTMLButtonElement && element.disabled)) return;
    focusIntent.current = null;
    element.focus();
  }, [shown, current?.card.id, current?.card.contentVersion, busy]);
  // D79: when only a learning step remains a few minutes away, continue without a manual reload.
  useEffect(() => {
    if (!waiting || !queue.nextDueAt) return;
    const wait = Date.parse(queue.nextDueAt) - Date.now();
    if (wait > LEARNING_STEP_WAIT_MS) return;
    let active = true;
    const timer = setTimeout(
      () => {
        if (requestInFlight.current || pending.current) return;
        requestInFlight.current = true;
        void workspaceRequest<ReviewQueue>(reviewQueuePath(sessionId), "GET")
          .then((value) => {
            if (!active) return;
            setQueue(value);
            setShown(false);
            cardStarted.current = Date.now();
          })
          .catch(() => undefined)
          .finally(() => {
            requestInFlight.current = false;
          });
      },
      Math.max(wait + 1000, 5000),
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [waiting, queue.nextDueAt, sessionId]);
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
  function media(value: { url: string; mime: string; synthetic: boolean }, side: "front" | "back") {
    return (
      <div>
        {value.synthetic && <p className="workspace-muted">Synthetic audio</p>}
        {value.mime.startsWith("audio/") ? (
          <audio controls src={value.url}>
            <track kind="captions" />
            Audio playback is unavailable.
          </audio>
        ) : (
          // biome-ignore lint/performance/noImgElement: Private signed media must not be sent through an image proxy.
          <img
            src={value.url}
            // A11Y-05: described by the text of the card side that carries it; "" when it has none.
            alt={mediaAlt(current?.card[side])}
            dir="auto"
            style={{ maxWidth: "100%", height: "auto" }}
          />
        )}
      </div>
    );
  }
  async function refresh() {
    const value = await workspaceRequest<ReviewQueue>(reviewQueuePath(sessionId), "GET");
    setQueue(value);
    setShown(false);
    cardStarted.current = Date.now();
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
    focusIntent.current = "next";
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
      focusIntent.current = null;
      setProblem(userMessage(failure, "Your answer could not be saved. Retry the same answer."));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }
  async function undo() {
    if (!receipt) return;
    setBusy(true);
    setProblem("");
    focusIntent.current = "next";
    try {
      await workspaceRequest(`/api/review/events/${receipt.eventId}/undo`, "POST", {
        expectedVersion: receipt.version,
      });
      setReceipt(null);
      setReviewed((n) => Math.max(0, n - 1));
      await refresh();
    } catch (failure) {
      focusIntent.current = null;
      setProblem(userMessage(failure, "The last answer could not be undone."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-stack">
      <Actions>
        <LinkButton secondary href="/me/review-settings">
          Review settings
        </LinkButton>
        {sessionId && (
          <>
            <LinkButton secondary href={`/sessions/${sessionId}/cards`}>
              Session cards
            </LinkButton>
            <LinkButton secondary href="/review">
              Review all sessions
            </LinkButton>
          </>
        )}
      </Actions>
      <p className="workspace-muted">
        {reviewed} reviewed · {queue.dueCount} due · Up to {queue.newRemaining} new today ·{" "}
        {timeZoneCity(queue.timezone)}
      </p>
      {problem && <Status tone="error">{problem}</Status>}
      {mediaProblem && <Status>{mediaProblem}</Status>}
      {softStop ? (
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
          {current.card.studySet && (
            <p className="workspace-muted">{studySetLabel(current.card.studySet)}</p>
          )}
          {/* The card and its answer: focus moves here when the answer appears (A11Y-03). */}
          <div ref={cardRegion} tabIndex={-1}>
            {current.card.template === "listening" ? (
              frontMedia ? (
                media(frontMedia, "front")
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
                            key={`${current.card.id}:${current.card.contentVersion}`}
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
            {current.card.template !== "listening" && frontMedia && media(frontMedia, "front")}
            {shown ? (
              <div className="workspace-stack">
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
                                  key={`${current.card.id}:${current.card.contentVersion}`}
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
                    <ListeningAnswer text={current.card.back} />
                  ))}
                {backMedia && media(backMedia, "back")}
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
            ) : null}
          </div>
          {!shown ? (
            <Button
              ref={showAnswerButton}
              disabled={busy}
              onClick={() => {
                focusIntent.current = "answer";
                setShown(true);
              }}
            >
              Show answer
            </Button>
          ) : null}
        </Panel>
      ) : (
        // UX-12: "no cards yet" and "done for now" are different, so they say different things.
        <div ref={donePanel} tabIndex={-1}>
          {!queue.hasCards && !reviewed ? (
            <Panel>
              <p>{strings.empty.review}</p>
              <LinkButton href="/sessions">Open your sessions</LinkButton>
            </Panel>
          ) : (
            <Panel title="You’re ready for a break">
              <p>{reviewed ? `You reviewed ${reviewed} cards.` : "No cards are due right now."}</p>
              {queue.nextDueAt && (
                <p>
                  Next scheduled review:{" "}
                  {new Date(queue.nextDueAt).toLocaleString("en-GB", { timeZone: queue.timezone })}
                </p>
              )}
              {queue.buriedSiblings > 0 && (
                <p>{queue.buriedSiblings} related cards are saved for a later study day.</p>
              )}
              <LinkButton href="/sessions">Open your sessions</LinkButton>
            </Panel>
          )}
        </div>
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
