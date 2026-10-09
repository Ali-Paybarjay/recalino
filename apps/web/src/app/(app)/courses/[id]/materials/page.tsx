import { listCourseMaterials } from "@recalino/core/note";
import { listCourses } from "@recalino/core/org";
import Link from "next/link";
import { requireLearner } from "../../../../../server/auth/learner";
import { getDatabase } from "../../../../../server/db";
import { workspaceActor, workspaceCourse } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { CourseNavigation } from "../../../../../ui/workspace/CourseNavigation";
import { NoteView } from "../../../../../ui/workspace/NoteView";
import { Actions, LinkButton, Panel } from "../../../../../ui/workspace/primitives";
import { SessionLearningSummary } from "../../../../../ui/workspace/SessionLearningSummary";
import { LearnerShell } from "../../../LearnerShell";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;

export default async function CourseMaterialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const learner = await requireLearner(`/courses/${id}/materials`);
  const course = await workspaceCourse(learner, id);
  const db = getDatabase(),
    ctx = workspaceActor(learner);
  const [courses, query] = await Promise.all([listCourses(db, ctx), searchParams]);
  const page = /^\d{1,6}$/.test(query.page ?? "") ? Math.max(1, Number(query.page)) : 1;
  const materials = await listCourseMaterials(db, ctx, id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pageHref = (number: number) => `/courses/${id}/materials?page=${number}`;

  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Course materials" subtitle={course.name} />}
    >
      <div className="preview-stack">
        <Link className="preview-back" href="/courses">
          ← Back to courses
        </Link>
        <CourseNavigation course={course} courses={courses} current="materials" />
        <Panel title="Learn through this course">
          <p>
            Read your published session notes in date order. Each lesson keeps its own notes,
            flashcards and sources.
          </p>
          {materials.items.length ? (
            <nav className="preview-actions" aria-label="Jump to a session">
              {materials.items.map(({ session }) => (
                <a key={session.id} className="preview-index-link" href={`#class-${session.id}`}>
                  <span>
                    <time dateTime={session.classDate}>{session.classDate}</time>
                    {session.titleSource !== "date" ? (
                      <>
                        {" "}
                        · <bdi>{session.displayTitle}</bdi>
                      </>
                    ) : null}
                  </span>
                </a>
              ))}
            </nav>
          ) : null}
          <Actions>
            <LinkButton secondary href={`/sessions/new?courseId=${id}`}>
              New session in this course
            </LinkButton>
          </Actions>
        </Panel>
        {materials.items.map(({ session, notebook }) => (
          <section
            key={session.id}
            id={`class-${session.id}`}
            aria-labelledby={`title-${session.id}`}
            className="preview-stack"
          >
            <Panel>
              <h2 id={`title-${session.id}`} dir="auto">
                {session.displayTitle}
              </h2>
              <SessionLearningSummary session={session} />
              <Actions>
                <LinkButton secondary href={`/sessions/${session.id}`}>
                  Open session
                </LinkButton>
                <LinkButton secondary href={`/sessions/${session.id}/notes`}>
                  Session notes
                </LinkButton>
                <LinkButton secondary href={`/sessions/${session.id}/cards`}>
                  Flashcards
                </LinkButton>
                <LinkButton secondary href={`/sessions/${session.id}/sources`}>
                  Session sources
                </LinkButton>
              </Actions>
            </Panel>
            {notebook ? (
              <NoteView
                sessionId={session.id}
                userId={learner.userId}
                initial={null}
                latest={null}
                readOnlyRevision={notebook.current}
                embedded
              />
            ) : (
              <Panel>
                <p>
                  No notes for this session yet. Add session material; its notes will appear
                  automatically.
                </p>
              </Panel>
            )}
          </section>
        ))}
        {!materials.items.length ? (
          <Panel title={materials.total ? "No sessions on this page" : "Your course starts here"}>
            <p>
              {materials.total
                ? "Choose an earlier page to keep reading."
                : "Create a dated session and add its material. Its notes will appear here automatically in course order."}
            </p>
            <LinkButton
              secondary
              href={materials.total ? pageHref(1) : `/sessions/new?courseId=${id}`}
            >
              {materials.total ? "First page" : "Create a session in this course"}
            </LinkButton>
          </Panel>
        ) : null}
        {materials.total > PAGE_SIZE ? (
          <Panel>
            <nav className="preview-actions" aria-label="Course material pages">
              {page > 1 ? (
                <LinkButton secondary href={pageHref(page - 1)}>
                  Previous sessions
                </LinkButton>
              ) : null}
              <p className="preview-muted">
                Page {page} · {materials.total} sessions · Oldest first
              </p>
              {page * PAGE_SIZE < materials.total ? (
                <LinkButton secondary href={pageHref(page + 1)}>
                  Next sessions
                </LinkButton>
              ) : null}
            </nav>
          </Panel>
        ) : null}
      </div>
    </LearnerShell>
  );
}
