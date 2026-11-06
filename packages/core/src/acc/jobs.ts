// Periodic clean-up owned by ACC, run through the PLT job queue (FR-PLT-005, M4).
import { accountOrphansJob, emptyPayload, type PeriodicJob } from "../plt";
import { existingAccountIds } from "./account";
import { purgeExpiredSignupIntents } from "./signup";

const HOUR = 3600;

export function accPeriodicJobs(): PeriodicJob[] {
  return [
    {
      everySeconds: HOUR,
      definition: {
        kind: "acc.purge_signup_intents",
        version: 1,
        payload: emptyPayload,
        run: async (_payload, ctx) => {
          await purgeExpiredSignupIntents(ctx.db, ctx.now());
        },
      },
    },
    // P5-01 (P4-01 AC-5): PLT cannot read ACC's tables, so ACC schedules PLT's sweep of rows
    // without an account and hands it only its read-only `existingAccountIds`. The job is a dry
    // run that counts and logs counts; removal stays a separate, explicit owner action.
    {
      everySeconds: HOUR,
      definition: accountOrphansJob(existingAccountIds),
    },
  ];
}
