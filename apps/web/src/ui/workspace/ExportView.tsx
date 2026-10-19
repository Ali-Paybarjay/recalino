"use client";
import { cardHtmlToText } from "@recalino/core/card-html";
import type { ExportArtifact, ExportSettings } from "@recalino/core/plt";
import { buildStudyAnkiText, studyExportFilename } from "@recalino/core/study-export";
import { useEffect, useRef, useState } from "react";
import { requestKey, workspaceRequest } from "./api";
import { CardFace } from "./CardFace";
import styles from "./ExportView.module.css";
import { Actions, Button, Field, LinkButton, Panel, Status } from "./primitives";
export interface ExportRevision {
  id: string;
  number: number;
  title: string;
  summary: { id: string; text: string }[];
  practice: { id: string; front: string; back: string }[];
}
export interface ExportCard {
  id: string;
  template: string;
  front: string;
  back: string;
  status: string;
  contentVersion: number;
  contentFormat?: "lesson_html";
  studySet?: "production" | "recognition";
  studyTags?: string[];
  studyPosition?: number;
}
export interface ExportImage {
  id: string;
  state: string;
  exportAllowed: boolean;
}
export interface ExportHistory {
  html: ExportArtifact[];
  anki: ExportArtifact[];
}
interface Preview {
  kind: "html" | "anki";
  estimatedBytes: number;
  items: number;
  settingsVersion: string;
}
export function ExportView({
  sessionId,
  revisions,
  cards,
  images: initialImages,
  initial,
  settings,
  storageConfigured,
}: {
  sessionId: string;
  revisions: ExportRevision[];
  cards: ExportCard[];
  images: ExportImage[];
  initial: ExportHistory;
  settings: ExportSettings | null;
  storageConfigured: boolean;
}) {
  const [kind, setKind] = useState<"html" | "anki">("html"),
    [images, setImages] = useState(initialImages),
    [revisionId, setRevisionId] = useState(revisions[0]?.id ?? ""),
    [imageIds, setImageIds] = useState<string[]>([]),
    [cardIds, setCardIds] = useState<string[]>(
      cards.filter((c) => c.status === "active").map((c) => c.id),
    ),
    [tags, setTags] = useState(""),
    [includeMedia, setIncludeMedia] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [preview, setPreview] = useState<{ value: Preview; payload: string } | null>(null),
    [history, setHistory] = useState(initial),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [notice, setNotice] = useState("");
  const key = useRef<{ payload: string; key: string } | null>(null);
  const [deckName, setDeckName] = useState("Recalino"),
    [courseTag, setCourseTag] = useState("");
  const studyCards = cards
    .filter(
      (card) =>
        card.contentFormat === "lesson_html" &&
        card.studySet &&
        !["rejected", "deleted"].includes(card.status),
    )
    .sort((left, right) => (left.studyPosition ?? 0) - (right.studyPosition ?? 0));
  function downloadStudySet(set: "production" | "recognition") {
    try {
      const text = buildStudyAnkiText(studyCards, { set, deckName, courseTag });
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = studyExportFilename(studyCards, set);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setProblem("");
      setNotice(`${set === "production" ? "Core" : "Supplementary"} Anki text download started.`);
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "The Anki text file could not be prepared.",
      );
    }
  }
  const revision = revisions.find((r) => r.id === revisionId),
    available = Boolean(settings && storageConfigured),
    queued = [...history.html, ...history.anki].some((a) => a.state === "queued");
  const selection =
    kind === "html"
      ? { kind, revisionId, mediaIds: imageIds }
      : {
          kind,
          cardIds,
          tags: tags.split(/\s+/).filter(Boolean),
          includeMedia,
          expectedVersions: Object.fromEntries(
            cards.filter((c) => cardIds.includes(c.id)).map((c) => [c.id, c.contentVersion]),
          ),
        };
  const payload = JSON.stringify(selection);
  const validPreview = preview?.payload === payload ? preview.value : null;
  useEffect(() => {
    if (!queued) return;
    let active = true;
    const timer = window.setInterval(() => {
      workspaceRequest<ExportHistory>(`/api/classes/${sessionId}/exports`, "GET")
        .then((value) => {
          if (active) setHistory(value);
        })
        .catch(() => {
          if (active)
            setProblem("The export status could not be refreshed. Reload this page to check it.");
        });
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [sessionId, queued]);
  function changed() {
    setPreview(null);
    setConfirmed(false);
    setProblem("");
    setNotice("");
  }
  async function permitImage(id: string) {
    setBusy(true);
    setProblem("");
    try {
      await workspaceRequest(`/api/media/${id}`, "PATCH", { exportAllowed: true });
      setImages((previous) =>
        previous.map((image) => (image.id === id ? { ...image, exportAllowed: true } : image)),
      );
      changed();
      setNotice("This image is permitted in exports. Select it to include it in this download.");
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "The image permission could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function viewImage(id: string) {
    setBusy(true);
    setProblem("");
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await workspaceRequest<{ url: string }>(`/api/media/${id}/read`, "GET");
      if (tab) tab.location.href = url;
      else setProblem("Allow pop-ups to view this image, then try again.");
    } catch (error) {
      tab?.close();
      setProblem(error instanceof Error ? error.message : "The image could not be opened.");
    } finally {
      setBusy(false);
    }
  }
  async function showPreview() {
    setBusy(true);
    setProblem("");
    try {
      const value = await workspaceRequest<Preview>(`/api/classes/${sessionId}/exports`, "POST", {
        ...selection,
        action: "preview",
      });
      setPreview({ value, payload });
      setConfirmed(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The preview could not be made.");
    } finally {
      setBusy(false);
    }
  }
  async function build() {
    if (!confirmed || !validPreview) return;
    setBusy(true);
    setProblem("");
    const body = { ...selection, action: "create", confirmed: true };
    try {
      const value = await workspaceRequest<{ kind: "html" | "anki"; artifact: ExportArtifact }>(
        `/api/classes/${sessionId}/exports`,
        "POST",
        body,
        requestKey(key, body),
      );
      setHistory((previous) => ({
        ...previous,
        [value.kind]: [
          value.artifact,
          ...previous[value.kind].filter((a) => a.id !== value.artifact.id),
        ],
      }));
      key.current = null;
      setConfirmed(false);
      setNotice("Your export is being built. Its contents stay fixed to this selection.");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The export could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function download(type: "html" | "anki", id: string) {
    setProblem("");
    setBusy(true);
    try {
      const { url } = await workspaceRequest<{ url: string }>(
        `/api/exports/${type}/${id}/download`,
        "GET",
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `recalino-${id}.${type === "anki" ? "apkg" : "html"}`;
      link.rel = "noopener noreferrer";
      document.body.append(link);
      link.click();
      link.remove();
      setNotice("Download started. Keep the file somewhere private.");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The download could not be opened.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.layout}>
      <Actions>
        <LinkButton secondary href={`/sessions/${sessionId}/notes`}>
          Back to notes
        </LinkButton>
        <LinkButton secondary href={`/sessions/${sessionId}/cards`}>
          Manage cards
        </LinkButton>
      </Actions>
      {problem && (
        <Status tone="error">
          {problem} Check your selection or refresh if another tab changed the session.
        </Status>
      )}
      {notice && <Status tone="success">{notice}</Status>}
      {!available && (
        <Status>
          Stored HTML and Anki package downloads will be available after export storage and limits
          are configured. Your notes and cards are saved.
        </Status>
      )}
      {!!studyCards.length && (
        <Panel title="Lesson cards · Anki text">
          <p>
            Download the same card faces you study here. Import the UTF-8 text file into Anki; the
            core and supplementary sets stay separate.
          </p>
          <p className="preview-muted">
            Each text file includes all remaining cards in that set, including cards awaiting
            confirmation or paused from review. Rejected and deleted cards are excluded. The package
            selection below applies only to the Anki package download.
          </p>
          <Field label="Anki deck name">
            <input
              value={deckName}
              maxLength={100}
              onChange={(event) => setDeckName(event.target.value)}
            />
          </Field>
          <Field label="Course tag" hint="Optional. Use one word, such as cambria.">
            <input
              value={courseTag}
              maxLength={100}
              onChange={(event) => setCourseTag(event.target.value)}
            />
          </Field>
          <Actions>
            {(["production", "recognition"] as const).map((set) => {
              const count = studyCards.filter((card) => card.studySet === set).length;
              return count ? (
                <Button
                  key={set}
                  secondary={set === "recognition"}
                  disabled={!deckName.trim() || busy}
                  onClick={() => downloadStudySet(set)}
                >
                  {set === "production" ? "Download core cards" : "Download supplementary cards"}{" "}
                  (.txt) · {count}
                </Button>
              ) : null;
            })}
          </Actions>
        </Panel>
      )}
      <fieldset className={styles.tabs}>
        <legend>Download format</legend>
        <Button
          secondary
          aria-pressed={kind === "html"}
          disabled={busy}
          onClick={() => {
            setKind("html");
            changed();
          }}
        >
          HTML notes
        </Button>
        <Button
          secondary
          aria-pressed={kind === "anki"}
          disabled={busy}
          onClick={() => {
            setKind("anki");
            changed();
          }}
        >
          Anki cards
        </Button>
      </fieldset>
      <div className="preview-grid">
        <Panel title={kind === "html" ? "A standalone notebook" : "Your cards in Anki"}>
          {kind === "html" ? (
            <>
              <p>
                A readable copy with summaries, session material, practice answers and source
                locations. It opens without an account or internet connection.
              </p>
              {!revisions.length ? (
                <Status>Publish your session notes before exporting.</Status>
              ) : (
                <Field label="Notebook revision">
                  <select
                    value={revisionId}
                    disabled={busy}
                    onChange={(event) => {
                      setRevisionId(event.target.value);
                      changed();
                    }}
                  >
                    {revisions.map((r) => (
                      <option key={r.id} value={r.id}>
                        Version {r.number} · {r.title}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {!!images.length && (
                <fieldset className={styles.choices}>
                  <legend>Images to embed</legend>
                  {images.map((image, index) => (
                    <div key={image.id}>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          disabled={busy || image.state !== "ready" || !image.exportAllowed}
                          checked={imageIds.includes(image.id)}
                          onChange={(event) => {
                            setImageIds((previous) =>
                              event.target.checked
                                ? [...previous, image.id]
                                : previous.filter((id) => id !== image.id),
                            );
                            changed();
                          }}
                        />
                        Image {index + 1}
                        {!image.exportAllowed
                          ? " · Export permission needed"
                          : image.state !== "ready"
                            ? " · Not ready"
                            : ""}
                      </label>
                      <Actions>
                        {image.state === "ready" && (
                          <Button
                            secondary
                            disabled={busy}
                            onClick={() => void viewImage(image.id)}
                          >
                            View image {index + 1}
                          </Button>
                        )}
                        {image.state === "ready" && !image.exportAllowed && (
                          <Button
                            secondary
                            disabled={busy}
                            onClick={() => void permitImage(image.id)}
                          >
                            Allow this image in downloads
                          </Button>
                        )}
                      </Actions>
                    </div>
                  ))}
                </fieldset>
              )}
            </>
          ) : (
            <>
              <p>
                Choose card content to import into Anki. Cards begin as new cards there, with
                independent review progress. Re-exporting keeps their logical identities.
              </p>
              <fieldset className={styles.choices}>
                <legend>Cards to export ({cardIds.length})</legend>
                {cards.map((card) => (
                  <label key={card.id} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={cardIds.includes(card.id)}
                      disabled={busy}
                      onChange={(event) => {
                        setCardIds((previous) =>
                          event.target.checked
                            ? [...previous, card.id]
                            : previous.filter((id) => id !== card.id),
                        );
                        changed();
                      }}
                    />
                    <span>
                      {card.contentFormat === "lesson_html"
                        ? cardHtmlToText(card.front)
                        : card.front}
                      <small className={styles.muted}>
                        {" "}
                        · {card.template} · {card.status}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {!cards.length && <Status>Create and save cards before exporting.</Status>}
              <Field
                label="Tags"
                hint="Separate tags with spaces. Letters, numbers, underscores and :: are supported."
              >
                <input
                  value={tags}
                  disabled={busy}
                  onChange={(event) => {
                    setTags(event.target.value);
                    changed();
                  }}
                  maxLength={1000}
                />
              </Field>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={includeMedia}
                  disabled={busy}
                  onChange={(event) => {
                    setIncludeMedia(event.target.checked);
                    changed();
                  }}
                />
                Include ready card media with explicit export permission
              </label>
              <p className={styles.muted}>
                Listening cards need their permitted audio. Session recordings are excluded.
              </p>
            </>
          )}
          <Button
            disabled={busy || !available || (kind === "html" ? !revisionId : !cardIds.length)}
            onClick={() => void showPreview()}
          >
            Preview this export
          </Button>
        </Panel>
        <Panel title="Content preview">
          {kind === "html" && revision ? (
            <>
              <h3>{revision.title}</h3>
              {revision.summary.slice(0, 2).map((claim) => (
                <p key={claim.id}>{claim.text}</p>
              ))}
              {revision.practice.slice(0, 2).map((item) => (
                <details key={item.id}>
                  <summary>{item.front}</summary>
                  <p>{item.back}</p>
                </details>
              ))}
              <p className={styles.muted}>
                These are excerpts. All content in the chosen revision is included.
              </p>
            </>
          ) : (
            cards
              .filter((c) => cardIds.includes(c.id))
              .slice(0, 3)
              .map((card) => (
                <article key={card.id} className="preview-list-item">
                  <CardFace card={card} revealed />
                </article>
              ))
          )}
          {validPreview ? (
            <>
              <Status>
                {validPreview.items} learning entries · estimated{" "}
                {(validPreview.estimatedBytes / 1024).toFixed(1)} KB ·{" "}
                {kind === "html" ? ".html" : ".apkg"}
              </Status>
              <p>
                No full class audio, transcript, account information or review history. Read the
                selected content before sharing it.
              </p>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I have checked this content. I understand that downloaded copies cannot be revoked.
              </label>
              <Button disabled={busy || !confirmed} onClick={() => void build()}>
                {busy ? "Building…" : "Create download"}
              </Button>
            </>
          ) : (
            <p className={styles.muted}>Preview your selection to check its contents and size.</p>
          )}
        </Panel>
      </div>
      <Panel title="Your export files">
        {[
          ...history.html.map((a) => ({ ...a, kind: "html" as const })),
          ...history.anki.map((a) => ({ ...a, kind: "anki" as const })),
        ]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((artifact) => (
            <article className="preview-list-item" key={artifact.id}>
              <div>
                <strong>{artifact.kind === "html" ? "HTML notebook" : "Anki package"}</strong>
                <p>
                  {artifact.state === "queued"
                    ? "Building your file…"
                    : artifact.state === "ready"
                      ? `${((artifact.actualBytes ?? 0) / 1024).toFixed(1)} KB · Ready to download`
                      : "This file could not be built. Create a new export after checking the selection."}
                </p>
                <small>Expires {new Date(artifact.expiresAt).toLocaleString("en-GB")}</small>
              </div>
              {artifact.state === "ready" && (
                <Button
                  disabled={busy}
                  secondary
                  onClick={() => void download(artifact.kind, artifact.id)}
                >
                  Download {artifact.kind === "anki" ? ".apkg" : "HTML"}
                </Button>
              )}
            </article>
          ))}
        {!history.html.length && !history.anki.length && <p>No export files yet.</p>}
      </Panel>
    </div>
  );
}
