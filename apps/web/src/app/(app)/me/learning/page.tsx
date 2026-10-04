import { learningOverview } from "@recalino/core/pers";
import { requireLearner } from "../../../../server/auth/learner";
import { getDatabase } from "../../../../server/db";
import { workspaceActor } from "../../../../server/workspace";
import { PageHeader } from "../../../../ui/shell/AppShell";
import { LearningProfile } from "../../../../ui/workspace/LearningProfile";
import { LearnerShell } from "../../LearnerShell";
export const dynamic = "force-dynamic";
export default async function LearningPage() {
  const learner = await requireLearner("/me/learning");
  const initial = await learningOverview(getDatabase(), workspaceActor(learner));
  return (
    <LearnerShell
      learner={learner}
      current="me"
      header={
        <PageHeader
          title="Your learning profile"
          subtitle="Your choices and practice, with room to grow."
        />
      }
    >
      <LearningProfile initial={initial} />
    </LearnerShell>
  );
}
