import type { Database } from "../db";
import type { Logger } from "./log";
import { recordSecurityEvent } from "./security";
import type { RateLimitClass, RateLimitRule } from "./settings";

export interface RateLimitDecision {
  allowed: boolean;
  hits: number;
  retryAfterSeconds: number;
}

export interface RateLimitSubject {
  userId: string | null;
  /** Keyed hash of the client IP; the raw IP is never stored (PRD-PRIV-06). */
  ipHash: string | null;
}

/** Bucket names for the scopes a rule applies to. */
export function rateLimitBuckets(
  routeClass: RateLimitClass,
  rule: RateLimitRule,
  subject: RateLimitSubject,
): string[] {
  const buckets: string[] = [];
  if (rule.scopes.includes("user") && subject.userId) {
    buckets.push(`${routeClass}:user:${subject.userId}`);
  }
  if (rule.scopes.includes("ip") && subject.ipHash) {
    buckets.push(`${routeClass}:ip:${subject.ipHash}`);
  }
  return buckets;
}

/** FR-PLT-006: one fixed-window counter hit. Counting is atomic in Postgres. */
export async function hitRateLimit(
  db: Database,
  bucket: string,
  rule: Pick<RateLimitRule, "limit" | "windowSeconds">,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const row = await db
    .insertInto("plt.rate_limit_bucket")
    .values({ bucket, window_start: new Date(windowStart), hits: 1 })
    .onConflict((conflict) =>
      conflict
        .columns(["bucket", "window_start"])
        .doUpdateSet((eb) => ({ hits: eb("plt.rate_limit_bucket.hits", "+", 1) })),
    )
    .returning("hits")
    .executeTakeFirstOrThrow();
  return {
    allowed: row.hits <= rule.limit,
    hits: row.hits,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now.getTime()) / 1000)),
  };
}

export interface RateLimitCheck {
  routeClass: RateLimitClass;
  rule: RateLimitRule;
  subject: RateLimitSubject;
  repeatThreshold: number;
  route: string;
  requestId: string;
  now?: Date;
  log?: Logger;
}

/**
 * Hits every bucket of the rule. Repeated hits beyond the limit record one security event per
 * window (FR-PLT-006, FR-PLT-007).
 */
export async function checkRateLimit(
  db: Database,
  check: RateLimitCheck,
): Promise<RateLimitDecision> {
  let decision: RateLimitDecision = { allowed: true, hits: 0, retryAfterSeconds: 0 };
  for (const bucket of rateLimitBuckets(check.routeClass, check.rule, check.subject)) {
    const result = await hitRateLimit(db, bucket, check.rule, check.now);
    if (result.hits === check.rule.limit + check.repeatThreshold) {
      try {
        await recordSecurityEvent(
          db,
          {
            kind: "rate_limited",
            userId: check.subject.userId,
            route: check.route,
            requestId: check.requestId,
          },
          check.log,
        );
      } catch (error) {
        // A failed record must not turn a correct limit decision into an error response.
        check.log?.("error", "security_event_failed", {
          request_id: check.requestId,
          route: check.route,
          error_name: error instanceof Error ? error.name : typeof error,
        });
      }
    }
    if (
      !result.allowed &&
      (decision.allowed || result.retryAfterSeconds > decision.retryAfterSeconds)
    ) {
      decision = result;
    }
  }
  return decision;
}

export async function purgeRateLimitBuckets(db: Database, before: Date): Promise<number> {
  const result = await db
    .deleteFrom("plt.rate_limit_bucket")
    .where("window_start", "<", before)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
