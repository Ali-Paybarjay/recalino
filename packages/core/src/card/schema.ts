import { z } from "zod";
export const cardTemplateSchema = z.enum([
  "basic",
  "vocabulary",
  "cloze",
  "grammar",
  "correction",
  "listening",
]);
export const cardStatusSchema = z.enum([
  "candidate",
  "active",
  "suspended",
  "known",
  "rejected",
  "deleted",
]);
export const generateCardsSchema = z.strictObject({
  itemIds: z.array(z.string().min(1).max(100)).max(500).optional(),
  reverse: z.boolean().default(false),
  autoAdd: z.boolean().default(false),
});
export const editCardSchema = z.strictObject({
  expectedVersion: z.int().positive(),
  front: z.string().trim().min(1).max(20000),
  back: z.string().trim().min(1).max(20000),
  newLearningGoal: z.boolean(),
});
export const cardActionSchema = z.strictObject({
  expectedVersion: z.int().positive(),
  action: z.enum([
    "activate",
    "reject",
    "suspend",
    "resume",
    "know",
    "unmark_known",
    "important",
    "unimportant",
    "wrong",
    "delete",
    "undo",
  ]),
  confirmQuality: z.boolean().optional(),
});
export type CardTemplate = z.infer<typeof cardTemplateSchema>;
export type CardStatus = z.infer<typeof cardStatusSchema>;
export type GenerateCardsInput = z.input<typeof generateCardsSchema>;
export type EditCardInput = z.infer<typeof editCardSchema>;
export type CardActionInput = z.infer<typeof cardActionSchema>;
