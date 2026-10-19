import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { queryBudgetDatabase } from "../../test/query-budget";
import { isCardReviewableWith, reviewableCardIds, type StudyCard } from "./cards";

// PERF-02: the review queue decides which listening cards have their audio in a constant number
// of owner-scoped reads, whatever the number of cards.
const ctx = { userId: randomUUID(), requestId: "reviewable-read-budget" };
const session = randomUUID();

function card(template: StudyCard["template"], frontMediaId: string | null = null): StudyCard {
  return {
    id: randomUUID(),
    ownerId: ctx.userId,
    learningItemId: randomUUID(),
    sessionIds: [session],
    template,
    direction: "forward",
    front: "front",
    back: "back",
    provenance: {} as StudyCard["provenance"],
    status: "active",
    contentVersion: 1,
    important: false,
    qualityConfirmed: false,
    frontMediaId,
    backMediaId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function mediaRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user_id: ctx.userId,
    session_id: session,
    kind: "tts",
    state: "ready",
    object_id: randomUUID(),
    mime_type: "audio/mpeg",
    source_id: null,
    synthetic: true,
    export_allowed: false,
    last_error: null,
    created_at: new Date(0),
    tombstoned_at: null,
    ...overrides,
  };
}

describe("reviewable cards read budget (PERF-02)", () => {
  it.each([10, 50])("reads the audio of %i listening cards in one media query", async (count) => {
    const listening = Array.from({ length: count }, () => card("listening", randomUUID()));
    const cards = [card("basic"), ...listening, card("listening")];
    const { db, queries } = queryBudgetDatabase([
      listening.map((item) => mediaRow(item.frontMediaId as string)),
      [{ id: session }],
    ]);
    const reviewable = await reviewableCardIds(db, ctx, cards);
    expect(queries).toHaveLength(2);
    expect(queries[0]?.sql).toContain('from "media"."asset"');
    expect(queries[0]?.sql).toContain('"user_id" = $1');
    expect(queries[0]?.parameters).toContain(ctx.userId);
    expect(queries[1]?.sql).toContain('from "org"."class_session"');
    // The basic card and every listening card with ready audio; not the one without audio.
    expect(reviewable.size).toBe(count + 1);
    expect(reviewable.has(cards[cards.length - 1]?.id as string)).toBe(false);
  });

  it("omits audio on a deleted session or a deleted source, as one card read would", async () => {
    const onDeletedSession = card("listening", randomUUID());
    const fromDeletedSource = card("listening", randomUUID());
    const fromLiveSource = card("listening", randomUUID());
    const otherSession = randomUUID();
    const deletedSource = randomUUID();
    const liveSource = randomUUID();
    const { db, queries } = queryBudgetDatabase([
      [
        mediaRow(onDeletedSession.frontMediaId as string, { session_id: otherSession }),
        mediaRow(fromDeletedSource.frontMediaId as string, { source_id: deletedSource }),
        mediaRow(fromLiveSource.frontMediaId as string, { source_id: liveSource }),
      ],
      [{ id: session }],
      [{ id: liveSource }],
    ]);
    const reviewable = await reviewableCardIds(db, ctx, [
      onDeletedSession,
      fromDeletedSource,
      fromLiveSource,
    ]);
    expect(queries).toHaveLength(3);
    expect(queries[2]?.sql).toContain('from "src"."asset"');
    expect([...reviewable]).toEqual([fromLiveSource.id]);
  });

  it("reads nothing when no card needs audio", async () => {
    const { db, queries } = queryBudgetDatabase([]);
    const cards = [card("basic"), card("listening")];
    expect([...(await reviewableCardIds(db, ctx, cards))]).toEqual([cards[0]?.id]);
    expect(queries).toHaveLength(0);
  });

  it("accepts only ready computer-voice audio of the card's own session", () => {
    const listening = card("listening", randomUUID());
    const asset = {
      id: listening.frontMediaId as string,
      sessionId: session,
      kind: "tts" as const,
      state: "ready" as const,
      objectId: randomUUID(),
      mimeType: "audio/mpeg",
      sourceId: null,
      synthetic: true,
      exportAllowed: false,
      lastError: null,
      createdAt: new Date(0).toISOString(),
    };
    expect(isCardReviewableWith(card("basic"), undefined)).toBe(true);
    expect(isCardReviewableWith(listening, asset)).toBe(true);
    expect(isCardReviewableWith(listening, undefined)).toBe(false);
    expect(isCardReviewableWith(listening, { ...asset, state: "queued" })).toBe(false);
    expect(isCardReviewableWith(listening, { ...asset, kind: "image" })).toBe(false);
    expect(isCardReviewableWith(listening, { ...asset, objectId: null })).toBe(false);
    expect(isCardReviewableWith(listening, { ...asset, mimeType: "image/png" })).toBe(false);
    expect(isCardReviewableWith(listening, { ...asset, sessionId: randomUUID() })).toBe(false);
    expect(isCardReviewableWith(listening, { ...asset, id: randomUUID() })).toBe(false);
  });
});
