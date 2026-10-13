import { getLatestVersion } from "@recalino/core/lkm";
import { getNotebook } from "@recalino/core/note";
import { getNoteSourceStatus } from "@recalino/core/proc";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { lessonAdaptationFor } from "../../../../../server/teaching-memory";
import { workspaceActor, workspaceCourse, workspaceSession } from "../../../../../server/workspace";
import { NoteView } from "../../../../../ui/workspace/NoteView";
import { SessionNotesReader } from "../../../../../ui/workspace/SessionNotesReader";
import { LearnerTermsNotice } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/notes`);
  const session = await workspaceSession(learner, id);
  const db = getDatabase(),
    ctx = workspaceActor(learner);
  const [initial, latest, course] = await Promise.all([
    getNotebook(db, ctx, id),
    getLatestVersion(db, ctx, id),
    workspaceCourse(learner, session.courseId),
  ]);
  const sourceStatus = await getNoteSourceStatus(
    db,
    ctx,
    id,
    initial?.current.knowledgeVersionId ?? latest?.id,
  );
  // D49: server-written explanation of what the shown lesson version was prepared with.
  const adaptation = await lessonAdaptationFor(
    db,
    ctx,
    initial ? initial.current.knowledgeVersionId : latest,
    (initial?.current.model ?? latest?.model)?.learningItems ?? [],
  );
  return (
    <SessionNotesReader
      sessionId={id}
      title={(initial?.current.model ?? latest?.model)?.title ?? session.displayTitle}
      courseName={course.name}
      classDate={session.classDate}
      topics={session.topics}
      hasNotes={!!(initial || latest)}
      canOpenCards={!!initial}
      revisionNumber={initial?.current.number}
    >
      <LearnerTermsNotice learner={learner} />
      {/* Voice confirmation is an optional step on the session page (/sessions/[id]/voice). */}
      <NoteView
        standalone
        sessionId={id}
        userId={learner.userId}
        initial={initial}
        latest={latest}
        courseId={session.courseId}
        sourceIssues={sourceStatus.issues}
        materialSources={sourceStatus.materials}
        adaptation={adaptation}
      />
    </SessionNotesReader>
  );
}
