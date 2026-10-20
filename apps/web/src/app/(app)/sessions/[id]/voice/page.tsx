import Link from "next/link";
import { requireLearner } from "../../../../../server/auth/learner";
import { workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { VoiceConfirmation } from "../../../../../ui/voice/VoiceConfirmation";
import { Actions, LinkButton } from "../../../../../ui/workspace/primitives";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
/** The optional voice step (FIVE_PROBLEMS §7.3 item 4): its own page, no longer above the notes. */
export default async function SessionVoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/voice`);
  const session = await workspaceSession(learner, id);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Your voice in this session" subtitle={session.displayTitle} />}
    >
      <div className="workspace-stack">
        <Link className="workspace-back" href={`/sessions/${id}`}>
          ← Back to session
        </Link>
        <VoiceConfirmation sessionId={id} userId={learner.userId} />
        <Actions>
          <LinkButton secondary href={`/sessions/${id}/notes`}>
            Read session notes
          </LinkButton>
        </Actions>
      </div>
    </LearnerShell>
  );
}
