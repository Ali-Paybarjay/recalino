import { getNotebookRevision, type NotebookRevision } from "@recalino/core/note";
import { AppError } from "@recalino/core/plt";
import { getNoteSourceStatus } from "@recalino/core/proc";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireLearner } from "../../../../server/auth/learner";
import { getDatabase } from "../../../../server/db";
import { workspaceActor } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { NoteView } from "../../../../ui/workspace/NoteView";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function NoteVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/notes/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  let revision: NotebookRevision;
  try {
    revision = await getNotebookRevision(getDatabase(), workspaceActor(learner), id);
  } catch (failure) {
    if (failure instanceof AppError && failure.code === "not_found") notFound();
    throw failure;
  }
  const status = await getNoteSourceStatus(
    getDatabase(),
    workspaceActor(learner),
    revision.sessionId,
    revision.knowledgeVersionId,
  );
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={
        <PageHeader
          title={`Note version ${revision.number}`}
          subtitle="A saved copy of your earlier notes."
        />
      }
    >
      <NoteView
        sessionId={revision.sessionId}
        userId={learner.userId}
        initial={null}
        latest={null}
        readOnlyRevision={revision}
        sourceIssues={status.issues.map((issue) => ({
          ...issue,
          action: "none",
          recovery: undefined,
        }))}
      />
    </LearnerShell>
  );
}
