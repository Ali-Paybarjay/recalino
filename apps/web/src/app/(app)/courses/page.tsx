import Link from "next/link";
import { requireLearner } from "../../../server/auth/learner";
import { workspaceGroups } from "../../../server/workspace";
import { courseCopy } from "../../../ui/course-copy";
import { PageHeader } from "../../../ui/shell/AppShell";
import { CourseManager } from "../../../ui/workspace/CourseManager";
import { Actions, LinkButton, Panel } from "../../../ui/workspace/primitives";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const learner = await requireLearner("/courses");
  const [groups, query] = await Promise.all([workspaceGroups(learner), searchParams]);
  const courseId = groups.courses.some((item) => item.id === query.courseId)
    ? query.courseId
    : undefined;
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Manage courses" subtitle={courseCopy.courseHelp} />}
    >
      <div className="preview-stack">
        <Link className="preview-back" href="/sessions">
          ← Back to sessions
        </Link>
        <Panel title="Your courses">
          <p className="preview-muted">{courseCopy.goalHelp}</p>
          {groups.courses.length ? (
            <ul className="preview-list">
              {groups.courses.map((course) => (
                <li key={course.id}>
                  <h3 dir="auto">{course.name}</h3>
                  {course.isDefault ? <p className="preview-muted">Default course</p> : null}
                  <Actions>
                    <LinkButton secondary href={`/courses/${course.id}`}>
                      View sessions
                    </LinkButton>
                    <LinkButton secondary href={`/courses/${course.id}/materials`}>
                      Course materials
                    </LinkButton>
                  </Actions>
                </li>
              ))}
            </ul>
          ) : (
            <p>Create your first course below, then add sessions by date.</p>
          )}
        </Panel>
        <CourseManager {...groups} courseId={courseId} />
      </div>
    </LearnerShell>
  );
}
