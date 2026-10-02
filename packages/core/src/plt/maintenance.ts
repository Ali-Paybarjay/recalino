// Periodic clean-up owned by PLT, run through the job queue so failures retry (FR-PLT-005).
import { z } from "zod";
import { purgeExpiredIdempotencyKeys } from "./idempotency";
import { type JobDefinition, purgeFinishedJobs } from "./jobs";
import { purgeRateLimitBuckets } from "./rate-limit";
import type { PltSettings } from "./settings";

export type EmptyPayload = Record<string, never>;

export interface PeriodicJob {
  definition: JobDefinition<EmptyPayload>;
  everySeconds: number;
}

export const emptyPayload: z.ZodType<EmptyPayload> = z.strictObject({});

const HOUR = 3600;

export function pltPeriodicJobs(settings: PltSettings): PeriodicJob[] {
  const longestWindow = Math.max(
    ...Object.values(settings.rateLimits).map((rule) => rule.windowSeconds),
  );
  return [
    {
      everySeconds: HOUR,
      definition: {
        kind: "plt.purge_idempotency_keys",
        version: 1,
        payload: emptyPayload,
        run: async (_payload, ctx) => {
          await purgeExpiredIdempotencyKeys(ctx.db, ctx.now());
        },
      },
    },
    {
      everySeconds: HOUR,
      definition: {
        kind: "plt.purge_rate_limit_buckets",
        version: 1,
        payload: emptyPayload,
        run: async (_payload, ctx) => {
          // A bucket is finished once its window has passed; keep one more window for safety.
          const before = new Date(ctx.now().getTime() - 2 * longestWindow * 1000);
          await purgeRateLimitBuckets(ctx.db, before);
        },
      },
    },
    {
      everySeconds: HOUR,
      definition: {
        kind: "plt.purge_finished_jobs",
        version: 1,
        payload: emptyPayload,
        run: async (_payload, ctx) => {
          const days = settings.jobs.retentionDays;
          await purgeFinishedJobs(ctx.db, new Date(ctx.now().getTime() - days * 86_400_000));
        },
      },
    },
  ];
}
