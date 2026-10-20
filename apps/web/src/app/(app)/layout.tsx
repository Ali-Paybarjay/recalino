import type { ReactNode } from "react";
import "../../ui/workspace/workspace.css";
import { getLearner } from "../../server/auth/learner";
import { captureFlags } from "../../server/capture-flags";
import { NotificationCenter } from "../../ui/notifications/NotificationCenter";
import { RecordingProvider } from "../../ui/recording/RecordingProvider";
import { AutomaticLearningProvider } from "../../ui/workspace/AutomaticLearningProvider";
import { AccountGateProvider } from "../../ui/workspace/account-gate";
import { UploadProvider } from "../../ui/workspace/UploadProvider";

/** Share the completed redesign's layout primitives with the real workspace. */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  // Each page owns its redirect path and setup/consent checks before reading private data.
  const learner = await getLearner();
  if (!learner) return <div className="workspace-root">{children}</div>;
  return (
    <RecordingProvider
      key={learner.userId}
      userId={learner.userId}
      captureEarlyUpload={captureFlags().earlyUpload}
    >
      <AutomaticLearningProvider>
        <UploadProvider>
          <AccountGateProvider
            value={{
              setupComplete: learner.state.setupComplete,
              termsPending: learner.state.pending.terms,
            }}
          >
            <div className="workspace-root">
              <NotificationCenter userId={learner.userId} />
              {children}
            </div>
          </AccountGateProvider>
        </UploadProvider>
      </AutomaticLearningProvider>
    </RecordingProvider>
  );
}
