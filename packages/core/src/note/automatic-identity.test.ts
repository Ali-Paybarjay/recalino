import { expect, it } from "vitest";
import type { Claim, KnowledgeModel } from "../lkm";
import { reconcileAutomaticEdits } from "./automatic-identity";
import { notebookEditsSchema } from "./schema";

const sourceId = "00000000-0000-4000-8000-000000000001";
function claim(id: string, contentVersionId: string): Claim {
  return {
    id,
    text: "The original explanation.",
    origin: "from_class",
    creation: "ai_generation",
    evidence: "material",
    sourceRefs: [
      { sourceId, contentVersionId, locator: { kind: "page", page: 2, blockId: "block" } },
    ],
    speakerRole: "unknown",
    uncertain: false,
  };
}
function model(itemId: string, version: string): KnowledgeModel {
  return {
    schemaVersion: "1",
    title: "Class title",
    language: { learning: "en", explanation: "en" },
    summary: [claim(`summary-${itemId}`, version)],
    topics: [],
    learningItems: [
      {
        id: itemId,
        kind: "vocabulary",
        front: "Pros and cons",
        back: "An explanation",
        claim: claim(`claim-${itemId}`, version),
      },
    ],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
  };
}

it("maps reliable same-goal edits when generated IDs and extracted content versions change", () => {
  const previous = model("old", "00000000-0000-4000-8000-000000000010");
  const next = model("new", "00000000-0000-4000-8000-000000000011");
  const edits = notebookEditsSchema.parse({
    title: "My title",
    claims: { "summary-old": "My summary" },
    items: { old: { back: "My answer" } },
  });
  const result = reconcileAutomaticEdits(previous, next, edits);
  expect(result).toEqual({
    title: "My title",
    claims: { "summary-new": "My summary" },
    items: { new: { back: "My answer" } },
  });
});

it("keeps ambiguous or different-source edits under their original keys for visible preservation", () => {
  const previous = model("old", "00000000-0000-4000-8000-000000000010");
  const next = model("new", "00000000-0000-4000-8000-000000000011");
  const first = next.learningItems[0];
  if (!first) throw new Error("Missing test item");
  next.learningItems.push({ ...first, id: "ambiguous" });
  const edits = notebookEditsSchema.parse({ items: { old: { back: "My answer" } } });
  expect(reconcileAutomaticEdits(previous, next, edits).items).toEqual(edits.items);
  next.learningItems.pop();
  const reference = first.claim.sourceRefs[0];
  if (!reference) throw new Error("Missing test reference");
  reference.sourceId = "00000000-0000-4000-8000-000000000002";
  expect(reconcileAutomaticEdits(previous, next, edits).items).toEqual(edits.items);
});

it("retains both saved edits when a returning item's ID already carries another correction", () => {
  const previous = model("old", "00000000-0000-4000-8000-000000000010");
  const next = model("new", "00000000-0000-4000-8000-000000000011");
  const edits = notebookEditsSchema.parse({
    items: { old: { back: "Recent correction" }, new: { back: "Earlier correction" } },
  });
  expect(reconcileAutomaticEdits(previous, next, edits).items).toEqual(edits.items);
});

it("carries a unique learning goal's edits when new material corroborates its existing evidence", () => {
  const previous = model("old", "00000000-0000-4000-8000-000000000010");
  const next = model("new", "00000000-0000-4000-8000-000000000011");
  const item = next.learningItems[0];
  const reference = item?.claim.sourceRefs[0];
  if (!item || !reference) throw new Error("Missing test evidence");
  item.claim.sourceRefs.push({
    ...reference,
    sourceId: "00000000-0000-4000-8000-000000000002",
  });
  item.claim.text = "A more complete explanation from both sources.";
  const edits = notebookEditsSchema.parse({
    claims: { "claim-old": "My retained explanation" },
    items: { old: { back: "My retained answer" } },
  });
  expect(reconcileAutomaticEdits(previous, next, edits)).toEqual({
    claims: { "claim-new": "My retained explanation" },
    items: { new: { back: "My retained answer" } },
  });
  next.learningItems.push({
    ...item,
    id: "ambiguous",
    claim: { ...item.claim, id: "ambiguous-claim" },
  });
  expect(reconcileAutomaticEdits(previous, next, edits)).toEqual(edits);
});
