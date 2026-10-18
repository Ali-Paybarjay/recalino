import { requireLearner } from "../../../server/auth/learner";
import { RecordingView } from "../../../ui/recording/RecordingView";
import { recoveryCopy } from "../../../ui/recovery-copy";
import { PageHeader } from "../../../ui/shell/AppShell";
import { FocusShell } from "../../../ui/shell/FocusShell";

export const dynamic = "force-dynamic";
/**
 * Where "Record a session" on Today lands: the recording itself, in focus mode with no navigation
 * (UX-02, HANDOFF §4). Once capture is over, "Back to Today" is the way out.
 */
export default async function RecordingsPage() {
  await requireLearner("/recordings");
  return (
    <FocusShell>
      <PageHeader title="Record a session" />
      <RecordingView backHref="/today" backLabel={recoveryCopy.today} />
    </FocusShell>
  );
}
