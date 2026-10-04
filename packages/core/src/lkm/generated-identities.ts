import { canonicalJson, sha256Hex } from "../plt";
import { type Claim, type KnowledgeModel, knowledgeModelSchema } from "./schema";

export const GENERATED_IDENTITY_VERSION = "server-content-identities-1";
/** IDs are server bookkeeping, never educational evidence. No text/ref/attribution is changed. */
export function assignGeneratedKnowledgeIds(input: KnowledgeModel): KnowledgeModel {
  const model = knowledgeModelSchema.parse(input);
  const occurrences = new Map<string, number>();
  function identity(prefix: string, value: unknown): string {
    const base = `${prefix}-${sha256Hex(canonicalJson(value)).slice(0, 24)}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return `${base}-${occurrence}`;
  }
  const content = (claim: Claim) => {
    const { id: _id, ...value } = claim;
    return value;
  };
  const claimIdentity = (claim: Claim) => {
    claim.id = identity("claim", content(claim));
  };
  model.summary.forEach(claimIdentity);
  for (const topic of model.topics) {
    topic.id = identity("topic", { title: topic.title, claims: topic.claims.map(content) });
    topic.claims.forEach(claimIdentity);
  }
  for (const item of model.learningItems) {
    item.id = identity("item", {
      kind: item.kind,
      front: item.front,
      back: item.back,
      claim: content(item.claim),
    });
    claimIdentity(item.claim);
  }
  model.homework.forEach(claimIdentity);
  model.uncertainties.forEach(claimIdentity);
  return model;
}
