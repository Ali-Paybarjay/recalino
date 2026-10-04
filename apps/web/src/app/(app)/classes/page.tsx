import { requireLearner } from "../../../server/auth/learner";
import { StudyEmptyState } from "../../../ui/components/StudyOverview";
import { PageHeader } from "../../../ui/shell/AppShell";
import { strings } from "../../../ui/strings";
import { studyCopy } from "../../../ui/study-copy";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

/** B3 — Classes, empty until ORG (M4) adds courses, classes and "New class". */
export default async function ClassesPage() {
  const learner = await requireLearner("/classes");
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title={strings.nav.classes} subtitle={studyCopy.classes.subtitle} />}
    >
      <StudyEmptyState kind="classes" />
    </LearnerShell>
  );
}
