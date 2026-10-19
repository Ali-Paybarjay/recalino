"use client";
import type { CardActionInput, CardProposal, StudyCard } from "@recalino/core/card";
import { cardHtmlToText } from "@recalino/core/card-html";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Sheet } from "../components/Sheet";
import { requestKey, workspaceRequest } from "./api";
import { CardFace } from "./CardFace";
import { CardMedia } from "./CardMedia";
import { cardDeleteCopy } from "./card-actions-copy";
import { ClaimEvidence } from "./NoteView";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
export function CardEditor({
  initial,
  initialProposals,
  userId,
}: {
  initial: StudyCard;
  initialProposals: CardProposal[];
  userId: string;
}) {
  const router = useRouter(),
    [card, setCard] = useState(initial),
    [proposals, setProposals] = useState(initialProposals),
    [front, setFront] = useState(
      initial.contentFormat === "lesson_html" ? cardHtmlToText(initial.front) : initial.front,
    ),
    [back, setBack] = useState(
      initial.contentFormat === "lesson_html" ? cardHtmlToText(initial.back) : initial.back,
    ),
    [newGoal, setNewGoal] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [notice, setNotice] = useState("");
  const key = useRef<{ payload: string; key: string } | null>(null);
  const dirty =
    newGoal ||
    front !== (card.contentFormat === "lesson_html" ? cardHtmlToText(card.front) : card.front) ||
    back !== (card.contentFormat === "lesson_html" ? cardHtmlToText(card.back) : card.back);
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const result = await workspaceRequest<StudyCard | { deleted: true }>(
        path,
        method,
        body,
        requestKey(key, { path, body }),
      );
      key.current = null;
      if ("deleted" in result) {
        router.push(`/sessions/${card.sessionIds[0]}/cards`);
        return;
      }
      if (result.id !== card.id) {
        router.push(`/cards/${result.id}`);
        return;
      }
      setCard(result);
      setFront(
        result.contentFormat === "lesson_html" ? cardHtmlToText(result.front) : result.front,
      );
      setBack(result.contentFormat === "lesson_html" ? cardHtmlToText(result.back) : result.back);
      setNotice("Card saved.");
      return result;
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "The card could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const action = (action: CardActionInput["action"]) =>
    mutate(`/api/cards/${card.id}/actions`, "POST", {
      expectedVersion: card.contentVersion,
      action,
      confirmQuality: true,
    });
  return (
    <div className="preview-stack">
      <Actions>
        <LinkButton secondary href={`/sessions/${card.sessionIds[0]}/cards`}>
          Back to session cards
        </LinkButton>
        <LinkButton href="/review">Review</LinkButton>
      </Actions>
      {problem && (
        <Status tone="error">
          {problem} Refresh to load the latest card if another tab changed it.
        </Status>
      )}
      {notice && <Status tone="success">{notice}</Status>}
      <Panel title="Edit your card">
        <p className="preview-muted">
          {card.status} · {card.template} · Version {card.contentVersion}
        </p>
        <ClaimEvidence claim={card.provenance} userId={userId} />
        {card.contentFormat === "lesson_html" && (
          <>
            <CardFace card={card} revealed />
            <p className="preview-muted">
              Saving text changes replaces the lesson formatting with your wording.
            </p>
          </>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty) return;
            void mutate(`/api/cards/${card.id}`, "PATCH", {
              expectedVersion: card.contentVersion,
              front,
              back,
              newLearningGoal: newGoal,
            });
          }}
        >
          <Field label="Question">
            <textarea
              required
              rows={3}
              maxLength={20000}
              value={front}
              onChange={(event) => setFront(event.target.value)}
            />
          </Field>
          <Field label="Answer">
            <textarea
              required
              rows={4}
              maxLength={20000}
              value={back}
              onChange={(event) => setBack(event.target.value)}
            />
          </Field>
          <Field
            label="What changed?"
            hint="Fixing wording keeps your review schedule. A new learning goal creates a separate candidate card."
          >
            <select
              value={newGoal ? "new" : "same"}
              onChange={(event) => setNewGoal(event.target.value === "new")}
            >
              <option value="same">Same learning goal</option>
              <option value="new">New learning goal</option>
            </select>
          </Field>
          <Button type="submit" disabled={busy || !dirty}>
            Save card
          </Button>
        </form>
      </Panel>
      <Panel title="Card options">
        <Actions>
          {card.status === "active" ? (
            <Button secondary disabled={busy} onClick={() => action("suspend")}>
              Suspend
            </Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() => action(card.status === "known" ? "unmark_known" : "activate")}
            >
              Confirm and add to review
            </Button>
          )}
          <Button secondary disabled={busy} onClick={() => action("know")}>
            I know this
          </Button>
          <Button
            secondary
            disabled={busy}
            onClick={() => action(card.important ? "unimportant" : "important")}
          >
            {card.important ? "Remove importance" : "Mark important"}
          </Button>
          <Button secondary disabled={busy} onClick={() => action("wrong")}>
            This is wrong
          </Button>
          <Button
            secondary
            disabled={busy || card.contentVersion < 2}
            onClick={() => action("undo")}
          >
            Undo last card change
          </Button>
        </Actions>
        {/* UX-03: deleting asks first, like deleting a session (frame E3-delete). */}
        <Actions>
          <Button secondary disabled={busy} onClick={() => setConfirmDelete(true)}>
            {cardDeleteCopy.open}
          </Button>
        </Actions>
      </Panel>
      <Sheet
        open={confirmDelete}
        onClose={() => {
          if (!busy) setConfirmDelete(false);
        }}
        title={cardDeleteCopy.title}
      >
        <p>{cardDeleteCopy.linked}</p>
        <ul>
          {cardDeleteCopy.consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {card.status === "active" ? <p>{cardDeleteCopy.suspendHint}</p> : null}
        <Actions>
          <Button secondary disabled={busy} onClick={() => setConfirmDelete(false)}>
            {cardDeleteCopy.keep}
          </Button>
          {card.status === "active" ? (
            <Button
              secondary
              disabled={busy}
              onClick={() => void action("suspend").finally(() => setConfirmDelete(false))}
            >
              {cardDeleteCopy.suspendInstead}
            </Button>
          ) : null}
          <Button
            danger
            disabled={busy}
            onClick={() => void action("delete").finally(() => setConfirmDelete(false))}
          >
            {cardDeleteCopy.confirm}
          </Button>
        </Actions>
      </Sheet>
      {!!proposals.length && (
        <Panel title="Suggested updates from newer notes">
          {proposals.map((proposal) => (
            <article key={proposal.id} className="preview-list-item">
              <h3>Proposed card</h3>
              <CardFace card={proposal} revealed />
              <ClaimEvidence claim={proposal.provenance} userId={userId} />
              <p>Your current card and review history stay intact until you choose.</p>
              <Actions>
                {(["same", "new", "dismiss"] as const).map((choice) => (
                  <Button
                    key={choice}
                    secondary
                    disabled={busy}
                    onClick={async () => {
                      const value = await mutate(
                        `/api/cards/${card.id}/proposals/${proposal.id}`,
                        "POST",
                        {
                          expectedVersion: card.contentVersion,
                          action: choice === "dismiss" ? "dismiss" : "apply",
                          newLearningGoal: choice === "new",
                        },
                      );
                      if (value)
                        setProposals((items) => items.filter((item) => item.id !== proposal.id));
                    }}
                  >
                    {choice === "same"
                      ? "Apply to same goal"
                      : choice === "new"
                        ? "Create a new goal"
                        : "Dismiss"}
                  </Button>
                ))}
              </Actions>
            </article>
          ))}
        </Panel>
      )}
      <CardMedia card={card} onCard={setCard} />
    </div>
  );
}
