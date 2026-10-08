import { z } from "zod";
export const reviewChoiceSchema = z.enum(["forgot", "remembered", "again", "hard", "good", "easy"]);
export const reviewStudySetSchema = z.enum(["production", "recognition", "legacy"]);
export const reviewQueueQuerySchema = z.strictObject({
  sessionId: z.uuid().optional(),
  studySet: reviewStudySetSchema.optional(),
});
export type ReviewStudySet = z.infer<typeof reviewStudySetSchema>;
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;
export const reviewInputSchema = z.strictObject({
  eventId: z.uuid(),
  cardId: z.uuid(),
  expectedVersion: z.int().nonnegative(),
  expectedContentVersion: z.int().positive(),
  mode: z.enum(["simple", "advanced"]),
  choice: reviewChoiceSchema,
  durationMs: z.int().min(0).max(3600000).default(0),
});
export const reviewSettingsSchema = z.strictObject({
  mode: z.enum(["simple", "advanced"]),
  desiredRetention: z.number().min(0.7).max(0.97),
  dailyNewLimit: z.int().min(0).max(100),
  timeBudgetMinutes: z.int().min(1).max(180),
});
export type ReviewInput = z.input<typeof reviewInputSchema>;
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  mode: "simple",
  desiredRetention: 0.9,
  dailyNewLimit: 5,
  timeBudgetMinutes: 15,
};
