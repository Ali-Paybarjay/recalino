import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_TIMEOUT_MS,
  authFetch,
  createAuthAdmin,
  createAuthClient,
  timedFetch,
} from "./supabase";

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@recalino/core/config", () => ({
  readSupabaseEnv: () => ({
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
    SUPABASE_SECRET_KEY: "synthetic-secret-key",
  }),
}));
vi.mock("@supabase/ssr", async (original) => {
  const actual = await original<typeof import("@supabase/ssr")>();
  return { ...actual, createServerClient: vi.fn(actual.createServerClient) };
});
vi.mock("@supabase/supabase-js", async (original) => {
  const actual = await original<typeof import("@supabase/supabase-js")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});

/** An Auth server that never answers; it only stops when the request is aborted. */
const stalled: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A synthetic, unexpired session cookie in the @supabase/ssr format. */
function sessionCookie(name: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = [
    base64url({ alg: "ES256", kid: "synthetic-key", typ: "JWT" }),
    base64url({ sub: crypto.randomUUID(), role: "authenticated", exp }),
    "c2lnbmF0dXJl",
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: "synthetic-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id: crypto.randomUUID(), aud: "authenticated", app_metadata: {}, user_metadata: {} },
  };
  return { name, value: `base64-${base64url(session)}` };
}

// PERF-03: a stalled Supabase Auth server must not hold pages and API requests without limit.
describe("Supabase Auth request timeout (PERF-03)", () => {
  it("gives up on a stalled request after its timeout", async () => {
    const started = Date.now();
    await expect(timedFetch(50, stalled)("http://127.0.0.1:54321/auth/v1/user")).rejects.toThrow(
      /timeout|aborted/i,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("still honours the caller's own abort signal", async () => {
    const caller = new AbortController();
    const pending = timedFetch(60_000, stalled)("http://127.0.0.1:54321/auth/v1/user", {
      signal: caller.signal,
    });
    caller.abort(new Error("caller cancelled"));
    await expect(pending).rejects.toThrow("caller cancelled");
  });

  it("gives every Auth client the five-second fetch", async () => {
    expect(AUTH_TIMEOUT_MS).toBe(5000);
    await createAuthClient();
    expect(vi.mocked(createServerClient).mock.calls.at(-1)?.[2]).toMatchObject({
      global: { fetch: authFetch },
    });
    createAuthAdmin();
    expect(vi.mocked(createClient).mock.calls.at(-1)?.[2]).toMatchObject({
      global: { fetch: authFetch },
    });
  });

  it("answers a signed-in request as an Auth error, not a hang, when Auth stalls", async () => {
    const cookie = sessionCookie("sb-timeout-auth-token");
    const client = createServerClient("http://127.0.0.1:54321", "synthetic-publishable-key", {
      global: { fetch: timedFetch(50, stalled) },
      cookieOptions: { name: cookie.name },
      cookies: { getAll: () => [cookie], setAll: () => {} },
    });
    const started = Date.now();
    const { data, error } = await client.auth.getUser();
    // The Auth server was asked (not a missing session), and the timeout ended the call.
    expect(error?.name).toBe("AuthRetryableFetchError");
    expect(data.user).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
