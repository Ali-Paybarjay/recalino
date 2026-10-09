import { listNotebookRevisions } from "@recalino/core/note";
import { requireLearner } from "../../../../../../server/auth/learner";
import { getDatabase } from "../../../../../../server/db";
import { workspaceActor, workspaceSession } from "../../../../../../server/workspace";
import { PageHeader } from "../../../../../../ui/shell/AppShell";
import { Actions, LinkButton, Panel } from "../../../../../../ui/workspace/primitives";
import { LearnerShell } from "../../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function NoteHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/notes/versions`);
  const session = await workspaceSession(learner, id);
  const revisions = await listNotebookRevisions(getDatabase(), workspaceActor(learner), id);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Note version history" subtitle={session.displayTitle} />}
    >
      <div className="preview-stack">
        <Actions>
          <LinkButton secondary href={`/sessions/${id}/notes`}>
            Current notes
          </LinkButton>
        </Actions>
        <Panel title="Earlier versions">
          {revisions.length ? (
            revisions.map((item) => (
              <article key={item.id} className="preview-list-item">
                <h3>Version {item.number}</h3>
                <p>
                  {new Date(item.createdAt).toLocaleString("en-GB")} · {item.model.title}
                </p>
                <LinkButton secondary href={`/notes/${item.id}`}>
                  Read version {item.number}
                </LinkButton>
              </article>
            ))
          ) : (
            <p>No published notes yet.</p>
          )}
        </Panel>
      </div>
    </LearnerShell>
  );
}
