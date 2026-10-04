"use client";
import type { MediaAsset } from "@recalino/core/media";
import type { ReviewInput, ReviewQueue, ReviewReceipt } from "@recalino/core/srs";
import { useEffect, useRef, useState } from "react";
import { workspaceRequest } from "./api";
import { ClaimEvidence } from "./NoteView";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";

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
  const current = queue.cards[0];
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
  async function refresh() {
    const value = await workspaceRequest<ReviewQueue>(
      `/api/review${sessionId ? `?sessionId=${sessionId}` : ""}`,
      "GET",
    );
    setQueue(value);
    setShown(false);
    cardStarted.current = Date.now();
  }
  async function grade(choice: ReviewInput["choice"]) {
    if (!current || busy) return;
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
          {current.card.template === "listening" ? (
            frontMedia ? (
              media(frontMedia)
            ) : (
              <p>Loading listening audio…</p>
            )
          ) : (
            <h2 style={{ whiteSpace: "pre-wrap" }}>{current.card.front}</h2>
          )}
          {current.card.template !== "listening" && frontMedia && media(frontMedia)}
          {!shown ? (
            <Button disabled={busy} onClick={() => setShown(true)}>
              Show answer
            </Button>
          ) : (
            <div className="preview-stack">
              <p style={{ whiteSpace: "pre-wrap" }}>{current.card.back}</p>
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
          <LinkButton href="/classes">Open your classes</LinkButton>
        </Panel>
      )}
      {receipt && (
        <Status tone="success">
          Answer saved. Next review:{" "}
          {new Date(receipt.dueAt).toLocaleString("en-GB", { timeZone: queue.timezone })}{" "}
          <Button secondary disabled={busy} onClick={undo}>
            Undo last answer
          </Button>
        </Status>
      )}
      {problem && (
        <Button
          secondary
          disabled={busy}
          onClick={async () => {
            pending.current = null;
            setProblem("");
            try {
              await refresh();
            } catch {
              setProblem("Could not reload review. Try again.");
            }
          }}
        >
          Reload latest review
        </Button>
      )}
    </div>
  );
}
