import { requireLearner } from "../../../../../server/auth/learner";
import { workspaceSession } from "../../../../../server/workspace";
import { RecordingView } from "../../../../../ui/recording/RecordingView";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { FocusShell } from "../../../../../ui/shell/FocusShell";

export const dynamic = "force-dynamic";
/**
 * Recording is a focus mode with no navigation (UX-02, HANDOFF §4): the page does not use the app
 * shell, and the Terms banner waits for another page so that nothing but the recording speaks
 * (PRD-REC-02). RecordingView offers "Back to session" once capture is over.
 */
export default async function ClassRecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/record`);
  const session = await workspaceSession(learner, id);
  return (
    <FocusShell>
      <PageHeader title="Record a session" subtitle={session.displayTitle} />
      <RecordingView sessionId={id} backHref={`/sessions/${id}`} />
    </FocusShell>
  );
}
