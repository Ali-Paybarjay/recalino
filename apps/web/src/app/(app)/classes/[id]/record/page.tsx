import { requireLearner } from "../../../../../server/auth/learner";
import { workspaceSession } from "../../../../../server/workspace";
import { RecordingView } from "../../../../../ui/recording/RecordingView";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function ClassRecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/classes/${id}/record`);
  const session = await workspaceSession(learner, id);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Record a session" subtitle={session.displayTitle} />}
    >
      <RecordingView sessionId={id} />
    </LearnerShell>
  );
}
