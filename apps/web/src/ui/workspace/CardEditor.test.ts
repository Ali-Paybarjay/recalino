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

// UX-03: deleting a card asks first, with the frame E3-delete wording, in a sheet.
describe("deleting a card", () => {
  const item = referenceStudyModel().learningItems[0];
  if (!item) throw new Error("Missing reference card");
  const card = (status: StudyCard["status"]): StudyCard => ({
    id: "card",
    ownerId: "owner",
    learningItemId: item.id,
    sessionIds: ["class"],
    template: "basic",
    direction: "forward",
    ...renderStudyCard(item),
    provenance: item.claim,
    status,
    contentVersion: 1,
    important: false,
    qualityConfirmed: true,
    frontMediaId: null,
    backMediaId: null,
    createdAt: "2026-10-05T12:00:00.000Z",
    updatedAt: "2026-10-05T12:00:00.000Z",
    contentFormat: "lesson_html",
    studySet: "production",
  });
  const render = (status: StudyCard["status"]) =>
    renderToStaticMarkup(
      createElement(CardEditor, { initial: card(status), initialProposals: [], userId: "owner" }),
    );

  it("has no one-click delete button on the page itself", () => {
    const html = render("active");
    expect(html).not.toMatch(/<summary[^>]*>Delete this card/);
    // The only button that deletes lives in the confirmation sheet, and it is a danger button.
    const dialog = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
    const before = html.slice(0, html.indexOf("<dialog"));
    expect(before).not.toMatch(/>Delete<\/button>/);
    expect(dialog).toMatch(/<button[^>]*rc-btn-danger[^>]*>Delete<\/button>/);
    expect(dialog).not.toMatch(/btn-primary[^>]*>Delete</);
  });

  it("explains what is lost and lets the learner keep the card", () => {
    const html = render("active");
    expect(html).toContain("Delete this card?");
    for (const line of [
      "Its review history will be deleted.",
      "It won't come back if you regenerate cards.",
      "Your notes don't change.",
    ])
      expect(html).toContain(line.replaceAll("'", "&#x27;"));
    expect(html).toContain(">Keep it</button>");
  });

  it("offers to suspend instead only for a card that is in review", () => {
    expect(render("active")).toContain("Suspend instead");
    expect(render("candidate")).not.toContain("Suspend instead");
  });
});
