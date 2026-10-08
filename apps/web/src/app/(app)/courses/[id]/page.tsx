import { listLearningSessions } from "@recalino/core/note";
import { requireLearner } from "../../../../server/auth/learner";
import { classDirectoryRevision } from "../../../../server/class-directory";
import { getDatabase } from "../../../../server/db";
import { workspaceActor, workspaceCourse, workspaceGroups } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { ClassDirectory } from "../../../../ui/workspace/ClassDirectory";
import { LearnerShell } from "../../LearnerShell";

export const dynamic = "force-dynamic";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ unitId?: string }>;
}) {
  const { id } = await params;
  const learner = await requireLearner(`/courses/${id}`);
  const [course, groups, query] = await Promise.all([
    workspaceCourse(learner, id),
    workspaceGroups(learner),
    searchParams,
  ]);
  const unitId = groups.units.some((unit) => unit.courseId === id && unit.id === query.unitId)
    ? query.unitId
    : undefined;
  const sessions = await listLearningSessions(getDatabase(), workspaceActor(learner), {
    courseId: id,
    unitId,
    order: "newest",
    limit: 20,
  });

  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={
        <PageHeader title={course.name} subtitle="Open a class to find its notes and flashcards." />
      }
    >
      <ClassDirectory
        key={`${id}:${unitId ?? "all"}:${classDirectoryRevision(sessions)}`}
        {...groups}
        selectedCourseId={id}
        unitId={unitId}
        initialSessions={sessions}
      />
    </LearnerShell>
  );
}
