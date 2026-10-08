import { z } from "zod";
import { providerSettingsSchema } from "../aip";
import { sourceContentSchema } from "../src";
import { learnerTeachingContextSchema } from "./learner-context";

export const runStates = [
  "awaiting_upload",
  "queued",
  "processing",
  "needs_input",
  "partial_ready",
  "ready",
  "failed",
  "cancelled",
] as const;
export type RunState = (typeof runStates)[number];
export const createRunSchema = z.strictObject({
  sessionId: z.uuid(),
  operationKey: z.string().min(8).max(200),
  expectedFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  expectedSourcesVersion: z.number().int().nonnegative().optional(),
  automaticRequestVersion: z.number().int().positive().optional(),
});
export const snapshotSourceSchema = z.strictObject({
  sourceId: z.uuid(),
  kind: z.enum(["audio", "image", "pdf", "html", "text"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string(),
  durationMs: z.number().int().positive().nullable(),
  pageCount: z.number().int().positive().nullable(),
  objectId: z.uuid().nullable(),
  contentVersionId: z.uuid().nullable(),
  role: z.enum(["class_audio", "board_photo", "class_material", "user_notes"]).optional(),
  captureAnchor: z
    .strictObject({
      sourceId: z.uuid(),
      offsetMs: z.number().int().nonnegative(),
      state: z.enum(["recording", "paused"]).nullable(),
      timeStatus: z.enum(["unknown", "estimated", "user_confirmed"]),
    })
    .nullable()
    .default(null),
  ranges: z.array(
    z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }),
  ),
  units: sourceContentSchema.shape.units,
  blocks: sourceContentSchema.shape.blocks,
});
export const sourceSnapshotSchema = z.strictObject({
  sourcesVersion: z.number().int().nonnegative(),
  fingerprint: z.string(),
  sources: z.array(snapshotSourceSchema).min(1),
});
export type RunSource = z.infer<typeof snapshotSourceSchema>;
export type RunSnapshot = z.infer<typeof sourceSnapshotSchema>;
export const runSettingsSchema = z.strictObject({
  provider: providerSettingsSchema,
  explanationLanguage: z.string(),
  profileVersion: z.number().int().nonnegative(),
  learnerContext: learnerTeachingContextSchema.optional(),
  teachingPreferences: z
    .strictObject({ shorterExamples: z.boolean() })
    .default({ shorterExamples: false }),
});
export const runJobPayload = z.strictObject({ runId: z.uuid(), userId: z.uuid() });
