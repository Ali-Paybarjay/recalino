"use client";
import type { Claim, KnowledgeVersion } from "@recalino/core/lkm";
import type { Notebook, NotebookRevision, PublishNotebookInput } from "@recalino/core/note";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { requestKey, workspaceRequest } from "./api";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
import { SourceRefViewer } from "./SourceRefViewer";

export function ClaimEvidence({ claim, userId }: { claim: Claim; userId: string }) {
  return (
    <div className="preview-stack">
      <p className="preview-muted">
        {claim.origin === "from_class" ? "From class" : "AI expansion"}
        {claim.creation === "user_edit" ? " · Edited by you" : ""}
        {claim.origin === "from_class"
          ? ` · ${claim.evidence} · Speaker: ${claim.speakerRole}`
          : ""}
        {claim.uncertain ? " · Check this" : ""}
      </p>
      {claim.sourceRefs.map((reference) => (
        <SourceRefViewer
          key={`${reference.sourceId}-${reference.contentVersionId}-${JSON.stringify(reference.locator)}`}
          reference={reference}
          userId={userId}
        />
      ))}
    </div>
  );
}
export function NoteView({
  sessionId,
  userId,
  initial,
  latest,
  readOnlyRevision,
  embedded = false,
}: {
  sessionId: string;
  userId: string;
  initial: Notebook | null;
  latest: KnowledgeVersion | null;
  readOnlyRevision?: NotebookRevision;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [notebook, setNotebook] = useState(initial),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null),
    [text, setText] = useState("");
  const key = useRef<{ payload: string; key: string } | null>(null);
  const current = readOnlyRevision ?? notebook?.current,
    model = current?.model;
  const claimIds = new Set(
    model
      ? [
          ...model.summary,
          ...model.topics.flatMap((topic) => topic.claims),
          ...model.learningItems.map((item) => item.claim),
          ...model.homework,
          ...model.uncertainties,
        ].map((claim) => claim.id)
      : [],
  );
  const itemIds = new Set(model?.learningItems.map((item) => item.id) ?? []);
  const unmatchedClaims = Object.entries(current?.edits.claims ?? {}).filter(
    ([id]) => !claimIds.has(id),
  );
  const unmatchedItems = Object.entries(current?.edits.items ?? {}).filter(
    ([id]) => !itemIds.has(id),
  );
  async function save(change: Omit<PublishNotebookInput, "expectedRevisionId">) {
    const body = { expectedRevisionId: notebook?.current.id ?? null, ...change };
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const value = await workspaceRequest<Notebook>(
        `/api/classes/${sessionId}/notes`,
        "POST",
        body,
        requestKey(key, body),
      );
      setNotebook(value);
      setEditing(null);
      key.current = null;
      setNotice("Notes saved. Your earlier versions are still available.");
      router.refresh();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "Notes could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  function claim(claim: Claim) {
    return (
      <article key={claim.id} className="preview-list-item">
        <p style={{ whiteSpace: "pre-wrap" }}>{claim.text}</p>
        <ClaimEvidence claim={claim} userId={userId} />
        {!readOnlyRevision && (
          <Button
            secondary
            disabled={busy}
            onClick={() => {
              setEditing(`claim:${claim.id}`);
              setText(claim.text);
            }}
          >
            Edit this note
          </Button>
        )}
      </article>
    );
  }
  return (
    <div className="preview-stack">
      {problem && (
        <Status tone="error">
          {problem} Refresh the page if another tab has changed these notes.
        </Status>
      )}
      {notice && <Status tone="success">{notice}</Status>}
      {!embedded && (
        <Actions>
          <LinkButton disabled={busy} secondary href={`/classes/${sessionId}`}>
            Back to class
          </LinkButton>
          <LinkButton disabled={busy} secondary href={`/classes/${sessionId}/notes/versions`}>
            Version history
          </LinkButton>
          {model && (
            <LinkButton disabled={busy} href={`/classes/${sessionId}/cards`}>
              Make flashcards
            </LinkButton>
          )}
          {model && (
            <LinkButton disabled={busy} secondary href={`/classes/${sessionId}/export`}>
              Download notes and cards
            </LinkButton>
          )}
        </Actions>
      )}
      {!model ? (
        <Panel title={latest ? "Your class notes are ready" : "Start with class material"}>
          <p>
            {latest
              ? "Publish these notes to begin. You can edit them and make cards afterwards."
              : "Add class sources, then process the material to create notes."}
          </p>
          {latest ? (
            <Button disabled={busy} onClick={() => save({ knowledgeVersionId: latest.id })}>
              Publish notes
            </Button>
          ) : (
            <LinkButton href={`/classes/${sessionId}/sources`}>Add sources</LinkButton>
          )}
        </Panel>
      ) : (
        <>
          {!readOnlyRevision && notebook?.proposedKnowledgeVersionId && (
            <Panel title="A newer class version is ready">
              <p>
                Your current notes and edits are preserved. Apply the new version when you are
                ready; your text edits carry forward.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  save({ knowledgeVersionId: notebook.proposedKnowledgeVersionId ?? undefined })
                }
              >
                Apply newer version
              </Button>
            </Panel>
          )}
          <Panel title={model.title}>
            <p className="preview-muted">
              Note version {current.number} · {new Date(current.createdAt).toLocaleString("en-GB")}
            </p>
            {!model.coverage.complete && (
              <Status>
                Some class material is missing. Review the coverage before trusting these notes.
              </Status>
            )}
            <h3>Class summary</h3>
            {model.summary.map(claim)}
            {model.topics.map((topic) => (
              <section key={topic.id}>
                <h3>{topic.title}</h3>
                {topic.claims.map(claim)}
              </section>
            ))}
          </Panel>
          <Panel title="Useful things to learn">
            {model.learningItems.length ? (
              model.learningItems.map((item) => (
                <article className="preview-list-item" key={item.id}>
                  <h3>{item.front}</h3>
                  <p style={{ whiteSpace: "pre-wrap" }}>{item.back}</p>
                  <ClaimEvidence claim={item.claim} userId={userId} />
                  {!readOnlyRevision && (
                    <Actions>
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() => {
                          setEditing(`front:${item.id}`);
                          setText(item.front);
                        }}
                      >
                        Edit question
                      </Button>
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() => {
                          setEditing(`back:${item.id}`);
                          setText(item.back);
                        }}
                      >
                        Edit answer
                      </Button>
                    </Actions>
                  )}
                </article>
              ))
            ) : (
              <p>No learning items were found in this version.</p>
            )}
          </Panel>
          {!!model.homework.length && <Panel title="Homework">{model.homework.map(claim)}</Panel>}
          {!!model.uncertainties.length && (
            <Panel title="Things to check">{model.uncertainties.map(claim)}</Panel>
          )}
          {!!(unmatchedClaims.length + unmatchedItems.length) && (
            <Panel title="Your saved edits from earlier material">
              <p>
                These edits did not match an item in the latest class version. They remain saved
                here and in version history.
              </p>
              {unmatchedClaims.map(([id, value]) => (
                <article key={id} className="preview-list-item">
                  <p>{value}</p>
                  <p className="preview-muted">Edited by you · Earlier item {id}</p>
                </article>
              ))}
              {unmatchedItems.map(([id, value]) => (
                <article key={id} className="preview-list-item">
                  <h3>{value.front ?? "Earlier question"}</h3>
                  <p>{value.back ?? "No answer edit"}</p>
                  <p className="preview-muted">Edited by you · Earlier item {id}</p>
                </article>
              ))}
            </Panel>
          )}
          {editing && (
            <Panel title="Edit your notes">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const [kind, id] = editing.split(":");
                  if (!id) return;
                  void save({
                    edits:
                      kind === "claim"
                        ? { claims: { [id]: text } }
                        : { items: { [id]: { [kind as "front" | "back"]: text } } },
                  });
                }}
              >
                <Field label="Your text">
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={20000}
                    required
                    rows={5}
                  />
                </Field>
                <Actions>
                  <Button type="submit" disabled={busy}>
                    Save edit
                  </Button>
                  <Button secondary disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </Actions>
              </form>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
