import { getFeedbackThread } from "@recalino/core/support";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "../../../../server/auth/learner";
import { getDatabase } from "../../../../server/db";
import { pageRead, workspaceActor } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { SupportConversation } from "../../../../ui/support/Support";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function FeedbackThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ received?: string }>;
}) {
  const { id } = await params;
  const learner = await requireLearner(`/help/${id}`);
  // SEC-09: a malformed id, a missing conversation or another learner's answers 404.
  if (!z.uuid().safeParse(id).success) notFound();
  const initial = await pageRead(learner, "/help/[id]", () =>
    getFeedbackThread(getDatabase(), workspaceActor(learner), id),
  );
  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={
        <PageHeader
          title="Your conversation"
          subtitle="Replies appear here after the team reviews your message."
        />
      }
    >
      <SupportConversation
        initial={initial}
        received={(await searchParams).received === "1"}
        timezone={learner.state.timezone ?? "UTC"}
      />
    </LearnerShell>
  );
}
