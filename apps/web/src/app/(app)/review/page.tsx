import { getReviewQueue } from "@recalino/core/srs";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "../../../server/auth/learner";
import { getDatabase } from "../../../server/db";
import { workspaceActor, workspaceSession } from "../../../server/workspace";
import { PageHeader } from "../../../ui/shell/AppShell";
import { ReviewView } from "../../../ui/workspace/ReviewView";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const learner = await requireLearner("/review");
  const { sessionId } = await searchParams;
  if (sessionId) {
    if (!z.uuid().safeParse(sessionId).success) notFound();
    await workspaceSession(learner, sessionId);
  }
  const queue = await getReviewQueue(getDatabase(), workspaceActor(learner), { sessionId });
  return (
    <LearnerShell
      learner={learner}
      current="review"
      header={
        <PageHeader
          title="A little practice"
          subtitle="Keep the useful things from class with you."
        />
      }
    >
      <ReviewView initial={queue} userId={learner.userId} sessionId={sessionId} />
    </LearnerShell>
  );
}
