import { type StudyCard, studyPronunciationTarget } from "@recalino/core/card";
import type { Notebook } from "@recalino/core/note";
import { orderNewCards, type ReviewQueue } from "@recalino/core/srs";
import { renderClassNotesHtml, renderStudyCard } from "@recalino/core/study-render";
import Link from "next/link";
import {
  MULTILINGUAL_STUDY_CASES,
  multilingualStudyModel,
} from "../../../../../../../packages/core/test/multilingual-study-fixture";
import { referenceStudyModel } from "../../../../../../../packages/core/test/reference-study-fixture";
import { AppShell, PageHeader } from "../../../../ui/shell/AppShell";
import { CardsView } from "../../../../ui/workspace/CardsView";
import { ExportView } from "../../../../ui/workspace/ExportView";
import { NoteView } from "../../../../ui/workspace/NoteView";
import { Panel } from "../../../../ui/workspace/primitives";
import { ReviewView } from "../../../../ui/workspace/ReviewView";
import { SessionNotesReader } from "../../../../ui/workspace/SessionNotesReader";
import "../../../../ui/workspace/workspace.css";

/** Uses the real reading and review components with a synthetic, local-only lesson. */
export default async function StudyReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; language?: string | string[] }>;
}) {
  const { view, language } = await searchParams;
  const languageCase = MULTILINGUAL_STUDY_CASES.find((value) => value.language === language);
  const model = languageCase ? multilingualStudyModel(languageCase) : referenceStudyModel();
  if (view === "legacy-notes") delete model.classNotes;
  const referenceHref = (nextView?: string): string => {
    const query = new URLSearchParams();
    if (languageCase) query.set("language", languageCase.language);
    if (nextView) query.set("view", nextView);
    return `/dev/ui/study${query.size ? `?${query.toString()}` : ""}`;
  };
  // Phase one has no voice verification. Synthetic spoken examples stay withheld too.
  if (model.classNotes?.mistakes) model.classNotes.mistakes.speechStatus = "unverified";
  // Lesson-quality coverage fixture (workstream 3): one used file and one unreadable photo.
  const coverageSources = [
    {
      sourceId: "10000000-0000-4000-8000-0000000000a1",
      name: "Handout.pdf",
      order: 1,
      status: "ready" as const,
    },
    {
      sourceId: "10000000-0000-4000-8000-0000000000a2",
      name: "Board photo.jpeg",
      order: 2,
      status: "ready" as const,
    },
  ];
  if (view === "coverage")
    model.coverage = {
      ...model.coverage,
      sources: [
        { sourceId: "10000000-0000-4000-8000-0000000000a1", status: "used" },
        {
          sourceId: "10000000-0000-4000-8000-0000000000a2",
          status: "not_used",
          reason: "unreadable",
        },
      ],
    };
  const sessionId = "10000000-0000-4000-8000-000000000001";
  const userId = "10000000-0000-4000-8000-000000000002";
  const createdAt = "2026-10-05T12:00:00.000Z";
  const notebook: Notebook = {
    id: "reference-notebook",
    sessionId,
    proposedKnowledgeVersionId: null,
    current: {
      id: "reference-revision",
      notebookId: "reference-notebook",
      sessionId,
      number: 1,
      knowledgeVersionId: "reference-knowledge",
      model,
      edits: { claims: {}, items: {} },
      createdAt,
    },
  };
  if (view === "reader" || view === "reader-readonly")
    return (
      <div className="workspace-root">
        <SessionNotesReader
          sessionId={sessionId}
          title={model.title}
          courseName="Synthetic English course"
          classDate="2026-10-05"
          topics={["Binomials", "Everyday expressions"]}
          hasNotes
          revisionNumber={notebook.current.number}
          backHref={referenceHref("reader-session")}
          cardsHref={referenceHref("cards")}
        >
          <NoteView
            sessionId={sessionId}
            userId={userId}
            initial={notebook}
            latest={null}
            courseId="10000000-0000-4000-8000-000000000003"
            readOnlyRevision={view === "reader-readonly" ? notebook.current : undefined}
            standalone
          />
        </SessionNotesReader>
      </div>
    );
  if (view === "reader-session")
    return (
      <div className="workspace-root">
        <AppShell
          current="classes"
          hrefs={{
            today: referenceHref(),
            classes: referenceHref(),
            review: referenceHref("review"),
            me: referenceHref(),
          }}
        >
          <PageHeader
            title="Synthetic session"
            subtitle="Synthetic reading navigation fixture · No real session data"
          />
          {Array.from({ length: 8 }, (_, index) => `Session material ${index + 1}`).map((title) => (
            <Panel key={title} title={title}>
              <p>This saved synthetic material belongs to the same lesson.</p>
            </Panel>
          ))}
          <Link href={referenceHref("reader")}>Open session notes</Link>
        </AppShell>
      </div>
    );
  const cards: StudyCard[] = model.learningItems
    .filter((item) => item.study)
    .map((item, index) => ({
      id: `reference-card-${index}`,
      ownerId: userId,
      learningItemId: item.id,
      sessionIds: [sessionId],
      template: "basic",
      direction: "forward",
      ...renderStudyCard(item, model.language.explanation),
      provenance: item.claim,
      status: "active",
      contentVersion: 1,
      important: false,
      qualityConfirmed: true,
      frontMediaId: null,
      backMediaId: null,
      createdAt,
      updatedAt: createdAt,
      contentFormat: "lesson_html",
      studySet: item.study?.set,
      studyPosition: index,
      studyTags: ["2026-10-05", "binomials", item.study?.set ?? "production"],
      pronunciationTarget: studyPronunciationTarget(item),
    }));
  const firstCard = cards[0];
  if (!firstCard) throw new Error("The reference lesson must contain a study card.");
  const queue: ReviewQueue = {
    hasCards: true,
    cards: orderNewCards(
      cards.map((card) => ({
        card,
        schedule: {
          cardId: card.id,
          version: 0,
          dueAt: createdAt,
          introducedAt: null,
          state: {
            due: new Date(createdAt),
            stability: 0,
            difficulty: 0,
            elapsed_days: 0,
            scheduled_days: 0,
            learning_steps: 0,
            reps: 0,
            lapses: 0,
            state: 0,
          },
        },
      })),
      cards,
    ),
    dueCount: 0,
    newRemaining: cards.length,
    buriedSiblings: 0,
    nextDueAt: null,
    studyDay: "2026-10-05",
    timezone: "Europe/London",
    settings: { mode: "simple", desiredRetention: 0.9, dailyNewLimit: 20, timeBudgetMinutes: 10 },
  };
  return (
    <div className="workspace-root">
      <AppShell
        current="classes"
        hrefs={{
          today: referenceHref(),
          classes: referenceHref(),
          review: referenceHref("review"),
          me: referenceHref(),
        }}
      >
        <PageHeader
          title={
            view === "review"
              ? "Review your session"
              : view === "cards"
                ? "Session flashcards"
                : "Session notes"
          }
          subtitle={
            languageCase
              ? `Synthetic multilingual lesson · ${languageCase.language}`
              : "Synthetic reference lesson · 5 October 2026"
          }
        />
        <nav aria-label="Reference views" style={{ display: "flex", gap: 20, marginBottom: 16 }}>
          <Link href={referenceHref()}>Notes</Link>
          <Link href={referenceHref("cards")}>Cards</Link>
          <Link href={referenceHref("review")}>Review</Link>
          <Link href={referenceHref("export")}>Export</Link>
        </nav>
        {languageCase && (
          <p>
            <a
              href={`data:text/html;charset=utf-8,${encodeURIComponent(renderClassNotesHtml(model))}`}
              download={`class-${languageCase.language}.html`}
            >
              Download synthetic HTML
            </a>
          </p>
        )}
        {view === "export" ? (
          <ExportView
            sessionId={sessionId}
            revisions={[
              {
                id: notebook.current.id,
                number: 1,
                title: model.title,
                summary: [],
                practice: model.learningItems,
              },
            ]}
            cards={[
              ...cards,
              {
                ...firstCard,
                id: "rejected-reference",
                status: "rejected",
                front: "Rejected synthetic card",
              },
              {
                ...firstCard,
                id: "deleted-reference",
                status: "deleted",
                front: "Deleted synthetic card",
              },
            ]}
            images={[]}
            initial={{ html: [], anki: [] }}
            settings={null}
            storageConfigured={false}
          />
        ) : view === "review" ? (
          <ReviewView initial={queue} userId={userId} sessionId={sessionId} />
        ) : view === "cards" ? (
          <CardsView initial={cards} notebook={notebook} userId={userId} sessionId={sessionId} />
        ) : (
          <NoteView
            sessionId={sessionId}
            userId={userId}
            initial={notebook}
            latest={null}
            embedded={view !== "legacy-notes"}
            {...(view === "coverage" ? { materialSources: coverageSources } : {})}
          />
        )}
      </AppShell>
    </div>
  );
}
