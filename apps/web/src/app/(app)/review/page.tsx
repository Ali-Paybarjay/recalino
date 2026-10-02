import { requireLearner } from "../../../server/auth/learner";
import { EmptyState } from "../../../ui/components/Feedback";
import { Cards } from "../../../ui/icons";
import { PageHeader } from "../../../ui/shell/AppShell";
import { strings } from "../../../ui/strings";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

/** F1 — Review, empty until cards exist (frame H-rules: "No cards yet"). */
export default async function ReviewPage() {
  const learner = await requireLearner("/review");
  return (
    <LearnerShell
      learner={learner}
      current="review"
      header={<PageHeader title={strings.nav.review} />}
    >
      <EmptyState icon={Cards} text={strings.empty.review} />
    </LearnerShell>
  );
}
