import { listCards } from "@recalino/core/card";
import { getLatestVersion } from "@recalino/core/lkm";
import { getNotebook } from "@recalino/core/note";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { workspaceActor, workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { CardsView } from "../../../../../ui/workspace/CardsView";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function ClassCardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/cards`);
  const session = await workspaceSession(learner, id);
  const db = getDatabase(),
    ctx = workspaceActor(learner);
  const [cards, notebook, latest] = await Promise.all([
    listCards(db, ctx, { sessionId: id }),
    getNotebook(db, ctx, id),
    getLatestVersion(db, ctx, id),
  ]);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Session flashcards" subtitle={session.displayTitle} />}
    >
      <CardsView
        sessionId={id}
        userId={learner.userId}
        initial={cards}
        notebook={notebook}
        hasGeneratedNotes={!!latest}
      />
    </LearnerShell>
  );
}
