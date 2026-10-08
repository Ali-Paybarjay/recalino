import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseAuth } from "./gateway";

const { signInWithOAuth, signOut } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("./supabase", () => ({
  createAuthClient: async () => ({ auth: { signInWithOAuth, signOut } }),
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
