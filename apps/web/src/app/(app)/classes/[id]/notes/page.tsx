import { getLatestVersion } from "@recalino/core/lkm";
import { getNotebook } from "@recalino/core/note";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { workspaceActor, workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { NoteView } from "../../../../../ui/workspace/NoteView";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/classes/${id}/notes`);
  const session = await workspaceSession(learner, id);
  const db = getDatabase(),
    ctx = workspaceActor(learner);
  const [initial, latest] = await Promise.all([
    getNotebook(db, ctx, id),
    getLatestVersion(db, ctx, id),
  ]);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Class notes" subtitle={session.displayTitle} />}
    >
      <NoteView sessionId={id} userId={learner.userId} initial={initial} latest={latest} />
    </LearnerShell>
  );
}
