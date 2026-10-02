import "server-only";
import { type AccountState, accountExists, getAccountState } from "@recalino/core/acc";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDatabase } from "../db";
import type { SessionProvider } from "../session";
import { type AuthGateway, supabaseAuth } from "./gateway";

export interface Learner {
  userId: string;
  state: AccountState;
}

/**
 * The signed-in learner with a Recalino account, or null. An Auth user without an account (no
 * sign-in declarations, FR-ACC-001) is not a learner. Cached for one server render.
 */
export const getLearner = cache(async (): Promise<Learner | null> => {
  const user = await supabaseAuth.currentUser();
  if (user === null) return null;
  const state = await getAccountState(getDatabase(), user.id);
  return state === null ? null : { userId: user.id, state };
});

/**
 * FR-PLT-001 for pages: without a session, go to the sign-in page and come back afterwards.
 * Unfinished setup goes to setup (FR-ACC-003); a new recording-consent version is asked first
 * (D33 rule 3).
 */
export async function requireLearner(
  path: string,
  options: { duringSetup?: boolean } = {},
): Promise<Learner> {
  const learner = await getLearner();
  if (learner === null) redirect(`/?next=${encodeURIComponent(path)}`);
  if (!options.duringSetup) {
    if (!learner.state.setupComplete) redirect("/setup");
    if (learner.state.pending.recordingConsent) redirect("/setup/consent");
  }
  return learner;
}

/** FR-PLT-001 for API routes: the session must belong to a Recalino account. */
export function authSessions(auth: AuthGateway = supabaseAuth): SessionProvider {
  return {
    async getSession() {
      const user = await auth.currentUser();
      if (user === null) return null;
      return (await accountExists(getDatabase(), user.id)) ? { userId: user.id } : null;
    },
  };
}
