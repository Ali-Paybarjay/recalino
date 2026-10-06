import { type Selectable, sql } from "kysely";
import {
  type CardInput,
  createEmptyCard,
  type Card as FsrsCard,
  fsrs,
  type Grade,
  generatorParameters,
  Rating,
  State,
  TypeConvert,
} from "ts-fsrs";
import { z } from "zod";
import { getAccountState, lockAccount } from "../acc";
import {
  getActiveCard,
  getCard,
  isCardReviewable,
  learningItemIdsForOwnedCards,
  listCards,
  type StudyCard,
} from "../card";
import type { Database, DB, Tx } from "../db";
import {
  assertOwner,
  canonicalJson,
  errors,
  type LearnerContext,
  readPltSettings,
  resolveTimeZone,
  sha256Hex,
  studyDay,
} from "../plt";
import {
  DEFAULT_REVIEW_SETTINGS,
  type ReviewInput,
  type ReviewQueueQuery,
  type ReviewSettings,
  type ReviewStudySet,
  reviewInputSchema,
  reviewQueueQuerySchema,
  reviewSettingsSchema,
} from "./schema";

export const SRS_ALGORITHM = "FSRS6/ts-fsrs@5.4.2";
export interface CardSchedule {
  cardId: string;
  version: number;
  state: FsrsCard;
  dueAt: string;
  introducedAt: string | null;
}
export interface ReviewQueue {
  cards: { card: StudyCard; schedule: CardSchedule }[];
  /** Active reviewable groups before quota selection and truncation, including future cards. */
  availableStudySets: ReviewStudySet[];
  studySet?: ReviewStudySet;
  dueCount: number;
  newRemaining: number;
  buriedSiblings: number;
  nextDueAt: string | null;
  studyDay: string;
  timezone: string;
  settings: ReviewSettings;
}
export interface ReviewReceipt {
  eventId: string;
  cardId: string;
  version: number;
  dueAt: string;
  rating: number;
  studyDay: string;
}
const storedCardSchema = z.object({
  due: z.iso.datetime(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  learning_steps: z.number(),
  reps: z.number(),
  lapses: z.number(),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  last_review: z.iso.datetime().optional(),
});
function decodeState(value: unknown): FsrsCard {
  return TypeConvert.card(storedCardSchema.parse(value) as CardInput);
}
function schedule(row: Selectable<DB["srs.card_state"]>): CardSchedule {
  return {
    cardId: row.card_id,
    version: row.version,
    state: decodeState(row.state),
    dueAt: row.due_at.toISOString(),
    introducedAt: row.introduced_at?.toISOString() ?? null,
  };
}
function fresh(card: StudyCard): CardSchedule {
  const state = createEmptyCard(card.createdAt);
  return { cardId: card.id, version: 0, state, dueAt: state.due.toISOString(), introducedAt: null };
}
export function schedulerParameters(retention: number) {
  return generatorParameters({
    request_retention: retention,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"],
  });
}
export function ratingFor(mode: "simple" | "advanced", choice: string): Grade {
  if (mode === "simple") {
    if (choice === "forgot") return Rating.Again;
    if (choice === "remembered") return Rating.Good;
  } else {
    if (choice === "again") return Rating.Again;
    if (choice === "hard") return Rating.Hard;
    if (choice === "good") return Rating.Good;
    if (choice === "easy") return Rating.Easy;
  }
  throw errors.validationFailed({ choice: ["does_not_match_mode"] });
}
export async function getReviewSettings(
  db: Database | Tx,
  ctx: LearnerContext,
): Promise<ReviewSettings> {
  const row = await db
    .selectFrom("srs.settings")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .executeTakeFirst();
  return row
    ? {
        mode: row.mode === "advanced" ? "advanced" : "simple",
        desiredRetention: row.desired_retention,
        dailyNewLimit: row.daily_new_limit,
        timeBudgetMinutes: row.time_budget_minutes,
      }
    : { ...DEFAULT_REVIEW_SETTINGS };
}
export async function updateReviewSettings(
  db: Database,
  ctx: LearnerContext,
  input: ReviewSettings,
  now = new Date(),
): Promise<ReviewSettings> {
  const parsed = reviewSettingsSchema.parse(input);
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    await tx
      .insertInto("srs.settings")
      .values({
        user_id: ctx.userId,
        mode: parsed.mode,
        desired_retention: parsed.desiredRetention,
        daily_new_limit: parsed.dailyNewLimit,
        time_budget_minutes: parsed.timeBudgetMinutes,
        updated_at: now,
      })
      .onConflict((conflict) =>
        conflict.column("user_id").doUpdateSet({
          mode: parsed.mode,
          desired_retention: parsed.desiredRetention,
          daily_new_limit: parsed.dailyNewLimit,
          time_budget_minutes: parsed.timeBudgetMinutes,
          updated_at: now,
        }),
      )
      .execute();
  });
  return parsed;
}
async function dayContext(db: Database | Tx, ctx: LearnerContext, now: Date) {
  const account = await getAccountState(db, ctx.userId);
  if (!account) throw errors.notFound();
  const timezone = resolveTimeZone(account.timezone).timeZone;
  return { timezone, day: studyDay(now, timezone, readPltSettings().studyDayStartHour) };
}
async function todayEvents(db: Database | Tx, ctx: LearnerContext, day: string) {
  const events = await db
    .selectFrom("srs.review_event")
    .leftJoin("srs.review_undo", "srs.review_undo.review_event_id", "srs.review_event.id")
    .select(["srs.review_event.card_id", "srs.review_event.is_new"])
    .where("srs.review_event.user_id", "=", ctx.userId)
    .where("srs.review_event.study_day", "=", sql<Date>`${day}::date`)
    .where("srs.review_undo.id", "is", null)
    .execute();
  const owned = new Map(
    (
      await learningItemIdsForOwnedCards(
        db,
        ctx,
        events.map((event) => event.card_id),
      )
    ).map((item) => [item.cardId, item.learningItemId]),
  );
  return events.flatMap((event) => {
    const learningItemId = owned.get(event.card_id);
    return learningItemId ? [{ ...event, learning_item_id: learningItemId }] : [];
  });
}
export async function getReviewQueue(
  db: Database | Tx,
  ctx: LearnerContext,
  options: ReviewQueueQuery & { now?: Date; limit?: number } = {},
): Promise<ReviewQueue> {
  const selection = reviewQueueQuerySchema.parse({
    sessionId: options.sessionId,
    studySet: options.studySet,
  });
  const now = options.now ?? new Date();
  const [cards, rows, settings, local] = await Promise.all([
    listCards(db, ctx, { sessionId: selection.sessionId, status: "active" }),
    db.selectFrom("srs.card_state").selectAll().where("user_id", "=", ctx.userId).execute(),
    getReviewSettings(db, ctx),
    dayContext(db, ctx, now),
  ]);
  const events = await todayEvents(db, ctx, local.day);
  const newRemaining = Math.max(
    0,
    settings.dailyNewLimit - events.filter((event) => event.is_new).length,
  );
  const schedules = new Map(rows.map((row) => [row.card_id, schedule(row)]));
  const reviewedItems = new Map<string, Set<string>>();
  for (const event of events) {
    const ids = reviewedItems.get(event.learning_item_id) ?? new Set();
    ids.add(event.card_id);
    reviewedItems.set(event.learning_item_id, ids);
  }
  const due: ReviewQueue["cards"] = [];
  const newCards: ReviewQueue["cards"] = [];
  const future: number[] = [];
  const available = new Set<ReviewStudySet>();
  let buriedSiblings = 0;
  for (const card of cards) {
    if (!(await isCardReviewable(db, ctx, card))) continue;
    const studySet = card.studySet ?? "legacy";
    available.add(studySet);
    // Choose the set before applying the shared daily new-card allowance or the page limit.
    if (selection.studySet && studySet !== selection.studySet) continue;
    const current = schedules.get(card.id) ?? fresh(card);
    const siblings = reviewedItems.get(card.learningItemId);
    if (siblings && [...siblings].some((id) => id !== card.id)) {
      buriedSiblings++;
      continue;
    }
    if (!current.introducedAt) newCards.push({ card, schedule: current });
    else if (new Date(current.dueAt).getTime() <= now.getTime())
      due.push({ card, schedule: current });
    else future.push(new Date(current.dueAt).getTime());
  }
  due.sort(
    (a, b) =>
      Number(b.schedule.state.state !== State.Review) -
        Number(a.schedule.state.state !== State.Review) ||
      a.schedule.dueAt.localeCompare(b.schedule.dueAt) ||
      a.card.id.localeCompare(b.card.id),
  );
  const queue = [...due];
  const seenItems = new Set(due.map((item) => item.card.learningItemId));
  for (const item of newCards) {
    if (queue.length - due.length >= newRemaining) break;
    if (seenItems.has(item.card.learningItemId)) {
      buriedSiblings++;
      continue;
    }
    queue.push(item);
    seenItems.add(item.card.learningItemId);
  }
  return {
    cards: queue.slice(0, Math.min(100, Math.max(1, options.limit ?? 30))),
    availableStudySets: (["production", "recognition", "legacy"] as const).filter((set) =>
      available.has(set),
    ),
    ...(selection.studySet ? { studySet: selection.studySet } : {}),
    dueCount: due.length,
    newRemaining,
    buriedSiblings,
    nextDueAt: future.length ? new Date(Math.min(...future)).toISOString() : null,
    studyDay: local.day,
    timezone: local.timezone,
    settings,
  };
}
export async function submitReview(
  db: Database,
  ctx: LearnerContext,
  input: ReviewInput,
  now = new Date(),
): Promise<ReviewReceipt> {
  const parsed = reviewInputSchema.parse(input);
  const hash = sha256Hex(canonicalJson(parsed));
  const grade = ratingFor(parsed.mode, parsed.choice);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const replay = await tx
      .selectFrom("srs.review_event")
      .selectAll()
      .select(sql<string>`study_day::text`.as("study_day_text"))
      .where("id", "=", parsed.eventId)
      .executeTakeFirst();
    if (replay) {
      assertOwner({ ownerId: replay.user_id }, ctx);
      await getCard(tx, ctx, replay.card_id);
      if (replay.request_hash !== hash) throw errors.idempotencyMismatch();
      const after = replay.after_state as unknown as CardSchedule;
      return {
        eventId: replay.id,
        cardId: replay.card_id,
        version: after.version,
        dueAt: after.dueAt,
        rating: replay.rating,
        studyDay: replay.study_day_text,
      };
    }
    const card = await getActiveCard(tx, ctx, parsed.cardId, true);
    const [settings, local] = await Promise.all([
      getReviewSettings(tx, ctx),
      dayContext(tx, ctx, now),
    ]);
    const parameters = schedulerParameters(settings.desiredRetention);
    await tx
      .insertInto("srs.card_state")
      .values({
        card_id: card.id,
        user_id: ctx.userId,
        state: JSON.stringify(fresh(card).state),
        due_at: new Date(card.createdAt),
        parameters: JSON.stringify(parameters),
        updated_at: now,
      })
      .onConflict((conflict) => conflict.column("card_id").doNothing())
      .execute();
    const row = await tx
      .selectFrom("srs.card_state")
      .selectAll()
      .where("card_id", "=", card.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const before = schedule(row);
    if (
      before.version !== parsed.expectedVersion ||
      card.contentVersion !== parsed.expectedContentVersion
    )
      throw errors.conflict();
    if (before.introducedAt && new Date(before.dueAt).getTime() > now.getTime())
      throw errors.validationFailed({ card: ["not_due"] });
    const events = await todayEvents(tx, ctx, local.day);
    if (
      !before.introducedAt &&
      events.filter((event) => event.is_new).length >= settings.dailyNewLimit
    )
      throw errors.validationFailed({ card: ["daily_new_limit"] });
    if (
      events.some(
        (event) => event.learning_item_id === card.learningItemId && event.card_id !== card.id,
      )
    )
      throw errors.validationFailed({ card: ["sibling_deferred"] });
    const next = fsrs(parameters).next(before.state, now, grade).card;
    const after: CardSchedule = {
      cardId: card.id,
      version: before.version + 1,
      state: next,
      dueAt: next.due.toISOString(),
      introducedAt: before.introducedAt ?? now.toISOString(),
    };
    await tx
      .updateTable("srs.card_state")
      .set({
        version: after.version,
        state: JSON.stringify(next),
        due_at: next.due,
        introduced_at: new Date(after.introducedAt as string),
        algorithm: SRS_ALGORITHM,
        parameters: JSON.stringify(parameters),
        updated_at: now,
      })
      .where("card_id", "=", card.id)
      .execute();
    await tx
      .insertInto("srs.review_event")
      .values({
        id: parsed.eventId,
        user_id: ctx.userId,
        card_id: card.id,
        expected_version: before.version,
        request_hash: hash,
        rating: grade,
        mode: parsed.mode,
        duration_ms: parsed.durationMs,
        study_day: local.day,
        timezone: local.timezone,
        is_new: !before.introducedAt,
        before_state: JSON.stringify(before),
        after_state: JSON.stringify(after),
        algorithm: SRS_ALGORITHM,
        parameters: JSON.stringify(parameters),
        created_at: now,
      })
      .execute();
    return {
      eventId: parsed.eventId,
      cardId: card.id,
      version: after.version,
      dueAt: after.dueAt,
      rating: grade,
      studyDay: local.day,
    };
  });
}
export async function undoReview(
  db: Database,
  ctx: LearnerContext,
  eventId: string,
  expectedVersion: number,
  now = new Date(),
): Promise<{ eventId: string; version: number }> {
  z.uuid().parse(eventId);
  z.int().nonnegative().parse(expectedVersion);
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const event = await tx
      .selectFrom("srs.review_event")
      .selectAll()
      .where("id", "=", eventId)
      .executeTakeFirst();
    assertOwner(event ? { ownerId: event.user_id } : undefined, ctx);
    if (!event) throw errors.notFound();
    const card = await getCard(tx, ctx, event.card_id, true);
    const priorUndo = await tx
      .selectFrom("srs.review_undo")
      .selectAll()
      .where("review_event_id", "=", eventId)
      .executeTakeFirst();
    if (priorUndo) return { eventId, version: priorUndo.resulting_version };
    const last = await tx
      .selectFrom("srs.review_event")
      .leftJoin("srs.review_undo", "srs.review_undo.review_event_id", "srs.review_event.id")
      .select("srs.review_event.id")
      .where("srs.review_event.user_id", "=", ctx.userId)
      .where("srs.review_undo.id", "is", null)
      .orderBy("srs.review_event.recorded_order", "desc")
      .limit(1)
      .executeTakeFirst();
    const row = await tx
      .selectFrom("srs.card_state")
      .selectAll()
      .where("card_id", "=", card.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (
      last?.id !== eventId ||
      row.version !== expectedVersion ||
      row.version !== event.expected_version + 1
    )
      throw errors.conflict();
    const before = event.before_state as unknown as CardSchedule;
    const restored = decodeState(before.state);
    const version = row.version + 1;
    await tx
      .updateTable("srs.card_state")
      .set({
        version,
        state: JSON.stringify(restored),
        due_at: restored.due,
        introduced_at: before.introducedAt ? new Date(before.introducedAt) : null,
        updated_at: now,
      })
      .where("card_id", "=", card.id)
      .execute();
    await tx
      .insertInto("srs.review_undo")
      .values({
        user_id: ctx.userId,
        review_event_id: eventId,
        resulting_version: version,
        created_at: now,
      })
      .execute();
    return { eventId, version };
  });
}
