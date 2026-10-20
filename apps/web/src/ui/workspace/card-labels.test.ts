import { cardStatusSchema, cardTemplateSchema } from "@recalino/core/card";
import { SOURCE_KINDS } from "@recalino/core/src";
import { describe, expect, it } from "vitest";
import {
  cardStatusLabel,
  cardSummary,
  cardTemplateLabel,
  mediaAssetLabel,
  studySetLabel,
} from "./card-labels";
import { sourceKindLabel } from "./source-labels";

// UX-05: the learner reads words, never the stored value of a card, a file or a media asset.
describe("labels for what the learner sees", () => {
  it("names every card type the server can store", () => {
    for (const template of cardTemplateSchema.options) {
      const label = cardTemplateLabel(template);
      expect(label, template).toBeTruthy();
      expect(label, template).not.toBe(template);
    }
  });

  it("gives a state word to every state except a deleted card", () => {
    const labels = cardStatusSchema.options.map((status) => [status, cardStatusLabel(status)]);
    expect(Object.fromEntries(labels)).toEqual({
      candidate: "Suggested",
      // Approved by the owner on 2026-10-20 (D101).
      active: "In your review queue",
      suspended: "Suspended",
      known: "Known",
      rejected: "Rejected",
      deleted: null,
    });
  });

  it("summarises a card without direction, template or status values", () => {
    expect(cardSummary({ status: "candidate", template: "basic", important: true })).toBe(
      "Suggested · Question and answer · Important",
    );
    expect(cardSummary({ status: "active", template: "unknown_new_type" })).toBe(
      "In your review queue",
    );
    expect(cardSummary({ status: "deleted", template: "unknown_new_type" })).toBe("");
  });

  it("names the study sets with the approved words of Your learning", () => {
    expect(studySetLabel("production")).toBe("Core cards");
    expect(studySetLabel("recognition")).toBe("Supplementary cards");
    expect(studySetLabel("legacy")).toBe("Other cards");
  });

  it("names media by what it is and its state, with no stored id or state value", () => {
    expect(mediaAssetLabel({ synthetic: true, state: "ready" }, 0)).toBe(
      "Computer voice 1 · Ready",
    );
    expect(mediaAssetLabel({ synthetic: false, state: "queued" }, 1)).toBe(
      "Class image 2 · In queue",
    );
    expect(mediaAssetLabel({ synthetic: false, state: "needs_input" }, 2)).not.toContain("_");
  });

  it("names every kind of uploaded file", () => {
    for (const kind of SOURCE_KINDS) expect(sourceKindLabel(kind), kind).not.toBe(kind);
    expect(sourceKindLabel("something_new")).toBe("File");
  });
});
