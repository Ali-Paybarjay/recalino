import Link from "next/link";
import { requireLearner } from "../../../../server/auth/learner";
import { workspaceGroups, workspaceSession } from "../../../../server/workspace";
import { RecordLauncher } from "../../../../ui/recording/RecordingProvider";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { AutomaticLearningNotice } from "../../../../ui/workspace/AutomaticLearningView";
import { Actions, LinkButton, Panel } from "../../../../ui/workspace/primitives";
import { SessionLearningSummary } from "../../../../ui/workspace/SessionLearningSummary";
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
        <Link href={`/courses/${session.courseId}`} className="preview-back">
          ← Back to <bdi>{course?.name ?? "course"}</bdi>
        </Link>
        <Actions>
          <RecordLauncher sessionId={id} />
          <LinkButton href={`/classes/${id}/sources`}>Add material</LinkButton>
          <LinkButton secondary href={`/classes/${id}/options`}>
            Class options
          </LinkButton>
          <LinkButton secondary href={`/courses/${session.courseId}/materials`}>
            Course materials
          </LinkButton>
        </Actions>
        <AutomaticLearningNotice sessionId={id} />
        <section id="topics" aria-label="Topics covered">
          <Panel title="Topics covered">
            <SessionLearningSummary session={session} showTopics={false} />
            {session.topics.length ? (
              <>
                <ul>
                  {session.topics.map((topic) => (
                    <li key={topic} dir="auto">
                      {topic}
                    </li>
                  ))}
                </ul>
                <LinkButton secondary href={`/classes/${id}/notes`}>
                  Read this lesson
                </LinkButton>
              </>
            ) : (
              <p>
                {session.titleSource === "date"
                  ? "Add class material. The lesson title, notes and flashcards will appear automatically."
                  : "Open class notes to explore this lesson. Topics will appear here when included in the learning material."}
              </p>
            )}
          </Panel>
        </section>
        <div className="preview-grid">
          <Panel title="Class material">
            <p>Keep this class’s recording, handouts and photos together.</p>
            <LinkButton secondary href={`/classes/${id}/sources`}>
              View sources
            </LinkButton>
          </Panel>
          <Panel title="Your learning">
            <p>
              Your uploaded material becomes notes and flashcards automatically. Practise at your
              own pace.
            </p>
            <Actions>
              <LinkButton href={`/classes/${id}/notes`}>Class notes</LinkButton>
              <LinkButton secondary href={`/classes/${id}/cards`}>
                Flashcards
              </LinkButton>
              <LinkButton secondary href={`/classes/${id}/estimate`}>
                View progress
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
