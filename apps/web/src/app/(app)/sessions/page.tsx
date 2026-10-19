import { listLearningSessions } from "@recalino/core/note";
import { requireLearner } from "../../../server/auth/learner";
import { classDirectoryRevision } from "../../../server/class-directory";
import { getDatabase } from "../../../server/db";
import { workspaceActor, workspaceCourse, workspaceGroups } from "../../../server/workspace";
import { PageHeader } from "../../../ui/shell/AppShell";
import { ClassDirectory } from "../../../ui/workspace/ClassDirectory";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string; unitId?: string; scope?: string }>;
}) {
  const learner = await requireLearner("/sessions");
  const [query, groups] = await Promise.all([searchParams, workspaceGroups(learner)]);
  const allCourses = query.scope === "all";
  const course = query.courseId
    ? await workspaceCourse(learner, query.courseId)
    : !allCourses && groups.courses.length === 1
      ? groups.courses[0]
      : null;
  const unitId = groups.units.some(
    (unit) => unit.courseId === course?.id && unit.id === query.unitId,
  )
    ? query.unitId
    : undefined;
  const sessions =
    course || allCourses
      ? await listLearningSessions(getDatabase(), workspaceActor(learner), {
          courseId: course?.id,
          unitId,
          order: "newest",
          limit: 20,
        })
      : { items: [], total: 0 };

  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Sessions" subtitle="Choose a course, then open a session." />}
    >
      <ClassDirectory
        key={`${course?.id ?? (allCourses ? "all" : "choose")}:${unitId ?? "all"}:${classDirectoryRevision(sessions)}`}
        {...groups}
        selectedCourseId={course?.id ?? null}
        allCourses={allCourses && !course}
        unitId={unitId}
        initialSessions={sessions}
      />
    </LearnerShell>
  );
}
