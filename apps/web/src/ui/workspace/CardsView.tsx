"use client";
import type { StudyCard } from "@recalino/core/card";
import type { Notebook } from "@recalino/core/note";
import { useRef, useState } from "react";
import { requestKey, workspaceRequest } from "./api";
import { ClaimEvidence } from "./NoteView";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
export function CardsView({
  sessionId,
  userId,
  initial,
  notebook,
}: {
  sessionId: string;
  userId: string;
  initial: StudyCard[];
  notebook: Notebook | null;
}) {
  const [cards, setCards] = useState(initial),
    [reverse, setReverse] = useState(false),
    [autoAdd, setAutoAdd] = useState(false),
    [selected, setSelected] = useState<string[]>(
      notebook?.current.model.learningItems.map((item) => item.id) ?? [],
    ),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [notice, setNotice] = useState("");
  const key = useRef<{ payload: string; key: string } | null>(null);
  async function generate() {
    const body = { itemIds: selected, reverse, autoAdd };
    setBusy(true);
    setProblem("");
    try {
      const result = await workspaceRequest<{
        cards: StudyCard[];
        proposedUpdates: number;
        duplicates: number;
      }>(`/api/classes/${sessionId}/cards`, "POST", body, requestKey(key, body));
      setCards(
        await workspaceRequest<{ cards: StudyCard[] }>(
          `/api/classes/${sessionId}/cards`,
          "GET",
        ).then((value) => value.cards),
      );
      key.current = null;
      setNotice(
        `${result.cards.length} cards prepared. ${result.duplicates} already existed; ${result.proposedUpdates} updates await your decision.`,
      );
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "Cards could not be prepared.");
    } finally {
      setBusy(false);
    }
  }
  async function accept(card: StudyCard, action: "activate" | "reject") {
    const body = { expectedVersion: card.contentVersion, action, confirmQuality: true };
    setBusy(true);
    setProblem("");
    try {
      const changed = await workspaceRequest<StudyCard>(
        `/api/cards/${card.id}/actions`,
        "POST",
        body,
        requestKey(key, { id: card.id, ...body }),
      );
      setCards((items) => items.map((item) => (item.id === changed.id ? changed : item)));
      key.current = null;
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "Card could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="preview-stack">
      <Actions>
        <LinkButton disabled={busy} secondary href={`/classes/${sessionId}/notes`}>
          Class notes
        </LinkButton>
        <LinkButton disabled={busy} href={`/review?sessionId=${sessionId}`}>
          Review this class
        </LinkButton>
      </Actions>
      {problem && <Status tone="error">{problem}</Status>}
      {notice && <Status>{notice}</Status>}
      <Panel title="Turn useful moments into cards">
        {notebook ? (
          <>
            <p>
              Choose the learning items you want to practise. Review cards before adding them, or
              explicitly choose automatic addition.
            </p>
            <fieldset>
              <legend>Learning items</legend>
              {notebook.current.model.learningItems.map((item) => (
                <label key={item.id} className="preview-choice">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={(event) =>
                      setSelected((ids) =>
                        event.target.checked
                          ? [...ids, item.id]
                          : ids.filter((id) => id !== item.id),
                      )
                    }
                  />{" "}
                  {item.front}
                </label>
              ))}
            </fieldset>
            <Field label="Card direction">
              <select
                value={reverse ? "reverse" : "forward"}
                onChange={(event) => setReverse(event.target.value === "reverse")}
              >
                <option value="forward">Question → answer</option>
                <option value="reverse">Answer → question (separate review schedule)</option>
              </select>
            </Field>
            <Field label="Adding cards">
              <select
                value={autoAdd ? "auto" : "review"}
                onChange={(event) => setAutoAdd(event.target.value === "auto")}
              >
                <option value="review">Review before adding</option>
                <option value="auto">Auto-add checked cards</option>
              </select>
            </Field>
            <p className="preview-muted">Uncertain cards always need your confirmation.</p>
            <Button disabled={busy || !selected.length} onClick={generate}>
              Prepare cards
            </Button>
          </>
        ) : (
          <>
            <p>Publish class notes before making cards.</p>
            <LinkButton href={`/classes/${sessionId}/notes`}>Open notes</LinkButton>
          </>
        )}
      </Panel>
      <Panel title={`Your cards (${cards.length})`}>
        {!cards.length ? (
          <p>No cards yet. Choose a few useful items above.</p>
        ) : (
          cards.map((card) => (
            <article key={card.id} className="preview-list-item">
              <h3>{card.front}</h3>
              <p>{card.back}</p>
              <p className="preview-muted">
                {card.status} · {card.direction} · {card.template}
                {card.important ? " · Important" : ""}
              </p>
              <ClaimEvidence claim={card.provenance} userId={userId} />
              <Actions>
                <LinkButton secondary href={`/cards/${card.id}`}>
                  Edit card
                </LinkButton>
                {card.status === "candidate" && (
                  <>
                    <Button disabled={busy} onClick={() => accept(card, "activate")}>
                      Confirm and add
                    </Button>
                    <Button secondary disabled={busy} onClick={() => accept(card, "reject")}>
                      Reject
                    </Button>
                  </>
                )}
              </Actions>
            </article>
          ))
        )}
      </Panel>
    </div>
  );
}
