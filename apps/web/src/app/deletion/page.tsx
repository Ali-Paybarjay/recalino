import { redirect } from "next/navigation";
import { getPendingAccountDeletion } from "../../server/auth/learner";
import { RecordingProvider } from "../../ui/recording/RecordingProvider";
import { PrivacyView } from "../../ui/workspace/PrivacyView";
import "../../ui/preview/preview.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Finish account deletion · Recalino",
  robots: { index: false, follow: false },
};

/** This page restores only an owned deletion action; normal learner pages stay unavailable. */
export default async function DeletionRecoveryPage() {
  const pending = await getPendingAccountDeletion();
  if (!pending) redirect("/");
  const email = process.env.PILOT_OPERATOR_EMAIL;
  const operatorMailto =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? `mailto:${encodeURIComponent(email)}`
      : null;
  return (
    <main
      className="preview-root"
      style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}
    >
      <h1>Account deletion</h1>
      <RecordingProvider userId={pending.userId}>
        <PrivacyView
          initialPending={{
            requestId: pending.requestId,
            kind: "account",
            state: "acknowledgement_pending",
          }}
          recoveryStage={pending.stage}
          operatorMailto={operatorMailto}
        />
      </RecordingProvider>
    </main>
  );
}
