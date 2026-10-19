import { requireLearner } from "../../../../../server/auth/learner";
import { calendarDate, workspaceGroups, workspaceSession } from "../../../../../server/workspace";
import { PageHeader } from "../../../../../ui/shell/AppShell";
import { ClassForm } from "../../../../../ui/workspace/ClassForm";
import { LearnerShell } from "../../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function ClassOptionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await requireLearner(`/sessions/${id}/options`);
  const initial = await workspaceSession(learner, id);
  const groups = await workspaceGroups(learner);
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Session options" subtitle="Rename, move or remove a session." />}
    >
      <ClassForm {...groups} today={calendarDate(learner.state.timezone)} initial={initial} />
    </LearnerShell>
  );
}
