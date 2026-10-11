"use client";
import type { Claim, KnowledgeVersion } from "@recalino/core/lkm";
import type { Notebook, NotebookRevision, PublishNotebookInput } from "@recalino/core/note";
import type { LessonAdaptationView } from "@recalino/core/proc";
import { renderClassNotesHtml } from "@recalino/core/study-render";
import { studyPronunciationTarget } from "@recalino/core/study-target";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ContentBlock } from "../components/ContentBlock";
import { directionOf } from "../direction";
import { SpeakerHigh } from "../icons";
import { AutomaticLearningNotice } from "./AutomaticLearningView";
import { requestKey, WorkspaceRequestError, workspaceRequest } from "./api";
import { notifyAutomaticLearning } from "./automatic-learning";
import { ClassNotesFrame } from "./ClassNotesFrame";
import { ClassNotesPlayback } from "./ClassNotesPlayback";
import { LessonAdaptation } from "./LessonAdaptation";
import { LessonReview } from "./LessonReview";
import { hasLessonEdits } from "./lesson-review-state";
import styles from "./NoteView.module.css";
import type { NoteMaterialSource, NoteSourceIssue } from "./note-source-issues";
import { PronunciationAudio } from "./PronunciationAudio";
import pronunciationStyles from "./PronunciationAudio.module.css";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
import { SourceRefViewer } from "./SourceRefViewer";

function NoteText({ text, lang }: { text: string; lang?: string }) {
  return (
    <ContentBlock as="p" lang={lang} reading>
      <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
    </ContentBlock>
  );
}

export function ClaimEvidence({
  claim,
  userId,
  collapsed = false,
}: {
  claim: Claim;
  userId: string;
  collapsed?: boolean;
}) {
  const evidence = (
    <>
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
    </>
  );
  return collapsed ? (
    <details className={styles.evidence}>
      <summary>
        {claim.origin === "from_class" ? "Session sources" : "AI explanation"}
        {claim.uncertain ? " · Check this" : ""}
      </summary>
      <div className={styles.evidenceBody}>{evidence}</div>
    </details>
  ) : (
    <div className="preview-stack">{evidence}</div>
  );
}

function QuietLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      prefetch={false}
      href={href}
      className={styles.quietLink}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (event) => event.preventDefault() : undefined}
    >
      {children}
    </Link>
  );
}

