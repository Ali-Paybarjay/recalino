import { z } from "zod";
import { type Claim, type KnowledgeModel, knowledgeModelSchema, modelClaims } from "../lkm";
import { errors } from "../plt";

const text = z.string().trim().min(1).max(20000);
const key = z.string().min(1).max(100);
export const notebookEditsSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(300).optional(),
    claims: z.record(key, text).default({}),
    items: z
      .record(key, z.strictObject({ front: text.optional(), back: text.optional() }))
      .default({}),
  })
  .refine(
    (value) => Object.keys(value.claims).length <= 1500 && Object.keys(value.items).length <= 500,
    "too_many_edits",
  );
export type NotebookEdits = z.infer<typeof notebookEditsSchema>;
export const publishNotebookSchema = z.strictObject({
  expectedRevisionId: z.uuid().nullable(),
  knowledgeVersionId: z.uuid().optional(),
  edits: notebookEditsSchema.optional(),
});
export type PublishNotebookInput = z.input<typeof publishNotebookSchema>;

/** Edits only change visible text. Evidence, source references and the original LKM stay intact. */
export function applyNotebookEdits(original: KnowledgeModel, edits: NotebookEdits): KnowledgeModel {
  const model = knowledgeModelSchema.parse(original);
  const editClaim = (claim: Claim): Claim =>
    edits.claims[claim.id] === undefined
      ? claim
      : { ...claim, text: edits.claims[claim.id] as string, creation: "user_edit" };
  return {
    ...model,
    title: edits.title ?? model.title,
    summary: model.summary.map(editClaim),
    topics: model.topics.map((topic) => ({ ...topic, claims: topic.claims.map(editClaim) })),
    learningItems: model.learningItems.map((item) => ({
      ...item,
      ...edits.items[item.id],
      claim: edits.items[item.id]
        ? { ...editClaim(item.claim), creation: "user_edit" }
        : editClaim(item.claim),
    })),
    homework: model.homework.map(editClaim),
    uncertainties: model.uncertainties.map(editClaim),
  };
}
export function validateNewEdits(model: KnowledgeModel, edits: NotebookEdits): void {
  const claims = new Set(modelClaims(model).map((item) => item.id));
  const items = new Set(model.learningItems.map((item) => item.id));
  if (
    Object.keys(edits.claims).some((id) => !claims.has(id)) ||
    Object.keys(edits.items).some((id) => !items.has(id))
  )
    throw errors.validationFailed({ edits: ["unknown_item"] });
}
