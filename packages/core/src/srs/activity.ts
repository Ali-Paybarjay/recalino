import { sql } from "kysely";
import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";
export interface ReviewActivity {
  answers: number;
  differentCards: number;
  againAnswers: number;
  history: { day: string; answers: number; again: number }[];
  repeatedMistakes: { cardId: string; again: number }[];
}
export async function reviewActivity(
  db: Database | Tx,
  ctx: LearnerContext,
  options: { now?: Date; days?: number } = {},
): Promise<ReviewActivity> {
  const now = options.now ?? new Date(),
    days = Math.min(90, Math.max(1, options.days ?? 30));
  const since = new Date(now.getTime() - days * 86400000);
  const events = await db
    .selectFrom("srs.review_event")
    .leftJoin("srs.review_undo", "srs.review_undo.review_event_id", "srs.review_event.id")
    .select(["srs.review_event.card_id", "srs.review_event.rating"])
    .select(sql<string>`srs.review_event.study_day::text`.as("day"))
    .where("srs.review_event.user_id", "=", ctx.userId)
    .where("srs.review_event.created_at", ">=", since)
    .where("srs.review_event.created_at", "<=", now)
    .where("srs.review_undo.id", "is", null)
    .execute();
  const history = new Map<string, { day: string; answers: number; again: number }>(),
    mistakes = new Map<string, number>();
  for (const event of events) {
    const day = history.get(event.day) ?? { day: event.day, answers: 0, again: 0 };
    day.answers++;
    if (event.rating === 1) {
      day.again++;
      mistakes.set(event.card_id, (mistakes.get(event.card_id) ?? 0) + 1);
    }
    history.set(event.day, day);
  }
  return {
    answers: events.length,
    differentCards: new Set(events.map((event) => event.card_id)).size,
    againAnswers: events.filter((event) => event.rating === 1).length,
    history: [...history.values()].sort((a, b) => a.day.localeCompare(b.day)),
    repeatedMistakes: [...mistakes.entries()]
      .filter(([, again]) => again >= 2)
      .map(([cardId, again]) => ({ cardId, again })),
  };
}
