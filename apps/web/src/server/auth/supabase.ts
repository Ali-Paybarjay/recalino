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

/** PERF-03: the longest one Supabase Auth fetch waits for its answer. */
export const AUTH_TIMEOUT_MS = 5000;

/**
 * PERF-03: the longest one request step waits on Supabase Auth in all, retries included: the
 * proxy's session refresh, or a page's or route's session check. With an expired access token,
 * auth-js retries the refresh for up to 30 seconds, so a per-fetch limit alone does not bound a
 * request. Two steps (proxy and page) stay under six seconds.
 */
export const AUTH_STEP_TIMEOUT_MS = 2500;

/** A bounded Auth step's answer when Supabase Auth did not finish in time. */
export const AUTH_TIMED_OUT = Symbol("auth-timed-out");

/**
 * A fetch that gives up after `timeoutMs`, or once `stop` aborts, and still honours the caller's
 * own abort signal.
 */
export function timedFetch(
  timeoutMs: number,
  base: typeof fetch = (input, init) => fetch(input, init),
  stop?: AbortSignal,
): typeof fetch {
  return (input, init) => {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (init?.signal) signals.unshift(init.signal);
    if (stop) signals.push(stop);
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    return base(input, { ...init, signal });
  };
}

/** `work`'s answer, or AUTH_TIMED_OUT once `deadline` aborts first. */
export function withAuthDeadline<T>(
  work: Promise<T>,
  deadline: AbortSignal,
): Promise<T | typeof AUTH_TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timedOut = () => resolve(AUTH_TIMED_OUT);
    if (deadline.aborted) timedOut();
    else deadline.addEventListener("abort", timedOut, { once: true });
    work.then(
      (value) => {
        deadline.removeEventListener("abort", timedOut);
        resolve(value);
      },
      (error: unknown) => {
        deadline.removeEventListener("abort", timedOut);
        reject(error);
      },
    );
  });
}

/**
 * One bounded Auth step. Give the Supabase client `fetch` and wrap its call in `run`: at the
 * deadline `run` answers AUTH_TIMED_OUT, and the client's fetches abort with it, so auth-js's
 * refresh retries send nothing more. `signal` has aborted once the step is over.
 */
export function authStep(timeoutMs = AUTH_STEP_TIMEOUT_MS) {
  const signal = AbortSignal.timeout(timeoutMs);
  return {
    signal,
    fetch: timedFetch(AUTH_TIMEOUT_MS, undefined, signal),
    run: <T>(work: Promise<T>) => withAuthDeadline(work, signal),
  };
}

/**
 * Every Supabase Auth client's fetch: a stalled Auth server ends the call as an Auth error (the
 * session then counts as missing) instead of holding the request until the function stops.
 */
export const authFetch = timedFetch(AUTH_TIMEOUT_MS);

/**
 * Supabase Auth bound to this request's cookies (Route Handlers and Server Components). A request
 * step passes its `authStep().fetch` so the whole step, not only each fetch, is bounded.
 */
export async function createAuthClient(stepFetch: typeof fetch = authFetch) {
  const store = await cookies();
  const env = readSupabaseEnv();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: stepFetch },
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
