import "server-only";
import { AUTH_TIMED_OUT, authStep, createAuthAdmin, createAuthClient } from "./supabase";

export interface AuthUser {
  id: string;
}

/**
 * The few Auth operations the app needs. Route handlers depend on this interface, so tests run
 * them with a fake instead of Google.
 */
export interface AuthGateway {
  /** Google's sign-in page, through Supabase with PKCE; the verifier is kept in a cookie. */
  googleSignInUrl(callbackUrl: string): Promise<string>;
  /** Back from Google: the verified user, or null for a bad or replayed code. */
  exchangeCode(code: string): Promise<AuthUser | null>;
  /**
   * The signed-in user, checked with the Auth server on every call, so a session that signed
   * out is refused at once (FR-PLT-001). An Auth server that does not finish within
   * AUTH_STEP_TIMEOUT_MS, refresh retries included, counts as no session (PERF-03).
   */
  currentUser(): Promise<AuthUser | null>;
  /** Ends the session on the server and clears the cookies. Repeating it has no effect. */
  signOut(): Promise<void>;
  /** Removes an Auth user that never became a Recalino account (FR-ACC-001). */
  deleteUser(id: string): Promise<void>;
}

export const supabaseAuth: AuthGateway = {
  async googleSignInUrl(callbackUrl) {
    const auth = (await createAuthClient()).auth;
    const { data, error } = await auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        skipBrowserRedirect: true,
        // Recalino sign-out leaves Google's browser session active; let the learner choose.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error || !data.url) throw new Error("Google sign-in could not start");
    return data.url;
  },

  async exchangeCode(code) {
    const auth = (await createAuthClient()).auth;
    const { data, error } = await auth.exchangeCodeForSession(code);
    return error || !data.user ? null : { id: data.user.id };
  },

  async currentUser() {
    const step = authStep();
    const auth = (await createAuthClient(step.fetch)).auth;
    const result = await step.run(auth.getUser());
    if (result === AUTH_TIMED_OUT) return null;
    const { data, error } = result;
    return error || !data.user ? null : { id: data.user.id };
  },

  async signOut() {
    const auth = (await createAuthClient()).auth;
    const { error } = await auth.signOut({ scope: "local" });
    if (error) throw new Error("Sign-out could not complete");
  },

  async deleteUser(id) {
    const { error } = await createAuthAdmin().deleteUser(id);
    if (error) throw new Error("Auth user could not be deleted");
  },
};
