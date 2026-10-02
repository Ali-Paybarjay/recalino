import { requireLearner } from "../../../server/auth/learner";
import { EmptyState } from "../../../ui/components/Feedback";
import { FolderSimple } from "../../../ui/icons";
import { PageHeader } from "../../../ui/shell/AppShell";
import { strings } from "../../../ui/strings";
import { LearnerShell } from "../LearnerShell";

export const dynamic = "force-dynamic";

/** B3 — Classes, empty until ORG (M4) adds courses, classes and "New class". */
export default async function ClassesPage() {
  const learner = await requireLearner("/classes");
  return (
    <LearnerShell
      learner={learner}
      current="classes"
      header={<PageHeader title={strings.nav.classes} />}
    >
      <EmptyState icon={FolderSimple} text={strings.empty.classes} />
    </LearnerShell>
  );
}
