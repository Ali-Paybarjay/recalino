import "server-only";
import {
  type AccSettings,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  readAccSettings,
} from "@recalino/core/acc";
import { errors } from "@recalino/core/plt";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Handler } from "../api";
import { type AuthGateway, supabaseAuth } from "./gateway";
import { safeReturnPath } from "./return-path";
import { SESSION_COOKIE_OPTIONS } from "./supabase";

/** The sign-in declarations' id, between the sign-in page and the return from Google. */
export const INTENT_COOKIE = "rc_signup_intent";
/** Where the learner was going before sign-in (FR-PLT-001). */
export const NEXT_COOKIE = "rc_next";

export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, maxAgeSeconds: number): void;
  delete(name: string): void;
}

export async function nextCookieJar(): Promise<CookieJar> {
  const store = await cookies();
  return {
    get: (name) => store.get(name)?.value,
    set: (name, value, maxAge) => store.set(name, value, { ...SESSION_COOKIE_OPTIONS, maxAge }),
    delete: (name) => store.delete(name),
  };
}

export interface FlowDeps {
  auth: AuthGateway;
  jar: () => Promise<CookieJar>;
  settings: () => AccSettings;
  now: () => Date;
}

export const defaultFlowDeps: FlowDeps = {
  auth: supabaseAuth,
  jar: nextCookieJar,
  settings: () => readAccSettings(),
  now: () => new Date(),
};

// Both boxes of the sign-in page must be ticked (FR-ACC-001); a browser sends "on".
const startSchema = z.object({
  adult: z.literal("on"),
  terms: z.literal("on"),
  next: z.string().max(512).optional(),
});

/**
 * FR-ACC-001 and FR-ACC-002, step 1 (POST /auth/start): store the declarations, remember them in
 * an httpOnly cookie, and send the browser to Google through Supabase.
 */
export function startHandler(deps: FlowDeps = defaultFlowDeps): Handler {
  return async ({ input, request, db }) => {
    const form = startSchema.parse(input);
    const settings = deps.settings();
    const intent = await createSignupIntent(db, {
      versions: CURRENT_VERSIONS,
      ttlSeconds: settings.signupIntentTtlSeconds,
      now: deps.now(),
    });
    const jar = await deps.jar();
    jar.set(INTENT_COOKIE, intent.id, settings.signupIntentTtlSeconds);
    jar.set(NEXT_COOKIE, safeReturnPath(form.next), settings.signupIntentTtlSeconds);
    const callback = new URL("/auth/callback", request.url).toString();
    return { redirect: await deps.auth.googleSignInUrl(callback) };
  };
}

/**
 * FR-ACC-001 and FR-ACC-002, step 2 (GET /auth/callback): verify the return from Google, then
 * create or open the account in one transaction with the declarations. Without declarations and
 * without an account, the Supabase sign-in is undone and its user deleted: nothing remains.
 */
export function callbackHandler(deps: FlowDeps = defaultFlowDeps): Handler {
  return async ({ request, db }) => {
    const params = new URL(request.url).searchParams;
    const jar = await deps.jar();
    const intentId = jar.get(INTENT_COOKIE) ?? null;
    const next = jar.get(NEXT_COOKIE);
    jar.delete(INTENT_COOKIE);
    jar.delete(NEXT_COOKIE);

    // The learner cancelled at Google: a plain failure, not a security event.
    if (params.has("error")) throw errors.unauthenticated();
    const code = params.get("code");
    if (code === null) throw errors.signInFailed();
    const user = await deps.auth.exchangeCode(code);
    if (user === null) throw errors.signInFailed();

    const outcome = await completeSignIn(db, { userId: user.id, intentId, now: deps.now() });
    if (outcome.kind === "no_account") {
      await deps.auth.signOut();
      await deps.auth.deleteUser(user.id);
      throw errors.unauthenticated();
    }
    return { redirect: outcome.kind === "created" ? "/setup" : safeReturnPath(next) };
  };
}

/** FR-ACC-002 (POST /auth/sign-out): end the session on the server. */
export function signOutHandler(deps: FlowDeps = defaultFlowDeps): Handler {
  return async () => {
    await deps.auth.signOut();
    return { redirect: "/" };
  };
}
