import type { RateLimitClass } from "@recalino/core/plt";

export type Access = "public" | "learner";

export interface RouteMeta {
  id: string;
  /** URL path as Next.js serves it, e.g. "/api/health". */
  path: string;
  access: Access;
  /** FR-PLT-004: creating resources, using allowance and starting AI work require a key. */
  idempotency?: "required";
  rateLimit?: RateLimitClass;
  /** Form posts and the sign-in flow: on any error, send the browser here instead of JSON. */
  errorRedirect?: string;
}

/**
 * Every API route is registered here. The coverage test fails for a route file that is not
 * registered and for a learner route without a cross-account test (FR-PLT-002, NFR-01).
 */
export const ROUTES = {
  health: { id: "health", path: "/api/health", access: "public" },
  // M3: sign-in (FR-ACC-001, FR-ACC-002). Form posts and redirects, so errors go to a page.
  authStart: {
    id: "authStart",
    path: "/auth/start",
    access: "public",
    rateLimit: "auth",
    errorRedirect: "/?error=signin",
  },
  authCallback: {
    id: "authCallback",
    path: "/auth/callback",
    access: "public",
    errorRedirect: "/?error=signin",
  },
  authSignOut: { id: "authSignOut", path: "/auth/sign-out", access: "learner", errorRedirect: "/" },
  // M3: learning profile and acceptances (FR-ACC-003 to FR-ACC-007).
  profile: { id: "profile", path: "/api/profile", access: "learner" },
  consents: { id: "consents", path: "/api/consents", access: "learner" },
  // Local tests only: 404 unless the dev pages are on and Auth runs on this machine.
  devAuthSession: { id: "devAuthSession", path: "/dev/auth/session", access: "public" },
} as const satisfies Record<string, RouteMeta>;
