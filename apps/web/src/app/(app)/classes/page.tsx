import { listLearningSessions } from "@recalino/core/note";
import Link from "next/link";
import { requireLearner } from "../../../server/auth/learner";
import { getDatabase } from "../../../server/db";
import { workspaceActor, workspaceCourse, workspaceGroups } from "../../../server/workspace";
import { courseCopy } from "../../../ui/course-copy";
import { PageHeader } from "../../../ui/shell/AppShell";
import { ClassRows } from "../../../ui/workspace/ClassRows";
import { Actions, LinkButton, Panel } from "../../../ui/workspace/primitives";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; courseId?: string }>;
}) {
  const learner = await requireLearner("/classes");
  const query = await searchParams;
  const page = /^\d{1,6}$/.test(query.page ?? "") ? Math.max(1, Number(query.page)) : 1;
  const course = query.courseId ? await workspaceCourse(learner, query.courseId) : null;
  const [groups, sessions] = await Promise.all([
    workspaceGroups(learner),
    listLearningSessions(getDatabase(), workspaceActor(learner), {
      courseId: course?.id,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);
  const pageHref = (number: number) =>
    `/classes?${new URLSearchParams({ page: String(number), ...(course ? { courseId: course.id } : {}) })}`;
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={
        <PageHeader
          title={course ? course.name : "Your classes"}
          subtitle="Keep each lesson and its useful material together."
        />
      }
    >
      <div className="preview-stack">
        <Actions>
          <LinkButton href={course ? `/classes/new?courseId=${course.id}` : "/classes/new"}>
            New class
          </LinkButton>
          <LinkButton secondary href="/classes/organize">
            Manage courses and units
          </LinkButton>
          <LinkButton secondary href="/courses">
            Courses
          </LinkButton>
        </Actions>
        {groups.courses.length ? (
          <Panel title="Your courses">
            <p className="preview-muted">{courseCopy.courseHelp}</p>
            <nav aria-label="Filter classes by course" className="preview-actions">
              <Link
                href="/classes"
                className="preview-index-link"
                aria-current={!course ? "page" : undefined}
              >
                All classes
              </Link>
              {groups.courses.map((item) => (
                <Link
                  href={`/courses/${item.id}`}
                  className="preview-index-link"
                  key={item.id}
                  dir="auto"
                  aria-current={course?.id === item.id ? "page" : undefined}
                >
                  {item.name}
                  {item.isDefault ? " · Default" : ""}
                </Link>
              ))}
            </nav>
          </Panel>
        ) : null}
        <Panel title={course ? "Classes in this course" : "All classes"}>
          {sessions.items.length ? (
            <p className="preview-muted">
              Newest class first · Titles and topics come from your lesson material.
            </p>
          ) : null}
          {sessions.items.length ? (
            <ClassRows sessions={sessions.items} {...groups} />
          ) : (
            <div className="preview-empty">
              <h3>
                {sessions.total ? "No classes on this page" : "Your first class starts here."}
              </h3>
              <p>Create a class, then add a recording, handout, photo or notes.</p>
              <LinkButton href={course ? `/classes/new?courseId=${course.id}` : "/classes/new"}>
                Create a class
              </LinkButton>
            </div>
          )}
          {sessions.total > PAGE_SIZE ? (
            <nav className="preview-actions" aria-label="Class pages">
              {page > 1 ? (
                <LinkButton secondary href={pageHref(page - 1)}>
                  Previous page
                </LinkButton>
              ) : null}
              <p className="preview-muted">
                Page {page} · {sessions.total} classes
              </p>
              {page * PAGE_SIZE < sessions.total ? (
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
