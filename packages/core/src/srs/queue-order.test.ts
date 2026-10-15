import { expect, it } from "vitest";
import { orderNewCards } from "./queue-order";
import { DEFAULT_REVIEW_SETTINGS } from "./schema";

function card(
  id: string,
  session: string,
  createdAt: string,
  studySet?: "production" | "recognition",
) {
  return { card: { id, sessionIds: [session], createdAt, studySet } };
}
const ids = (items: { card: { id: string } }[]) => items.map((item) => item.card.id);

it("D78: offers new cards from the most recently generated session first", () => {
  const older = [
    card("a1", "s-old", "2026-10-01T10:00:00.000Z"),
    card("a2", "s-old", "2026-10-01T10:00:00.000Z"),
  ];
  const newer = [
    card("b1", "s-new", "2026-10-08T10:00:00.000Z"),
    card("b2", "s-new", "2026-10-08T10:00:01.000Z"),
  ];
  const all = [...older, ...newer];
  expect(
    ids(
      orderNewCards(
        all,
        all.map((item) => item.card),
      ),
    ),
  ).toEqual(["b1", "b2", "a1", "a2"]);
});

it("D78: dates a session by its first card, so a later card does not move it forward", () => {
  const all = [
    card("a1", "s-old", "2026-10-01T10:00:00.000Z"),
    card("b1", "s-new", "2026-10-08T10:00:00.000Z"),
    card("a9", "s-old", "2026-10-12T10:00:00.000Z"),
  ];
  expect(
    ids(
      orderNewCards(
        all,
        all.map((item) => item.card),
      ),
    ),
  ).toEqual(["b1", "a1", "a9"]);
});

it("D78: dates a session from all its active cards, not only the new ones", () => {
  const introduced = card("a0", "s-old", "2026-10-01T10:00:00.000Z").card;
  const fresh = [
    card("a5", "s-old", "2026-10-10T10:00:00.000Z"),
    card("b1", "s-new", "2026-10-08T10:00:00.000Z"),
  ];
  expect(ids(orderNewCards(fresh, [introduced, ...fresh.map((item) => item.card)]))).toEqual([
    "b1",
    "a5",
  ]);
});

it("D78: keeps core cards before supplementary and older cards within a session, then its own order", () => {
  const at = "2026-10-08T10:00:00.000Z";
  const all = [
    card("r1", "s", at, "recognition"),
    card("l1", "s", at),
    card("p1", "s", at, "production"),
    card("r2", "s", at, "recognition"),
    card("p2", "s", at, "production"),
  ];
  expect(
    ids(
      orderNewCards(
        all,
        all.map((item) => item.card),
      ),
    ),
  ).toEqual(["p1", "p2", "r1", "r2", "l1"]);
});

it("D78: starts with up to 20 new cards per study day", () => {
  expect(DEFAULT_REVIEW_SETTINGS.dailyNewLimit).toBe(20);
});
