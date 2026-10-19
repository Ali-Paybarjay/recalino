import { requireLearner } from "../../../../../server/auth/learner";
import { workspaceSession } from "../../../../../server/workspace";
import { RecordingView } from "../../../../../ui/recording/RecordingView";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { LearnerTermsNotice } from "../../../LearnerShell";
import { RecordingShell } from "../../../RecordingShell";

export const dynamic = "force-dynamic";
/**
 * The session's recording page. The navigation is hidden only while capture is in progress
 * (UX-02, owner decision 2026-10-19; RECORDING_FOCUS_MODE) and is back before Start and after
 * Stop; the Terms notice waits as well, so that nothing but the recording speaks (PRD-REC-02).
 * RecordingView offers "Back to session" once capture is over.
 */
export default async function ClassRecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/record`);
  const session = await workspaceSession(learner, id);
  return (
    <RecordingShell
      header={<PageHeader title="Record a session" subtitle={session.displayTitle} />}
      notice={<LearnerTermsNotice learner={learner} />}
    >
      <RecordingView sessionId={id} backHref={`/sessions/${id}`} />
    </RecordingShell>
  );
}
