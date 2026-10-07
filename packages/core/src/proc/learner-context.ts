import { z } from "zod";
import { GOALS, LEVELS, type LearningProfile } from "../acc";

export const learnerTeachingContextSchema = z.strictObject({
  version: z.literal(1),
  declaredLevel: z.enum(LEVELS).optional(),
  goal: z.enum(GOALS).optional(),
});
export type LearnerTeachingContext = z.infer<typeof learnerTeachingContextSchema>;

/** AC-D46-05: retain declared choices only; the version distinguishes new runs from legacy reuse. */
export function snapshotLearnerTeachingContext(
  profile: Pick<LearningProfile, "level" | "goal">,
): LearnerTeachingContext {
  return learnerTeachingContextSchema.parse({
    version: 1,
    ...(profile.level === null ? {} : { declaredLevel: profile.level }),
    ...(profile.goal === null ? {} : { goal: profile.goal }),
  });
}