export function NoteView({
  sessionId,
  userId,
  initial,
  latest,
  readOnlyRevision,
  embedded = false,
  courseId,
  hasEarlierVersions,
  sourceIssues = [],
  materialSources = [],
  adaptation = null,
}: {
  sessionId: string;
  userId: string;
  initial: Notebook | null;
  latest: KnowledgeVersion | null;
  readOnlyRevision?: NotebookRevision;
  embedded?: boolean;
  courseId?: string;
  hasEarlierVersions?: boolean;
  sourceIssues?: readonly NoteSourceIssue[];
  materialSources?: readonly NoteMaterialSource[];
  adaptation?: LessonAdaptationView | null;
}) {
  const router = useRouter();
  const [notebook, setNotebook] = useState(initial),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null),
    [text, setText] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [legacyPlayback, setLegacyPlayback] = useState<{
    revisionId: string;
    itemId: string;
    target: string;
  } | null>(null);
  const [recovering, setRecovering] = useState<string | null>(null);
  const notesStart = useRef<HTMLDivElement | null>(null);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const recoveryKey = useRef<{ payload: string; key: string } | null>(null);
  const learningRetryKey = useRef<{ payload: string; key: string } | null>(null);
  const preparedRecovery = useRef<{ payload: string; next: string } | null>(null);
  const recoveryInFlight = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    if (!saving.current && !editing)
      setNotebook((previous) =>
        initial && previous && initial.current.number < previous.current.number
          ? previous
          : initial,
      );
  }, [initial, editing]);
  const current = readOnlyRevision ?? notebook?.current,
    preview = current ? null : latest,
    model = current?.model ?? preview?.model;
  const reviewVersionId = current?.knowledgeVersionId ?? preview?.id;
  useEffect(() => {
    setLegacyPlayback((previous) =>
      !previous || editMode || readOnlyRevision?.id || previous.revisionId !== current?.id
        ? null
        : previous,
    );
  }, [current?.id, editMode, readOnlyRevision?.id]);
  const canEdit = !!notebook && !readOnlyRevision;
  const showHistory = hasEarlierVersions ?? (current?.number ?? 0) > 1;
  const explanationLanguage = model?.language.explanation;
  const learningLanguage = model?.language.learning;
  const editingLanguage = editing?.startsWith("front:") ? learningLanguage : explanationLanguage;
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
  async function recoverSource(issue: NoteSourceIssue) {
    if (!issue.recovery || recoveryInFlight.current || saving.current) return;
    recoveryInFlight.current = true;
    setRecovering(issue.sourceId);
    setProblem("");
    try {
      const payload = JSON.stringify(issue.recovery);
      if (preparedRecovery.current?.payload !== payload) {
        const value = await workspaceRequest<{ next: string }>(
          `/api/classes/${sessionId}/notes/recovery`,
          "POST",
          issue.recovery,
          requestKey(recoveryKey, issue.recovery),
        );
        preparedRecovery.current = { payload, next: value.next };
      }
      await workspaceRequest(
        `/api/classes/${sessionId}/learning`,
        "POST",
        { action: "retry" },
        requestKey(learningRetryKey, issue.recovery),
      );
      recoveryKey.current = null;
      learningRetryKey.current = null;
      preparedRecovery.current = null;
      notifyAutomaticLearning(sessionId);
      router.push(`/sessions/${sessionId}/processing`);
    } catch (failure) {
      const reasons =
        failure instanceof WorkspaceRequestError ? Object.values(failure.fields ?? {}).flat() : [];
      const message = reasons.includes("original_unavailable")
        ? `${issue.name}: the original file is no longer available. Open session material to upload it again or recover the recording on its original device.`
        : reasons.includes("retry_selection_changed") || reasons.includes("retry_issue_changed")
          ? `${issue.name}: session material has changed. Refresh the notes and review the current files before retrying.`
          : reasons.includes("provider_outcome_unresolved")
            ? `${issue.name}: an earlier processing attempt still needs checking. Open session processing before starting another attempt.`
            : failure instanceof Error
              ? failure.message
              : `${issue.name} could not be retried.`;
      setProblem(message);
    } finally {
      recoveryInFlight.current = false;
      setRecovering(null);
    }
  }

  function materialIssues() {
    if (!sourceIssues.length) {
      return model && !model.coverage.complete ? (
        <aside className={styles.issues} aria-label="Source details need checking">
          <p>Some source details need checking. Open session material to review them.</p>
          <QuietLink disabled={busy} href={`/sessions/${sessionId}/sources`}>
            Review session material
          </QuietLink>
        </aside>
      ) : null;
    }
    return (
      <aside className={styles.issues} aria-label="Session material needs attention">
        <p>Some session material needs attention.</p>
        <ul>
          {sourceIssues.map((issue) => (
            <li key={`${issue.sourceId}-${issue.kind}-${issue.locator ?? ""}`}>
              <p className={styles.issueName}>
                <strong>
                  File {issue.order} · <bdi>{issue.name}</bdi>
                </strong>
              </p>
              <p>{issue.message}</p>
              {(issue.details || issue.locator) && (
                <details className={styles.evidence}>
                  <summary>Details</summary>
                  {issue.locator && <p>{issue.locator}</p>}
                  {issue.details && <p>{issue.details}</p>}
                </details>
              )}
              {issue.action === "retry" && issue.recovery ? (
                <Button
                  secondary
                  className={styles.quiet}
                  disabled={busy || !!recovering}
                  onClick={() => recoverSource(issue)}
                >
                  {recovering === issue.sourceId ? "Retrying…" : `Retry file ${issue.order}`}
                </Button>
              ) : issue.action !== "none" ? (
                <QuietLink disabled={busy || !!recovering} href={`/sessions/${sessionId}/sources`}>
                  {issue.action === "upload"
                    ? `Upload file ${issue.order} again`
                    : "Review session material"}
                </QuietLink>
              ) : null}
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  async function save(change: Omit<PublishNotebookInput, "expectedRevisionId">) {
    if (saving.current || recoveryInFlight.current) return;
    saving.current = true;
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
      setNotice("Notes saved.");
      router.refresh();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "Notes could not be saved.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function editForm() {
    return (
      <form
        className={styles.editor}
        onSubmit={(event) => {
          event.preventDefault();
          const [kind, id] = editing?.split(":") ?? [];
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
            lang={editingLanguage}
            dir={editingLanguage ? directionOf(editingLanguage) : "auto"}
            style={{ textAlign: "start" }}
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
    );
  }

  function claim(claim: Claim) {
    return (
      <article key={claim.id} className="preview-list-item">
        <NoteText text={claim.text} lang={explanationLanguage} />
        <ClaimEvidence claim={claim} userId={userId} collapsed />
        {canEdit && editMode && (
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
        {canEdit && editing === `claim:${claim.id}` && editForm()}
      </article>
    );
  }
  return (
    <div className={styles.layout} ref={notesStart}>
      {!embedded && (
        <Link prefetch={false} href={`/sessions/${sessionId}`} className={styles.back}>
          ← Back to session
        </Link>
      )}
      {problem && <Status tone="error">{problem}</Status>}
      {notice && <Status tone="success">{notice}</Status>}
      {!model ? (
        <Panel title="Start with session material">
          <p>
            Add your session material. Notes and flashcards are created and saved automatically.
          </p>
          {materialSources.length ? (
            <ul className={styles.materials} aria-label="Selected session material">
              {materialSources.map((source) => (
                <li key={source.sourceId}>
                  <p className={styles.issueName}>
                    <strong>
                      File {source.order} · <bdi>{source.name}</bdi>
                    </strong>
                  </p>
                  <p className="preview-muted">
                    {source.status === "ready"
                      ? "Ready"
                      : source.status === "uploading"
                        ? "Uploading…"
                        : source.status === "local-audio"
                          ? "Saved on this device · automatic upload pending"
                          : "Upload not completed"}
                  </p>
                  {source.status === "needs-upload" && (
                    <QuietLink href={`/sessions/${sessionId}/sources`}>
                      Upload file {source.order} again
                    </QuietLink>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            materialIssues()
          )}
          <div className={styles.save}>
            <LinkButton href={`/sessions/${sessionId}/sources`}>Add material</LinkButton>
          </div>
        </Panel>
      ) : (
        <>
          {model.classNotes && !editMode ? (
            <>
              {materialIssues()}
              {adaptation ? <LessonAdaptation adaptation={adaptation} /> : null}
              {current && !readOnlyRevision ? (
                <ClassNotesPlayback
                  key={current.id}
                  model={model}
                  sessionId={sessionId}
                  revisionId={current.id}
                />
              ) : (
                <ClassNotesFrame html={renderClassNotesHtml(model)} title={model.title} />
              )}
              <details className={styles.evidence}>
                <summary>Session sources and explanations</summary>
                <div className={styles.evidenceBody}>
                  {[
                    ...model.summary,
                    ...model.topics.flatMap((topic) => topic.claims),
                    ...model.learningItems.map((item) => item.claim),
                    ...model.homework,
                    ...model.uncertainties,
                  ].map((item) => (
                    <div key={item.id}>
                      <NoteText text={item.text} lang={explanationLanguage} />
                      <ClaimEvidence claim={item} userId={userId} collapsed />
                    </div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <>
              {model.classNotes && editMode && (
                <Status>
                  Edit the saved notes below. Editing a study item's question or answer turns it
                  into a plain-text item; its original structured card remains in version history.
                </Status>
              )}
              <Panel>
                <ContentBlock as="h2" lang={explanationLanguage} dir="auto">
                  {model.title}
                </ContentBlock>
                <p className="preview-muted">
                  {current
                    ? `Note version ${current.number} · ${new Date(current.createdAt).toLocaleString("en-GB")}`
                    : `Read-only preview · ${new Date(preview?.createdAt ?? "").toLocaleString("en-GB")}`}
                </p>
                {materialIssues()}
                <h3>Class summary</h3>
                {model.summary.map(claim)}
                {model.topics.map((topic) => (
                  <section key={topic.id}>
                    <ContentBlock as="h3" lang={explanationLanguage} dir="auto">
                      {topic.title}
                    </ContentBlock>
                    {topic.claims.map(claim)}
                  </section>
                ))}
              </Panel>
              <Panel title="Useful things to learn">
                {model.learningItems.length ? (
                  model.learningItems.map((item) => {
                    const target =
                      current && !readOnlyRevision && !editMode
                        ? studyPronunciationTarget(item)
                        : undefined;
                    const selected =
                      !!target &&
                      current?.id === legacyPlayback?.revisionId &&
                      item.id === legacyPlayback?.itemId &&
                      target === legacyPlayback?.target;
                    return (
                      <article className="preview-list-item" key={item.id}>
                        <ContentBlock as="h3" lang={learningLanguage}>
                          {item.front}
                        </ContentBlock>
                        {target && current && (
                          <div className={pronunciationStyles.fallback}>
                            <span lang="en" dir="ltr">
                              {target}
                            </span>
                            {selected ? (
                              <PronunciationAudio
                                key={`${current.id}:${item.id}:${target}`}
                                sessionId={sessionId}
                                target={target}
                                request={{
                                  kind: "note_pronunciation",
                                  learningItemId: item.id,
                                  expectedNotebookRevisionId: current.id,
                                }}
                                trigger={1}
                              />
                            ) : (
                              <button
                                type="button"
                                className={pronunciationStyles.speaker}
                                aria-label={`Hear pronunciation of ${target}`}
                                title={`Hear pronunciation of ${target}`}
                                onClick={() =>
                                  setLegacyPlayback({
                                    revisionId: current.id,
                                    itemId: item.id,
                                    target,
                                  })
                                }
                              >
                                <SpeakerHigh size={20} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        )}
                        <NoteText text={item.back} lang={explanationLanguage} />
                        <ClaimEvidence claim={item.claim} userId={userId} collapsed />
                        {canEdit && editMode && (
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
                        {canEdit &&
                          (editing === `front:${item.id}` || editing === `back:${item.id}`) &&
                          editForm()}
                      </article>
                    );
                  })
                ) : (
                  <p>No learning items were found in this version.</p>
                )}
              </Panel>
              {!!model.homework.length && (
                <Panel title="Homework">{model.homework.map(claim)}</Panel>
              )}
              {!!model.uncertainties.length && (
                <Panel title="Things to check">{model.uncertainties.map(claim)}</Panel>
              )}
            </>
          )}
          {!!(unmatchedClaims.length + unmatchedItems.length) && (
            <Panel title="Your saved edits from earlier material">
              <p>
                These edits did not match an item in the latest session version. They remain saved
                here and in version history.
              </p>
              {unmatchedClaims.map(([id, value]) => (
                <article key={id} className="preview-list-item">
                  <NoteText text={value} />
                  <p className="preview-muted">Edited by you · Earlier item {id}</p>
                </article>
              ))}
              {unmatchedItems.map(([id, value]) => (
                <article key={id} className="preview-list-item">
                  <ContentBlock as="h3" dir="auto">
                    {value.front ?? "Earlier question"}
                  </ContentBlock>
                  <NoteText text={value.back ?? "No answer edit"} />
                  <p className="preview-muted">Edited by you · Earlier item {id}</p>
                </article>
              ))}
            </Panel>
          )}
          {preview && (
            <div className={styles.save}>
              <p>
                This generated preview is available. New uploads automatically save your notes and
                flashcards.
              </p>
            </div>
          )}
        </>
      )}
      {model && reviewVersionId && !readOnlyRevision && (
        <LessonReview
          sessionId={sessionId}
          knowledgeVersionId={reviewVersionId}
          knowledgeVersion={latest?.id === reviewVersionId ? latest.version : undefined}
          hasEdits={hasLessonEdits(current)}
        />
      )}
      {!embedded && (canEdit || courseId || readOnlyRevision || showHistory) && (
        <footer>
          <nav className={styles.footer} aria-label="Note tools">
            {canEdit && (
              <Button
                secondary
                className={styles.quiet}
                disabled={busy}
                aria-pressed={editMode}
                onClick={() => {
                  setEditMode(!editMode);
                  setEditing(null);
                  if (!editMode) notesStart.current?.scrollIntoView({ block: "start" });
                }}
              >
                {editMode ? "Done editing" : "Edit notes"}
              </Button>
            )}
            {courseId && (
              <QuietLink disabled={busy} href={`/courses/${courseId}/materials`}>
                Course materials
              </QuietLink>
            )}
            {notebook && !readOnlyRevision && (
              <>
                <QuietLink disabled={busy} href={`/sessions/${sessionId}/cards`}>
                  Flashcards
                </QuietLink>
                <QuietLink disabled={busy} href={`/sessions/${sessionId}/export`}>
                  Download notes
                </QuietLink>
              </>
            )}
            {readOnlyRevision && (
              <QuietLink disabled={busy} href={`/sessions/${sessionId}/notes`}>
                Current notes
              </QuietLink>
            )}
            {model && !readOnlyRevision && (
              <QuietLink disabled={busy} href={`/sessions/${sessionId}/sources`}>
                Add material
              </QuietLink>
            )}
            {showHistory && (
              <QuietLink disabled={busy} href={`/sessions/${sessionId}/notes/versions`}>
                Version history
              </QuietLink>
            )}
          </nav>
        </footer>
      )}
      {!embedded && !readOnlyRevision && <AutomaticLearningNotice sessionId={sessionId} />}
    </div>
  );
}
