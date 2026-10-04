import { getSession } from "@recalino/core/org";
import { listRuns } from "@recalino/core/proc";
import { readInputContract } from "@recalino/core/src";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { readProcessingEstimate } from "../../../../../server/processing-routes";
import { workspaceActor } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { ProcessingView } from "../../../../../ui/workspace/ProcessingView";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/classes/${id}/estimate`),
    actor = workspaceActor(learner),
    db = getDatabase();
  const session = await getSession(db, actor, id);
  const [estimate, runs, contract] = await Promise.all([
    readProcessingEstimate(db, actor, id).catch(() => null),
    listRuns(db, actor, id),
    readInputContract(db).catch(() => null),
  ]);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={
        <PageHeader
          title={session.title ?? "Class processing"}
          subtitle="Selected sources and allowance"
        />
      }
    >
      <ProcessingView
        sessionId={id}
        userId={learner.userId}
        initialEstimate={estimate}
        initialRuns={runs}
        contract={contract}
      />
    </LearnerShell>
  );
}
