import type { ReactNode } from "react";
import "../../ui/preview/preview.css";
import { getLearner } from "../../server/auth/learner";
import { RecordingProvider } from "../../ui/recording/RecordingProvider";

/** Share the completed redesign's layout primitives with the real workspace. */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  // Each page owns its redirect path and setup/consent checks before reading private data.
  const learner = await getLearner();
  if (!learner) return <div className="preview-root">{children}</div>;
  return (
    <RecordingProvider key={learner.userId} userId={learner.userId}>
      <div className="preview-root">{children}</div>
    </RecordingProvider>
  );
}
