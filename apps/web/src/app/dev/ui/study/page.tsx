import type { StudyCard } from "@recalino/core/card";
import type { Notebook } from "@recalino/core/note";
import type { ReviewQueue } from "@recalino/core/srs";
import { renderStudyCard } from "@recalino/core/study-render";
import Link from "next/link";
import { referenceStudyModel } from "../../../../../../../packages/core/test/reference-study-fixture";
import { AppShell, PageHeader } from "../../../../ui/shell/AppShell";
import { CardsView } from "../../../../ui/workspace/CardsView";
import { ExportView } from "../../../../ui/workspace/ExportView";
import { NoteView } from "../../../../ui/workspace/NoteView";
import { ReviewView } from "../../../../ui/workspace/ReviewView";
import "../../../../ui/preview/preview.css";

/** Uses the real reading and review components with a synthetic, local-only lesson. */
export default async function StudyReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const model = referenceStudyModel();
  // Phase one has no voice verification. Synthetic spoken examples stay withheld too.
  if (model.classNotes?.mistakes) model.classNotes.mistakes.speechStatus = "unverified";
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
  const cards: StudyCard[] = model.learningItems
    .filter((item) => item.study)
    .map((item, index) => ({
      id: `reference-card-${index}`,
      ownerId: userId,
      learningItemId: item.id,
      sessionIds: [sessionId],
      template: "basic",
      direction: "forward",
      ...renderStudyCard(item),
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
    }));
  const firstCard = cards[0];
  if (!firstCard) throw new Error("The reference lesson must contain a study card.");
  const queue: ReviewQueue = {
    availableStudySets: ["production", "recognition"],
    studySet: "production",
    cards: cards
      .filter((card) => card.studySet === "production")
      .map((card) => ({
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
    dueCount: 0,
    newRemaining: cards.length,
    buriedSiblings: 0,
    nextDueAt: null,
    studyDay: "2026-10-05",
    timezone: "Europe/London",
    settings: { mode: "simple", desiredRetention: 0.9, dailyNewLimit: 20, timeBudgetMinutes: 10 },
  };
  return (
    <div className="preview-root">
      <AppShell
        current="classes"
        hrefs={{
          today: "/dev/ui/study",
          classes: "/dev/ui/study",
          review: "/dev/ui/study?view=review",
          me: "/dev/ui/study",
        }}
      >
        <PageHeader
          title={
            view === "review"
              ? "Review your class"
              : view === "cards"
                ? "Class flashcards"
                : "Class notes"
          }
          subtitle="Synthetic reference lesson · 5 October 2026"
        />
        <nav aria-label="Reference views" style={{ display: "flex", gap: 20, marginBottom: 16 }}>
          <Link href="/dev/ui/study">Notes</Link>
          <Link href="/dev/ui/study?view=cards">Cards</Link>
          <Link href="/dev/ui/study?view=review">Review</Link>
          <Link href="/dev/ui/study?view=export">Export</Link>
        </nav>
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
            embedded
          />
        )}
      </AppShell>
    </div>
  );
}
