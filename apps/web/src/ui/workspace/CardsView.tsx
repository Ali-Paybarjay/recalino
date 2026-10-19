"use client";
import type { StudyCard } from "@recalino/core/card";
import type { Notebook } from "@recalino/core/note";
import { useEffect, useRef, useState } from "react";
import { AutomaticLearningNotice } from "./AutomaticLearningView";
import { requestKey, workspaceRequest } from "./api";
import { CardFace } from "./CardFace";
import { cardActionBody, undoBody } from "./card-actions";
import { ClaimEvidence } from "./NoteView";
import { Actions, Button, LinkButton, Panel, Status } from "./primitives";

function CardPreview({ card, userId }: { card: StudyCard; userId: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <>
      <CardFace card={card} revealed={revealed} />
      <Button secondary aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
        {revealed ? "Hide answer" : "Show answer"}
      </Button>
      {revealed && <ClaimEvidence claim={card.provenance} userId={userId} collapsed />}
    </>
  );
}

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
  hasGeneratedNotes?: boolean;
}) {
  const [cards, setCards] = useState(initial),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  const key = useRef<{ payload: string; key: string } | null>(null);
  const [selectedSet, setSelectedSet] = useState<"production" | "recognition" | "legacy">(
    initial.some((card) => card.studySet === "production")
      ? "production"
      : initial.some((card) => card.studySet === "recognition")
        ? "recognition"
        : "legacy",
  );
  const grouped = cards.some((card) => card.studySet);
  const groups = (["production", "recognition", "legacy"] as const).map((set) => ({
    set,
    cards: cards
      .filter((card) => (card.studySet ?? "legacy") === set)
      .sort((a, b) => (a.studyPosition ?? 0) - (b.studyPosition ?? 0)),
  }));
  const activeGroup =
    groups.find((group) => group.set === selectedSet && group.cards.length) ??
    groups.find((group) => group.cards.length);
  const visibleCards = grouped ? (activeGroup?.cards ?? []) : cards;
  useEffect(() => setCards(initial), [initial]);
  // UX-03: a rejected card keeps an Undo button of its own, with the app's existing text. Nothing
  // pops up, so it is also safe while a class is being recorded (PRD-REC-02).
  async function change(card: StudyCard, body: ReturnType<typeof cardActionBody>) {
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
      return changed;
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "Card could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  async function accept(card: StudyCard, action: "activate" | "reject") {
    await change(card, cardActionBody(card, action));
  }
  async function undoReject(rejected: StudyCard) {
    await change(rejected, undoBody(rejected));
  }
  return (
    <div className="preview-stack">
      <Actions>
        <LinkButton disabled={busy} secondary href={`/sessions/${sessionId}/notes`}>
          Session notes
        </LinkButton>
        {cards.some((card) => card.status === "active") ? (
          <LinkButton disabled={busy} href={`/review?sessionId=${sessionId}`}>
            Review this session
          </LinkButton>
        ) : null}
        <LinkButton secondary href={`/sessions/${sessionId}/sources`}>
          Add material
        </LinkButton>
      </Actions>
      <AutomaticLearningNotice sessionId={sessionId} />
      {problem && <Status tone="error">{problem}</Status>}
      <Panel title={`Your cards (${cards.length})`}>
        {grouped && (
          <Actions>
            {groups
              .filter((group) => group.cards.length)
              .map((group) => (
                <Button
                  key={group.set}
                  secondary
                  aria-pressed={activeGroup?.set === group.set}
                  onClick={() => setSelectedSet(group.set)}
                >
                  {group.set === "production"
                    ? "Core · production"
                    : group.set === "recognition"
                      ? "Supplementary · recognition"
                      : "Other cards"}
                  {` (${group.cards.length})`}
                </Button>
              ))}
          </Actions>
        )}
        {!cards.length ? (
          <p>
            {notebook
              ? notebook.current.model.learningItems.length
                ? "Flashcards are being saved automatically. They will appear here shortly."
                : "These notes contain no learning items for flashcards. Add more material to update this session."
              : "Upload session material. Your flashcards will appear here automatically with your notes."}
          </p>
        ) : (
          visibleCards.map((card) => (
            <article key={card.id} className="preview-list-item">
              <CardPreview card={card} userId={userId} />
              <p className="preview-muted">
                {card.status} · {card.direction} · {card.template}
                {card.important ? " · Important" : ""}
              </p>
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
                {card.status === "rejected" && (
                  <Button
                    secondary
                    disabled={busy || card.contentVersion < 2}
                    onClick={() => void undoReject(card)}
                  >
                    Undo last card change
                  </Button>
                )}
              </Actions>
            </article>
          ))
        )}
      </Panel>
    </div>
  );
}
