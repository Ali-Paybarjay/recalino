import "../../../ui/preview/preview.css";
import { requireLearner } from "../../../server/auth/learner";
import { VoiceSetup } from "./VoiceSetup";

export const dynamic = "force-dynamic";

/** Offer voice enrollment after recording consent, when the existing voice API is available. */
export default async function VoiceSetupPage() {
  await requireLearner("/setup/voice");
  return <VoiceSetup />;
}
