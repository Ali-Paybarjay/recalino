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
}

/**
 * Every API route is registered here. The coverage test fails for a route file that is not
 * registered and for a learner route without a cross-account test (FR-PLT-002, NFR-01).
 */
export const ROUTES = {
  health: { id: "health", path: "/api/health", access: "public" },
} as const satisfies Record<string, RouteMeta>;
