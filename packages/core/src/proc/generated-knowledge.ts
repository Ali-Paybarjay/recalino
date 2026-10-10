import { z } from "zod";
import { knowledgeModelSchema, productionStudySchema, recognitionStudySchema } from "../lkm";
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

// The server derives a grammar item's ipaText from a validated spoken chunk on the content wire.
// No provider wire offers it, so a provider never names the words an IPA transcribes.
const { ipaText: _ipaText, ...providerProductionStudy } = productionStudySchema.shape;
/** Study content as a provider writes it: the stored study contract without ipaText. */
export const providerStudySchema = z.discriminatedUnion("set", [
  z.strictObject(providerProductionStudy),
  recognitionStudySchema,
]);

/** The legacy class_knowledge provider wire: the checkpoint contract with provider study content. */
export const legacyKnowledgeWireSchema = generatedKnowledgeSchema.extend({
  learningItems: z
    .array(
      knowledgeModelSchema.shape.learningItems.element.extend({
        study: providerStudySchema.optional(),
      }),
    )
    .max(500),
});
