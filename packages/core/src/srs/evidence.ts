import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";

/** One saved, not undone, self-rated answer. Rating 1 is Again/Forgot; 2–4 report recall. */
export interface ReviewEvidenceEvent {
  cardId: string;
  rating: number;
  at: string;
  /** Server review order; feedback baselines compare against it. */
  order: number;
}

export interface ReviewEvidenceWindow {
  from: string;
  to: string;
  days: number;
  events: ReviewEvidenceEvent[];
}

/** PRD-PERS-03: owned answers in a bounded window, oldest first; undone answers are excluded. */
export async function reviewEvidence(
  db: Database | Tx,
  ctx: LearnerContext,
  options: { now?: Date; days?: number } = {},
): Promise<ReviewEvidenceWindow> {
  const now = options.now ?? new Date();
  const days = Math.min(90, Math.max(1, Math.trunc(options.days ?? 30)));
  const since = new Date(now.getTime() - days * 86400000);
  const rows = await db
    .selectFrom("srs.review_event")
    .leftJoin("srs.review_undo", "srs.review_undo.review_event_id", "srs.review_event.id")
    .select([
      "srs.review_event.card_id",
      "srs.review_event.rating",
      "srs.review_event.created_at",
      "srs.review_event.recorded_order",
    ])
    .where("srs.review_event.user_id", "=", ctx.userId)
    .where("srs.review_event.created_at", ">=", since)
    .where("srs.review_event.created_at", "<=", now)
    .where("srs.review_undo.id", "is", null)
    .orderBy("srs.review_event.recorded_order", "asc")
    .execute();
  const events = rows.map((row) => ({
    cardId: row.card_id,
    rating: row.rating,
    at: row.created_at.toISOString(),
    order: Number(row.recorded_order),
  }));
  return { from: since.toISOString(), to: now.toISOString(), days, events };
}
