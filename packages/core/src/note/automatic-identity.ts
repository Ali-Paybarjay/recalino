import type { Claim, KnowledgeModel } from "../lkm";
import { canonicalJson } from "../plt";
import { type NotebookEdits, notebookEditsSchema } from "./schema";

function normalized(text: string): string {
  return text.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}
function sourceContext(claim: Claim) {
  return {
    origin: claim.origin,
    evidence: claim.evidence,
    sources: [...new Set(claim.sourceRefs.map((reference) => reference.sourceId))].sort(),
  };
}

type LearningGoal = {
  kind: string;
  front: string;
  claim: Claim;
};

/** Same question/kind and attribution; used only when uniquely paired source evidence expands. */
export function automaticLearningGoalStem(item: LearningGoal): string {
  return canonicalJson({
    kind: item.kind,
    front: normalized(item.front),
    origin: item.claim.origin,
    evidence: item.claim.evidence,
  });
}

/** A conservative goal identity, independent of wording on the back or extraction revision. */
export function automaticLearningGoalKey(item: LearningGoal): string {
  return canonicalJson({
    kind: item.kind,
    front: normalized(item.front),
    ...sourceContext(item.claim),
  });
}

/** Added corroborating sources keep a goal; replacing its evidence with unrelated sources does not. */
export function automaticLearningGoalsMatch(previous: LearningGoal, next: LearningGoal): boolean {
  if (automaticLearningGoalKey(previous) === automaticLearningGoalKey(next)) return true;
  if (automaticLearningGoalStem(previous) !== automaticLearningGoalStem(next)) return false;
  const before = sourceContext(previous.claim).sources;
  const after = new Set(sourceContext(next.claim).sources);
  return before.length > 0 && after.size > before.length && before.every((id) => after.has(id));
}

function exactClaimKey(claim: Claim): string {
  return canonicalJson({ text: normalized(claim.text), ...sourceContext(claim) });
}
function claimAnchor(claim: Claim): string | null {
  if (!claim.sourceRefs.length) return null;
  return canonicalJson({
    ...sourceContext(claim),
    speakerRole: claim.speakerRole,
    references: claim.sourceRefs
      .map(({ sourceId, locator }) => canonicalJson({ sourceId, locator }))
      .sort(),
  });
}

function uniqueMatches<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
  keys: readonly ((value: T) => string | null)[],
  compatible: (previous: T, next: T) => boolean = () => true,
): Map<string, string> {
  const matches = new Map<string, string>();
  const used = new Set<string>();
  for (const key of keys) {
    const old = new Map<string, T[]>();
    const fresh = new Map<string, T[]>();
    for (const item of previous) {
      const value = key(item);
      if (value !== null) old.set(value, [...(old.get(value) ?? []), item]);
    }
    for (const item of next) {
      const value = key(item);
      if (value !== null) fresh.set(value, [...(fresh.get(value) ?? []), item]);
    }
    for (const [value, candidates] of old) {
      const replacements = fresh.get(value);
      const before = candidates[0];
      const after = replacements?.[0];
      if (
        candidates.length === 1 &&
        replacements?.length === 1 &&
        before &&
        after &&
        compatible(before, after) &&
        !matches.has(before.id) &&
        !used.has(after.id)
      ) {
        matches.set(before.id, after.id);
        used.add(after.id);
      }
    }
  }
  return matches;
}

function remapWithoutDiscarding<T>(
  values: Record<string, T>,
  matches: Map<string, string>,
): Record<string, T> {
  const result = { ...values };
  for (const [oldId, value] of Object.entries(values)) {
    const newId = matches.get(oldId);
    if (!newId || newId === oldId) continue;
    if (Object.hasOwn(values, newId) && canonicalJson(values[newId]) !== canonicalJson(value))
      continue;
    delete result[oldId];
    result[newId] = value;
  }
  return result;
}

/** Unmatched edits retain their old keys and are shown in the existing saved-earlier-edits panel. */
export function reconcileAutomaticEdits(
  previous: KnowledgeModel,
  next: KnowledgeModel,
  prior: NotebookEdits,
): NotebookEdits {
  const items = uniqueMatches(
    previous.learningItems,
    next.learningItems,
    [automaticLearningGoalKey, automaticLearningGoalStem],
    automaticLearningGoalsMatch,
  );
  const claims = new Map<string, string>();
  function addClaims(before: readonly Claim[], after: readonly Claim[]) {
    for (const [oldId, newId] of uniqueMatches(before, after, [exactClaimKey, claimAnchor]))
      claims.set(oldId, newId);
  }
  // Repeated facts across summary, learning items and homework remain separate editable notes.
  addClaims(previous.summary, next.summary);
  addClaims(previous.homework, next.homework);
  addClaims(previous.uncertainties, next.uncertainties);
  const topics = uniqueMatches(previous.topics, next.topics, [(topic) => normalized(topic.title)]);
  for (const topic of previous.topics) {
    const target = next.topics.find((value) => value.id === topics.get(topic.id));
    if (target) addClaims(topic.claims, target.claims);
  }
  for (const item of previous.learningItems) {
    const target = next.learningItems.find((value) => value.id === items.get(item.id));
    if (target) claims.set(item.claim.id, target.claim.id);
  }
  return notebookEditsSchema.parse({
    ...(prior.title === undefined ? {} : { title: prior.title }),
    claims: remapWithoutDiscarding(prior.claims, claims),
    items: remapWithoutDiscarding(prior.items, items),
  });
}
