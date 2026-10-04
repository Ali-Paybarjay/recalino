import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseAuth } from "./gateway";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({
  createAuthClient: async () => ({ auth: { signOut } }),
  createAuthAdmin: vi.fn(),
}));

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
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
