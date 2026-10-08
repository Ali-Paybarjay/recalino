// Periodic clean-up owned by ACC, run through the PLT job queue (FR-PLT-005, M4).
import { emptyPayload, type PeriodicJob } from "../plt";
import { purgeExpiredSignupIntents } from "./signup";

export function accPeriodicJobs(): PeriodicJob[] {
  return [
    {
      everySeconds: 3600,
      definition: {
        kind: "acc.purge_signup_intents",
        version: 1,
        payload: emptyPayload,
        run: async (_payload, ctx) => {
          await purgeExpiredSignupIntents(ctx.db, ctx.now());
        },
      },
    },
  ];
}
