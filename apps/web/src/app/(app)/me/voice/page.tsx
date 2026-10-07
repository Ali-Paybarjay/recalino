import { requireLearner } from "../../../../server/auth/learner";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { voiceSettingsReturnHref } from "../../../../ui/voice/navigation";
import { VoiceProfile } from "../../../../ui/voice/VoiceProfile";
import { LearnerShell } from "../../LearnerShell";

export const dynamic = "force-dynamic";
export default async function VoiceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnHref = voiceSettingsReturnHref((await searchParams).returnTo);
  const path =
    returnHref === "/me" ? "/me/voice" : `/me/voice?returnTo=${encodeURIComponent(returnHref)}`;
  const learner = await requireLearner(path);
  return (
    <LearnerShell
      learner={learner}
      current={returnHref === "/me" ? "me" : "classes"}
      header={
        <PageHeader title="Your voice" subtitle="Choose how your speech is identified in class." />
      }
    >
      <VoiceProfile returnHref={returnHref} />
    </LearnerShell>
  );
}
