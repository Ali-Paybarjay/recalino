import "server-only";
import { type AccountState, accountExists, getAccountState } from "@recalino/core/acc";
import { findPrivacyDeletionRequest } from "@recalino/core/priv";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDatabase } from "../db";
import type { SessionProvider } from "../session";
import { type DeletionStage, deletionStage } from "./deletion-stage";
import { type AuthGateway, supabaseAuth } from "./gateway";

export interface Learner {
  userId: string;
  state: AccountState;
}

/**
 * One Auth check per server render: a page without a session asks for the deletion receipt
 * too, and must not wait on a second Auth step (PERF-03).
 */
const currentAuthUser = cache(() => supabaseAuth.currentUser());

/**
 * The signed-in learner with a Recalino account, or null. An Auth user without an account (no
 * sign-in declarations, FR-ACC-001) is not a learner. Cached for one server render.
 */
export const getLearner = cache(async (): Promise<Learner | null> => {
  const user = await currentAuthUser();
  if (user === null) return null;
  const state = await getAccountState(getDatabase(), user.id);
  return state === null ? null : { userId: user.id, state };
});

/**
 * A hidden account can reach only its own unfinished deletion receipt. `stage` says whether the
 * learner still has something to confirm (UX-10).
 */
export async function pendingAccountDeletion(
  auth: AuthGateway = supabaseAuth,
  database = getDatabase,
): Promise<{ userId: string; requestId: string; stage: DeletionStage } | null> {
  const user = await auth.currentUser();
  if (!user) return null;
  const db = database();
  if (await accountExists(db, user.id)) return null;
  const receipt = await findPrivacyDeletionRequest(
    db,
    { userId: user.id, requestId: "privacy-recovery" },
    "account",
    user.id,
  );
  if (!receipt || receipt.state === "completed") return null;
  // Loaded only here: a hidden account is rare, and the other pages never need the ops module.
  const { deletionJournalSaved } = await import("@recalino/core/ops");
  return {
    userId: user.id,
    requestId: receipt.id,
    stage: deletionStage(receipt.state, await deletionJournalSaved(db, receipt.id)),
  };
}
export const getPendingAccountDeletion = cache(() =>
  pendingAccountDeletion({ ...supabaseAuth, currentUser: currentAuthUser }),
);

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
  if (learner === null) {
    if (await getPendingAccountDeletion()) redirect("/deletion");
    redirect(`/?next=${encodeURIComponent(path)}`);
  }
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

/** Only receipt and account-deletion routes may retry after the account is hidden. */
export function privacySessions(
  auth: AuthGateway = supabaseAuth,
  database = getDatabase,
): SessionProvider {
  return {
    async getSession() {
      const user = await auth.currentUser();
      if (!user) return null;
      const db = database();
      if (await accountExists(db, user.id)) return { userId: user.id };
      const receipt = await findPrivacyDeletionRequest(
        db,
        { userId: user.id, requestId: "privacy-session" },
        "account",
        user.id,
      );
      return receipt && receipt.state !== "completed" ? { userId: user.id } : null;
    },
  };
}
