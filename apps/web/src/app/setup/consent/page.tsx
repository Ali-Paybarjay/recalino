import { CURRENT_VERSIONS } from "@recalino/core/acc";
import { redirect } from "next/navigation";
import { requireLearner } from "../../../server/auth/learner";
import { ConsentAgain } from "./ConsentAgain";

export const dynamic = "force-dynamic";

/** D33 rule 3: asked again only when the recording consent has a new version. */
export default async function ConsentAgainPage() {
  const learner = await requireLearner("/setup/consent", { duringSetup: true });
  if (!learner.state.setupComplete) redirect("/setup");
  if (!learner.state.pending.recordingConsent) redirect("/today");
  return <ConsentAgain version={CURRENT_VERSIONS["recording-consent"]} />;
}
