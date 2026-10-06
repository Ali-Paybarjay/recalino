import type { StudyCard } from "@recalino/core/card";
import { renderStudyCard } from "@recalino/core/study-render";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { referenceStudyModel } from "../../../../../packages/core/test/reference-study-fixture";
import { CardEditor } from "./CardEditor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

describe("formatted card editor", () => {
  it("does not offer a save that would erase formatting without any edit", () => {
    const item = referenceStudyModel().learningItems[0];
    if (!item) throw new Error("Missing reference card");
    const card: StudyCard = {
      id: "card",
      ownerId: "owner",
      learningItemId: item.id,
      sessionIds: ["class"],
      template: "basic",
      direction: "forward",
      ...renderStudyCard(item),
      provenance: item.claim,
      status: "active",
      contentVersion: 1,
      important: false,
      qualityConfirmed: true,
      frontMediaId: null,
      backMediaId: null,
      createdAt: "2026-10-05T12:00:00.000Z",
      updatedAt: "2026-10-05T12:00:00.000Z",
      contentFormat: "lesson_html",
      studySet: "production",
    };
    const html = renderToStaticMarkup(
      createElement(CardEditor, { initial: card, initialProposals: [], userId: "owner" }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save card<\/button>/);
    expect(html).toContain("wear and tear");
  });
});
