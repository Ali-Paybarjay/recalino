import { requireLearner } from "../../../../server/auth/learner";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { PrivacyView } from "../../../../ui/workspace/PrivacyView";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function DataPage() {
  const learner = await requireLearner("/me/data");
  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={<PageHeader title="Your data" subtitle="Choose exactly what you want to remove." />}
    >
      <PrivacyView />
    </LearnerShell>
  );
}
