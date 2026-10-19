import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseAuth } from "./gateway";

const { signInWithOAuth, signOut, getUser, timedOut, run } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  timedOut: Symbol("auth-timed-out"),
  run: vi.fn((work: Promise<unknown>) => work),
}));
vi.mock("./supabase", () => ({
  AUTH_TIMED_OUT: timedOut,
  authStep: () => ({ signal: new AbortController().signal, fetch: vi.fn(), run }),
  createAuthClient: async () => ({ auth: { signInWithOAuth, signOut, getUser } }),
  createAuthAdmin: vi.fn(),
}));

beforeEach(() => {
  signInWithOAuth.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
});

describe("Supabase Google sign-in gateway", () => {
  it("asks Google to choose an account even when its previous browser session is active", async () => {
    const callbackUrl = "https://recalino.example/auth/callback";
    const signInUrl = "https://auth.example/auth/v1/authorize?provider=google";
    signInWithOAuth.mockResolvedValue({ data: { url: signInUrl }, error: null });

    await expect(supabaseAuth.googleSignInUrl(callbackUrl)).resolves.toBe(signInUrl);
    expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
  });
});

// FR-ACC-002 / FR-PLT-001: report provider failures and end only this session.
describe("Supabase sign-out gateway", () => {
  it("accepts successful and repeated sign-out using the current session scope", async () => {
    await expect(supabaseAuth.signOut()).resolves.toBeUndefined();
    await expect(supabaseAuth.signOut()).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledTimes(2);
    expect(signOut).toHaveBeenNthCalledWith(1, { scope: "local" });
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
  });

  it("rejects a returned provider error with a sanitized message", async () => {
    signOut.mockResolvedValue({ error: new Error("Synthetic sensitive provider detail") });
    await expect(supabaseAuth.signOut()).rejects.toThrow(/^Sign-out could not complete$/);
  });
});

// FR-PLT-001: the Auth server checks every session, so a signed-out token is refused. PERF-03:
// an Auth error, a fetch timeout or a passed step deadline counts as no session, never a user.
describe("Supabase current user gateway", () => {
  it("returns the user the Auth server confirms", async () => {
    const id = crypto.randomUUID();
    getUser.mockResolvedValue({ data: { user: { id } }, error: null });
    await expect(supabaseAuth.currentUser()).resolves.toEqual({ id });
  });

  it("refuses a session the Auth server rejects or does not answer in time", async () => {
    for (const name of ["AuthApiError", "AuthRetryableFetchError"]) {
      getUser.mockResolvedValue({
        data: { user: null },
        error: Object.assign(new Error(), { name }),
      });
      await expect(supabaseAuth.currentUser()).resolves.toBeNull();
    }
  });

  it("refuses a session whose Auth step passes its deadline, even if Auth answers later", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    run.mockResolvedValueOnce(timedOut);
    await expect(supabaseAuth.currentUser()).resolves.toBeNull();
  });
});
