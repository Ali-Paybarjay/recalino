import "server-only";
import { readSupabaseEnv } from "@recalino/core/config";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * FR-PLT-001: the session lives in httpOnly cookies, so page scripts never see a token. All
 * Supabase Auth calls run on the server; the browser has no Supabase client (ADR-0002).
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

/** PERF-03: the longest a page or API request waits for one Supabase Auth answer. */
export const AUTH_TIMEOUT_MS = 5000;

/** A fetch that gives up after `timeoutMs`, and still honours the caller's own abort signal. */
export function timedFetch(
  timeoutMs: number,
  base: typeof fetch = (input, init) => fetch(input, init),
): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return base(input, { ...init, signal });
  };
}

/**
 * Every Supabase Auth client's fetch: a stalled Auth server ends the call as an Auth error (the
 * session then counts as missing) instead of holding the request until the function stops.
 */
export const authFetch = timedFetch(AUTH_TIMEOUT_MS);

/** Supabase Auth bound to this request's cookies (Route Handlers and Server Components). */
export async function createAuthClient() {
  const store = await cookies();
  const env = readSupabaseEnv();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: authFetch },
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) {
            store.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
          }
        } catch {
          // A Server Component can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/** Admin access with the secret key: server only, never sent to the browser (FR-PLT-009). */
export function createAuthAdmin() {
  const env = readSupabaseEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    global: { fetch: authFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
}
