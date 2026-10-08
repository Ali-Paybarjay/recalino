import { z } from "zod";
import { knowledgeModelSchema } from "../lkm";
import { sourceClassificationSchema } from "../src";

/** Shared wire/checkpoint contract; provider instructions and provenance checks do not change its shape. */
export const generatedKnowledgeSchema = knowledgeModelSchema.extend({
  sourceClassifications: z
    .array(
      z.strictObject({
        sourceId: z.uuid(),
        classification: sourceClassificationSchema,
      }),
    )
    .max(100)
    .default([]),
});
