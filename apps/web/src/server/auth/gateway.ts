import "server-only";
import { createAuthAdmin, createAuthClient } from "./supabase";

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
   * out is refused at once (FR-PLT-001).
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
      options: { redirectTo: callbackUrl, skipBrowserRedirect: true },
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
    const auth = (await createAuthClient()).auth;
    const { data, error } = await auth.getUser();
    return error || !data.user ? null : { id: data.user.id };
  },

  async signOut() {
    const auth = (await createAuthClient()).auth;
    await auth.signOut({ scope: "local" });
  },

  async deleteUser(id) {
    const { error } = await createAuthAdmin().deleteUser(id);
    if (error) throw new Error("Auth user could not be deleted");
  },
};
