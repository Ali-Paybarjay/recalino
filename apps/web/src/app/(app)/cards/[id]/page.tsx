import { type CardProposal, getCard, listCardProposals, type StudyCard } from "@recalino/core/card";
import { AppError } from "@recalino/core/plt";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "../../../../server/auth/learner";
import { getDatabase } from "../../../../server/db";
import { workspaceActor } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { CardEditor } from "../../../../ui/workspace/CardEditor";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/cards/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  let initial: StudyCard, proposals: CardProposal[];
  try {
    [initial, proposals] = await Promise.all([
      getCard(getDatabase(), workspaceActor(learner), id),
      listCardProposals(getDatabase(), workspaceActor(learner), id),
    ]);
  } catch (failure) {
    if (failure instanceof AppError && failure.code === "not_found") notFound();
    throw failure;
  }
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Your flashcard" />}
    >
      <CardEditor initial={initial} initialProposals={proposals} userId={learner.userId} />
    </LearnerShell>
  );
}
