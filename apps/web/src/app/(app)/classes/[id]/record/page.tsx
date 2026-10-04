import { getSession } from "@recalino/core/org";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { workspaceActor } from "../../../../../server/workspace";
import { RecordingView } from "../../../../../ui/recording/RecordingView";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function ClassRecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/classes/${id}/record`);
  const session = await getSession(getDatabase(), workspaceActor(learner), id);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title={session.title ?? "Class recording"} subtitle="Record a class" />}
    >
      <RecordingView sessionId={id} />
    </LearnerShell>
  );
}
