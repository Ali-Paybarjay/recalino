import { getReviewSettings } from "@recalino/core/srs";
import { requireLearner } from "../../../../server/auth/learner";
import { getDatabase } from "../../../../server/db";
import { workspaceActor } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { ReviewSettings } from "../../../../ui/workspace/ReviewSettings";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function ReviewSettingsPage() {
  const learner = await requireLearner("/me/review-settings");
  const initial = await getReviewSettings(getDatabase(), workspaceActor(learner));
  return (
    <LearnerShell learner={learner} current="me" header={<PageHeader title="Review settings" />}>
      <ReviewSettings initial={initial} />
    </LearnerShell>
  );
}
