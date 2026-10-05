import { listLearningSessions } from "@recalino/core/note";
import Link from "next/link";
import { requireLearner } from "../../../../server/auth/learner";
import { getDatabase } from "../../../../server/db";
import { workspaceActor, workspaceCourse, workspaceGroups } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { ClassRows } from "../../../../ui/workspace/ClassRows";
import { CourseNavigation } from "../../../../ui/workspace/CourseNavigation";
import { Actions, LinkButton, Panel } from "../../../../ui/workspace/primitives";
import { LearnerShell } from "../../LearnerShell";

export const dynamic = "force-dynamic";
export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; unitId?: string }>;
}) {
  const { id } = await params;
  const learner = await requireLearner(`/courses/${id}`);
  const course = await workspaceCourse(learner, id);
  const groups = await workspaceGroups(learner);
  const query = await searchParams;
  const unitId = groups.units.some((item) => item.courseId === id && item.id === query.unitId)
    ? query.unitId
    : undefined;
  const page = /^\d{1,6}$/.test(query.page ?? "") ? Math.max(1, Number(query.page)) : 1;
  const sessions = await listLearningSessions(getDatabase(), workspaceActor(learner), {
    courseId: id,
    unitId,
    limit: 20,
    offset: (page - 1) * 20,
  });
  const pageHref = (number: number) =>
    `/courses/${id}?${new URLSearchParams({ page: String(number), ...(unitId ? { unitId } : {}) })}`;
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={
        <PageHeader
          title={course.name}
          subtitle="Dated classes and learning material for this course."
        />
      }
    >
      <div className="preview-stack">
        <Link href="/courses" className="preview-back">
          ← Back to courses
        </Link>
        <CourseNavigation course={course} courses={groups.courses} current="classes" />
        <Actions>
          <LinkButton href={`/classes/new?courseId=${id}`}>New class</LinkButton>
          <LinkButton secondary href={`/courses/${id}/materials`}>
            Read course materials
          </LinkButton>
          <LinkButton secondary href={`/classes/organize?courseId=${id}`}>
            Manage this course
          </LinkButton>
        </Actions>
        {groups.units.some((item) => item.courseId === id) ? (
          <Panel title="Units">
            <nav className="preview-actions" aria-label="Filter classes by unit">
              <Link
                href={`/courses/${id}`}
                className="preview-index-link"
                aria-current={!unitId ? "page" : undefined}
              >
                All units
              </Link>
              {groups.units
                .filter((item) => item.courseId === id)
                .map((item) => (
                  <Link
                    className="preview-index-link"
                    key={item.id}
                    href={`/courses/${id}?unitId=${item.id}`}
                    aria-current={unitId === item.id ? "page" : undefined}
                    dir="auto"
                  >
                    {item.name}
                  </Link>
                ))}
            </nav>
          </Panel>
        ) : null}
        <Panel title="Your classes">
          {sessions.items.length ? (
            <p className="preview-muted">
              Newest class first · Follow the dates and topics of your lessons.
            </p>
          ) : null}
          {sessions.items.length ? (
            <ClassRows {...groups} sessions={sessions.items} />
          ) : (
            <div className="preview-empty">
              <p>No classes here yet.</p>
              <LinkButton href={`/classes/new?courseId=${id}`}>
                Create a class in this course
              </LinkButton>
            </div>
          )}
          {sessions.total > 20 ? (
            <nav className="preview-actions" aria-label="Class pages">
              {page > 1 ? (
                <LinkButton secondary href={pageHref(page - 1)}>
                  Previous page
                </LinkButton>
              ) : null}
              <p className="preview-muted">
                Page {page} · {sessions.total} classes
              </p>
              {page * 20 < sessions.total ? (
                <LinkButton secondary href={pageHref(page + 1)}>
                  Next page
                </LinkButton>
              ) : null}
            </nav>
          ) : null}
        </Panel>
      </div>
    </LearnerShell>
  );
}
