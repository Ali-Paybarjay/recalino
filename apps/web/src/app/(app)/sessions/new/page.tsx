import { requireLearner } from "../../../../server/auth/learner";
import { calendarDate, workspaceGroups } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { ClassForm } from "../../../../ui/workspace/ClassForm";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function NewClassPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const learner = await requireLearner("/sessions/new");
  const groups = await workspaceGroups(learner);
  const requested = (await searchParams).courseId;
  const courseId = groups.courses.some((item) => item.id === requested) ? requested : undefined;
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={
        <PageHeader
          title="New session"
          subtitle="Choose a course and date. The title will come from your learning material."
        />
      }
    >
      <ClassForm {...groups} today={calendarDate(learner.state.timezone)} courseId={courseId} />
    </LearnerShell>
  );
}
