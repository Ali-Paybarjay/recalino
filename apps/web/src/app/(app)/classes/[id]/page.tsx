import Link from "next/link";
import { requireLearner } from "../../../../server/auth/learner";
import { workspaceGroups, workspaceSession } from "../../../../server/workspace";
import { RecordLauncher } from "../../../../ui/recording/RecordingProvider";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { Actions, LinkButton, Panel } from "../../../../ui/workspace/primitives";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/classes/${id}`);
  const session = await workspaceSession(learner, id);
  const groups = await workspaceGroups(learner);
  const course = groups.courses.find((item) => item.id === session.courseId);
  const unit = groups.units.find((item) => item.id === session.unitId);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={
        <PageHeader
          title={session.displayTitle}
          subtitle={`${course?.name ?? ""}${unit ? ` · ${unit.name}` : ""} · ${session.classDate}`}
        />
      }
    >
      <div className="preview-stack">
        <Link href="/classes" className="preview-back">
          ← Back to classes
        </Link>
        <Actions>
          <RecordLauncher sessionId={id} />
          <LinkButton href={`/classes/${id}/sources`}>Add sources</LinkButton>
          <LinkButton secondary href={`/classes/${id}/options`}>
            Class options
          </LinkButton>
        </Actions>
        <div className="preview-grid">
          <Panel title="Class material">
            <p>Keep this class’s recording, handouts and photos together.</p>
            <LinkButton secondary href={`/classes/${id}/sources`}>
              View sources
            </LinkButton>
          </Panel>
          <Panel title="Your learning">
            <p>Make class notes, choose useful cards, and practise at your own pace.</p>
            <Actions>
              <LinkButton href={`/classes/${id}/notes`}>Class notes</LinkButton>
              <LinkButton secondary href={`/classes/${id}/cards`}>
                Flashcards
              </LinkButton>
              <LinkButton secondary href={`/classes/${id}/estimate`}>
                Process class material
              </LinkButton>
              <LinkButton secondary href={`/classes/${id}/export`}>
                Download notes and cards
              </LinkButton>
            </Actions>
          </Panel>
        </div>
      </div>
    </LearnerShell>
  );
}
