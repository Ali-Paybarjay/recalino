import { listRuns } from "@recalino/core/proc";
import { readInputContract } from "@recalino/core/src";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { readProcessingEstimateState } from "../../../../../server/processing-estimate-state";
import { workspaceActor, workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { ProcessingView } from "../../../../../ui/workspace/ProcessingView";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/classes/${id}/estimate`),
    actor = workspaceActor(learner),
    db = getDatabase();
  const session = await workspaceSession(learner, id);
  const [estimateState, runs, contract] = await Promise.all([
    readProcessingEstimateState(db, actor, id),
    listRuns(db, actor, id),
    readInputContract(db).catch(() => null),
  ]);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Class processing" subtitle={session.displayTitle} />}
    >
      <ProcessingView
        sessionId={id}
        userId={learner.userId}
        initialEstimate={estimateState.estimate}
        initialEstimateProblem={estimateState.problem}
        sourcesVersion={session.sourcesVersion}
        initialRuns={runs}
        contract={contract}
      />
    </LearnerShell>
  );
}
