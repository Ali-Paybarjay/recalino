import { defineRoute } from "../../../server/api";
import { signOutHandler } from "../../../server/auth/flow";
import { privacySessions } from "../../../server/auth/learner";
import { ROUTES } from "../../../server/routes";

export const dynamic = "force-dynamic";

// A learner whose account deletion is still being carried out has no live account, but must be
// able to end this browser's session (UX-10). `privacySessions` accepts exactly those two kinds.
export const POST = defineRoute(ROUTES.authSignOut, signOutHandler(), {
  sessions: privacySessions(),
});
