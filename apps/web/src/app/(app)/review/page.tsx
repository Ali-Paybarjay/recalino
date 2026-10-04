import { requireLearner } from "../../../server/auth/learner";
import { StudyEmptyState } from "../../../ui/components/StudyOverview";
import { PageHeader } from "../../../ui/shell/AppShell";
import { strings } from "../../../ui/strings";
import { studyCopy } from "../../../ui/study-copy";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

/** F1 — Review, empty until cards exist (frame H-rules: "No cards yet"). */
export default async function ReviewPage() {
  const learner = await requireLearner("/review");
  return (
    <LearnerShell
      learner={learner}
      current="review"
      header={<PageHeader title={strings.nav.review} subtitle={studyCopy.review.subtitle} />}
    >
      <StudyEmptyState kind="review" />
    </LearnerShell>
  );
}
