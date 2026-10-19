import { cardActionSchema } from "@recalino/core/card";
import { describe, expect, it } from "vitest";
import { cardActionBody, undoBody } from "./card-actions";

// UX-03: Reject can be taken back with the server's own, idempotent `undo` action.
describe("card action requests", () => {
  it("sends the card's version with every action, so a stale page fails loudly", () => {
    expect(cardActionBody({ contentVersion: 4 }, "reject")).toEqual({
      expectedVersion: 4,
      action: "reject",
      confirmQuality: true,
    });
  });

  it("undoes the rejected version, not the one before it", () => {
    // Reject moved the card from version 3 to version 4; Undo names version 4.
    expect(undoBody({ contentVersion: 4 })).toEqual({ expectedVersion: 4, action: "undo" });
  });

  it("builds requests the server accepts", () => {
    expect(() => cardActionSchema.parse(undoBody({ contentVersion: 2 }))).not.toThrow();
    expect(() =>
      cardActionSchema.parse(cardActionBody({ contentVersion: 2 }, "reject")),
    ).not.toThrow();
  });
});
