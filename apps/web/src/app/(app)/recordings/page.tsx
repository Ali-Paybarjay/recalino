import { requireLearner } from "../../../server/auth/learner";
import { RecordingView } from "../../../ui/recording/RecordingView";
import { recoveryCopy } from "../../../ui/recovery-copy";
import { PageHeader } from "../../../ui/shell/AppShell";
import { LearnerTermsNotice } from "../LearnerShell";
import { RecordingShell } from "../RecordingShell";

export const dynamic = "force-dynamic";
/**
 * Where "Record a session" on Today lands: the recording itself. The navigation is hidden only
 * while capture is in progress (UX-02, owner decision 2026-10-19; RECORDING_FOCUS_MODE) and is
 * back before Start and after Stop. Once capture is over, "Back to Today" is also offered.
 */
export default async function RecordingsPage() {
  const learner = await requireLearner("/recordings");
  return (
    <RecordingShell
      header={<PageHeader title="Record a session" />}
      notice={<LearnerTermsNotice learner={learner} />}
    >
      <RecordingView backHref="/today" backLabel={recoveryCopy.today} />
    </RecordingShell>
  );
}
