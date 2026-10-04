import { requireLearner } from "../../../server/auth/learner";
import { RecordingView } from "../../../ui/recording/RecordingView";
import { PageHeader } from "../../../ui/shell/AppShell";
import { LearnerShell } from "../LearnerShell";
export const dynamic = "force-dynamic";
export default async function RecordingsPage() {
  const learner = await requireLearner("/recordings");
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title="Record a class" />}
    >
      <RecordingView />
    </LearnerShell>
  );
}
