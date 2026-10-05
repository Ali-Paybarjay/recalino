import { listFeedback } from "@recalino/core/support";
import { requireLearner } from "../../../server/auth/learner";
import { getDatabase } from "../../../server/db";
import { workspaceActor } from "../../../server/workspace";
import { PageHeader } from "../../../ui/shell/AppShell";
import { SupportList } from "../../../ui/support/Support";
import { LearnerShell } from "../LearnerShell";
export const dynamic = "force-dynamic";
export default async function HelpPage() {
  const learner = await requireLearner("/help");
  const initial = await listFeedback(getDatabase(), workspaceActor(learner));
  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={
        <PageHeader
          title="Help & feedback"
          subtitle="Your questions, ideas and conversations with the Recalino team."
        />
      }
    >
      <SupportList initial={initial} timezone={learner.state.timezone ?? "UTC"} />
    </LearnerShell>
  );
}
