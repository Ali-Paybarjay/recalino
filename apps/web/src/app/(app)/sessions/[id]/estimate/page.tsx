import { requireLearner } from "../../../../../server/auth/learner";
import { readAutomaticLearning } from "../../../../../server/automatic-learning";
import { getDatabase } from "../../../../../server/db";
import { workspaceActor, workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { AutomaticLearningView } from "../../../../../ui/workspace/AutomaticLearningView";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/estimate`),
    actor = workspaceActor(learner),
    db = getDatabase();
  const session = await workspaceSession(learner, id);
  const automatic = await readAutomaticLearning(db, actor, id);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Session progress" subtitle={session.displayTitle} />}
    >
      <AutomaticLearningView sessionId={id} initial={automatic} />
    </LearnerShell>
  );
}
