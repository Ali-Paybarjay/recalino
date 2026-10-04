import { z } from "zod";
import type { Database } from "../db";
import { errors, isValidTimeZone, type LearnerContext } from "../plt";
import {
  type AccountState,
  GOALS,
  getAccountState,
  LEVELS,
  lockAccount,
  SETUP_STEPS,
  type SetupStep,
} from "./account";
import { isFirstLanguage } from "./languages";

/** One answer of profile setup (FR-ACC-003) or one edit in Settings (FR-ACC-004, FR-ACC-006). */
export const profileChangeSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("first_language"), firstLanguage: z.string().min(2).max(16) }),
  z.object({
    field: z.literal("explanation_language"),
    explanationLanguage: z.enum(["english", "first_language"]),
  }),
  z.object({
    field: z.literal("level_goal"),
    level: z.enum(LEVELS).nullable(),
    goal: z.enum(GOALS).nullable(),
  }),
  z.object({ field: z.literal("timezone"), timezone: z.string().min(1).max(64) }),
]);

export type ProfileChange = z.infer<typeof profileChangeSchema>;

const STEP_OF: Record<ProfileChange["field"], (typeof SETUP_STEPS)[number]> = {
  first_language: 1,
  explanation_language: 3,
  level_goal: 4,
  timezone: 6,
};

function nextStep(step: (typeof SETUP_STEPS)[number]): SetupStep {
  const index = SETUP_STEPS.indexOf(step);
  return SETUP_STEPS[index + 1] ?? 8;
}

/**
 * Saves one profile answer. During setup it also moves to the next screen, so a learner who
 * leaves resumes at the right step; an answer for a later screen is refused. A change of content
 * makes a new profile version with its time (FR-ACC-004); saving the same values makes none.
 * The time zone is a setting of the account, not of the profile, and has no versions (FR-ACC-006).
 */
export async function updateProfile(
  db: Database,
  ctx: LearnerContext,
  change: ProfileChange,
  options: { now: Date },
): Promise<AccountState> {
  validate(change);
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    // One change at a time per learner, so versions never collide.
    await tx
      .selectFrom("acc.learning_profile")
      .select("user_id")
      .where("user_id", "=", ctx.userId)
      .forUpdate()
      .executeTakeFirst();
    const state = await getAccountState(tx, ctx.userId);
    if (state === null) throw errors.notFound();

    const step = STEP_OF[change.field];
    if (!state.setupComplete && step > state.setupStep) {
      throw errors.validationFailed({ field: ["setup_step_not_reached"] });
    }
    if (
      change.field === "explanation_language" &&
      change.explanationLanguage === "first_language" &&
      state.profile.firstLanguage === null
    ) {
      throw errors.validationFailed({ explanationLanguage: ["first_language_missing"] });
    }

    if (change.field === "timezone") {
      await tx
        .updateTable("acc.user_account")
        .set({ timezone: change.timezone })
        .where("id", "=", ctx.userId)
        .execute();
    } else {
      const next = { ...state.profile, ...profileFields(change) };
      const changed =
        next.firstLanguage !== state.profile.firstLanguage ||
        next.explanationLanguage !== state.profile.explanationLanguage ||
        next.level !== state.profile.level ||
        next.goal !== state.profile.goal;
      if (changed) {
        const version = state.profile.version + 1;
        await tx
          .updateTable("acc.learning_profile")
          .set({
            version,
            first_language: next.firstLanguage,
            explanation_language: next.explanationLanguage,
            level: next.level,
            goal: next.goal,
            updated_at: options.now,
          })
          .where("user_id", "=", ctx.userId)
          .execute();
        await tx
          .insertInto("acc.learning_profile_history")
          .values({
            user_id: ctx.userId,
            version,
            snapshot: JSON.stringify({
              firstLanguage: next.firstLanguage,
              learningLanguage: next.learningLanguage,
              explanationLanguage: next.explanationLanguage,
              level: next.level,
              goal: next.goal,
            }),
            created_at: options.now,
          })
          .execute();
      }
    }

    if (!state.setupComplete && step === state.setupStep) {
      await tx
        .updateTable("acc.learning_profile")
        .set({ setup_step: nextStep(step), updated_at: options.now })
        .where("user_id", "=", ctx.userId)
        .execute();
    }
  });

  const updated = await getAccountState(db, ctx.userId);
  if (updated === null) throw errors.notFound();
  return updated;
}

function validate(change: ProfileChange): void {
  if (change.field === "first_language" && !isFirstLanguage(change.firstLanguage)) {
    throw errors.validationFailed({ firstLanguage: ["unknown_language"] });
  }
  if (change.field === "timezone" && !isValidTimeZone(change.timezone)) {
    throw errors.validationFailed({ timezone: ["unknown_time_zone"] });
  }
}

function profileFields(change: Exclude<ProfileChange, { field: "timezone" }>) {
  switch (change.field) {
    case "first_language":
      return { firstLanguage: change.firstLanguage };
    case "explanation_language":
      return { explanationLanguage: change.explanationLanguage };
    case "level_goal":
      return { level: change.level, goal: change.goal };
  }
}
