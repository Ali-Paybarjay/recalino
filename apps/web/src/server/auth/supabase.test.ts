import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../../proxy";
import { supabaseAuth } from "./gateway";
import {
  AUTH_STEP_TIMEOUT_MS,
  AUTH_TIMEOUT_MS,
  authFetch,
  createAuthAdmin,
  createAuthClient,
  timedFetch,
} from "./supabase";

const jar = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => jar.cookies, set: () => {} }),
}));
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
    if (init?.signal?.aborted) reject(init.signal.reason);
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A synthetic session cookie in the @supabase/ssr format, unexpired unless `expiresIn` < 0. */
function sessionCookie(name: string, expiresIn = 3600, sub: string = crypto.randomUUID()) {
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const accessToken = [
    base64url({ alg: "ES256", kid: "synthetic-key", typ: "JWT" }),
    base64url({ sub, role: "authenticated", exp }),
    "c2lnbmF0dXJl",
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: "synthetic-refresh-token",
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: exp,
    user: { id: sub, aud: "authenticated", app_metadata: {}, user_metadata: {} },
  };
  return { name, value: `base64-${base64url(session)}` };
}

// PERF-03: a stalled Supabase Auth server must not hold pages and API requests without limit.
describe("Supabase Auth request timeout (PERF-03, FR-PLT-001)", () => {
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

/** The default session cookie name for SUPABASE_URL http://127.0.0.1:54321. */
const SESSION_COOKIE = "sb-127-auth-token";
const SLACK_MS = 1000;

/** Records each Auth request the stalled server receives while its abort signal is still live. */
function stalledAuthServer() {
  const live: string[] = [];
  const server: typeof fetch = (input, init) => {
    if (!init?.signal?.aborted) live.push(String(input));
    return stalled(input, init);
  };
  return { live, server };
}

// PERF-03: the deadline covers a whole request step, retries included. An expired access token
// makes auth-js retry the refresh for up to 30 seconds, so a per-fetch limit alone is not enough.
describe("Supabase Auth step deadline (PERF-03, FR-PLT-001)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    jar.cookies = [];
  });

  it.each([
    ["an expired", -60, "grant_type=refresh_token"],
    ["an unexpired", 3600, "/auth/v1/"],
  ])(
    "answers a request with %s session, proxy then page, as signed out within six seconds when Auth stalls",
    { timeout: 15_000 },
    async (_label, expiresIn, asked) => {
      const auth = stalledAuthServer();
      vi.stubGlobal("fetch", auth.server);
      const cookie = sessionCookie(SESSION_COOKIE, expiresIn);
      const request = new NextRequest("http://localhost:3000/today", {
        headers: { cookie: `${cookie.name}=${cookie.value}` },
      });
      const started = Date.now();
      const response = await proxy(request);
      const proxyDone = Date.now();
      expect(proxyDone - started).toBeLessThan(AUTH_STEP_TIMEOUT_MS + SLACK_MS);
      // Auth was asked (the refresh for an expired token), nothing was rewritten, and the page
      // answers privately.
      expect(auth.live.some((url) => url.includes(asked))).toBe(true);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.has("set-cookie")).toBe(false);

      // The page checks the same session cookie; a passed deadline is never a user.
      jar.cookies = request.cookies.getAll();
      await expect(supabaseAuth.currentUser()).resolves.toBeNull();
      expect(Date.now() - proxyDone).toBeLessThan(AUTH_STEP_TIMEOUT_MS + SLACK_MS);
      expect(Date.now() - started).toBeLessThan(6000);

      // After the deadlines, auth-js's refresh retries send no more requests.
      const sent = auth.live.length;
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(auth.live.length).toBe(sent);
    },
  );

  it("still confirms a valid session with the Auth server when it answers", async () => {
    const id = crypto.randomUUID();
    const requests: string[] = [];
    vi.stubGlobal("fetch", (async (input) => {
      requests.push(String(input));
      return Response.json({ id, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    }) satisfies typeof fetch);
    jar.cookies = [sessionCookie(SESSION_COOKIE, 3600, id)];
    await expect(supabaseAuth.currentUser()).resolves.toEqual({ id });
    expect(requests).toEqual(["http://127.0.0.1:54321/auth/v1/user"]);
  });

  it("refuses a valid session the Auth server rejects", async () => {
    vi.stubGlobal("fetch", (async () =>
      Response.json(
        { code: 403, error_code: "session_not_found", msg: "Session not found" },
        { status: 403 },
      )) satisfies typeof fetch);
    jar.cookies = [sessionCookie(SESSION_COOKIE)];
    await expect(supabaseAuth.currentUser()).resolves.toBeNull();
  });
});
