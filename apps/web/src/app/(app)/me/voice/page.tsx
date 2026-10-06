import { requireLearner } from "../../../../server/auth/learner";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { VoiceProfile } from "../../../../ui/voice/VoiceProfile";
import { LearnerShell } from "../../LearnerShell";

export const dynamic = "force-dynamic";
export default async function VoiceSettingsPage() {
  const learner = await requireLearner("/me/voice");
  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={
        <PageHeader title="Your voice" subtitle="Choose how your speech is identified in class." />
      }
    >
      <VoiceProfile />
    </LearnerShell>
  );
}
