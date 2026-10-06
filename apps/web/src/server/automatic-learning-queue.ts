import "server-only";
import { z } from "zod";

/** Shared enqueue contract; the runner implementation is registered by the app composition. */
export const automaticLearningQueue = {
  kind: "proc.automatic_learning",
  version: 1,
  payload: z.strictObject({
    sessionId: z.uuid(),
    userId: z.uuid(),
    requestVersion: z.int().positive(),
  }),
  options: { maxAttempts: 20, leaseSeconds: 120, retryBaseSeconds: 3, retryMaxSeconds: 30 },
};
