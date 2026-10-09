import { z } from "zod";
import { getAccountState, lockAccount } from "../acc";
import { assertOwnedLearningGoal, listCards, ownedLearningGoals, type StudyCard } from "../card";
import type { Database, Tx } from "../db";
import { cardHtmlToText, studyLexicalTarget } from "../lkm";
import { getNotebook } from "../note";
import { getCourse, getSession } from "../org";
import {
  canonicalJson,
  errors,
  isValidIdempotencyKey,
  type LearnerContext,
  resolveTimeZone,
  sha256Hex,
} from "../plt";
import type { PracticeCandidate } from "../proc";
import { cardsOfferedForReview, reviewEvidence } from "../srs";
import {
  currentFeedback,
  deriveLearningMemory,
  type FeedbackKind,
  type LearningMemory,
  localDate,
  MEMORY_WINDOW_DAYS,
  type MemoryCardInput,
  type MemoryFeedbackInput,
  type MemoryGoalInput,
  summariseGoalEvents,
} from "./memory-rules";

const LABEL_LIMIT = 160;
const MAX_RUN_CANDIDATES = 8;

function clip(value: string, limit = LABEL_LIMIT): string {
  const characters = Array.from(value.replace(/\s+/g, " ").trim());
  return characters.length > limit
    ? `${characters.slice(0, limit - 1).join("")}…`
    : characters.join("");
}

function memoryCard(card: StudyCard): MemoryCardInput {
  return {
    cardId: card.id,
    learningItemId: card.learningItemId,
    status: card.status,
    studySet: card.studySet ?? "legacy",
    // Card faces are rendered markup; only a structured target or extracted text is a label.
    fallbackLabel: clip(card.pronunciationTarget ?? cardHtmlToText(card.front)),
  };
}

/** Corrections of goals with evidence, plus every "explain more simply" row: a request stands. */
async function feedbackRows(
  db: Database | Tx,
  ctx: LearnerContext,
  evidencedGoalIds: readonly string[],
): Promise<MemoryFeedbackInput[]> {
  const ids = [...new Set(evidencedGoalIds)];
  const rows = await db
    .selectFrom("pers.item_feedback")
    .select(["learning_item_id", "kind", "active", "evidence_order", "created_at"])
    .where("user_id", "=", ctx.userId)
    .where((eb) =>
      ids.length
        ? eb.or([eb("learning_item_id", "in", ids), eb("kind", "=", "explain_simpler")])
        : eb("kind", "=", "explain_simpler"),
    )
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .execute();
  return rows.map((row) => ({
    learningItemId: row.learning_item_id,
    kind: row.kind === "explain_simpler" ? "explain_simpler" : "not_a_difficulty",
    active: row.active,
    evidenceOrder: row.evidence_order === null ? null : Number(row.evidence_order),
    createdAt: row.created_at.toISOString(),
  }));
}

/** Labels come from the learner's current published notes for that class, as plain text. */
async function goalContext(
  db: Database | Tx,
  ctx: LearnerContext,
  learningItemIds: readonly string[],
): Promise<MemoryGoalInput[]> {
  const goals = await ownedLearningGoals(db, ctx, learningItemIds);
  const sessions = new Map<string, Awaited<ReturnType<typeof sessionContext>> | null>();
  for (const goal of goals)
    if (goal.sessionId && !sessions.has(goal.sessionId))
      sessions.set(goal.sessionId, await sessionContext(db, ctx, goal.sessionId));
  return goals.map((goal) => {
    const session = goal.sessionId ? sessions.get(goal.sessionId) : null;
    const item = session?.items.get(goal.itemId ?? "");
    const label = item ? (item.study?.en ?? item.front) : null;
    const meaning = item ? (item.study?.faMeaning ?? item.back) : null;
    return {
      learningItemId: goal.learningItemId,
      sessionId: session ? goal.sessionId : null,
      itemId: session ? goal.itemId : null,
      label: label ? clip(label) : null,
      meaning: meaning ? clip(meaning, 240) : null,
      explanationLanguage: session?.explanationLanguage ?? null,
      classDate: session?.classDate ?? null,
      classTitle: session?.title ?? null,
      courseId: session?.courseId ?? null,
      courseName: session?.courseName ?? null,
    };
  });
}

async function sessionContext(db: Database | Tx, ctx: LearnerContext, sessionId: string) {
  try {
    const session = await getSession(db, ctx, sessionId);
    const course = await getCourse(db, ctx, session.courseId);
    const notebook = await getNotebook(db, ctx, sessionId);
    return {
      classDate: session.classDate,
      title: session.displayTitle,
      courseId: course.id,
      courseName: course.isDefault ? null : course.name,
      explanationLanguage: notebook?.current.model.language.explanation ?? null,
      items: new Map((notebook?.current.model.learningItems ?? []).map((item) => [item.id, item])),
    };
  } catch (error) {
    // A class being deleted is no longer part of the learner's visible memory.
    if (error instanceof Error && "code" in error && error.code === "not_found") return null;
    throw error;
  }
}

/** PRD-PERS-03/05, D49: evidence-backed practice notes; computed on read, never by a model. */
export async function learningMemory(
  db: Database | Tx,
  ctx: LearnerContext,
  options: { now?: Date; dueCount?: number; nextDueAt?: string | null; limit?: number } = {},
): Promise<LearningMemory> {
  const now = options.now ?? new Date();
  const [evidence, cards] = await Promise.all([
    reviewEvidence(db, ctx, { now, days: MEMORY_WINDOW_DAYS }),
    listCards(db, ctx),
  ]);
  const evidenced = new Set(evidence.events.map((event) => event.cardId));
  const evidencedGoals = new Set(
    cards.filter((card) => evidenced.has(card.id)).map((card) => card.learningItemId),
  );
  const feedback = await feedbackRows(db, ctx, [...evidencedGoals]);
  const requested = [...currentFeedback(feedback)]
    .filter(([, current]) => current.explain_simpler?.active)
    .map(([learningItemId]) => learningItemId);
  const goalIds = new Set([...evidencedGoals, ...requested]);
  // Every card of a shown goal, so a sibling that is due can carry the practice link.
  const relevant = cards.filter((card) => goalIds.has(card.learningItemId));
  const goals = await goalContext(db, ctx, [...goalIds]);
  const offered = await cardsOfferedForReview(db, ctx, relevant, now);
  return deriveLearningMemory({
    window: { from: evidence.from, to: evidence.to, days: evidence.days },
    cards: relevant.map(memoryCard),
    events: evidence.events,
    offered,
    goals,
    feedback,
    dueCount: options.dueCount ?? 0,
    nextDueAt: options.nextDueAt ?? null,
    hasCards: cards.some((card) => card.status === "active" || card.status === "known"),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
}

/**
 * D49 phase 3: a bounded, explainable selection snapshotted when a class run starts.
 * Only this class and other classes of the same course are eligible; the worker keeps a
 * same-course point only when its exact target occurs in this class's extracted text.
 * The full lists are scoped before the bound, so another course's items never crowd out
 * this course's points. Dates are the learner's local dates of the recorded evidence.
 */
export async function practiceCandidatesForRun(
  tx: Tx,
  ctx: LearnerContext,
  input: { sessionId: string; now?: Date },
): Promise<PracticeCandidate[]> {
  const session = await getSession(tx, ctx, input.sessionId);
  const account = await getAccountState(tx, ctx.userId);
  const timeZone = resolveTimeZone(account?.timezone).timeZone;
  const memory = await learningMemory(tx, ctx, {
    ...(input.now ? { now: input.now } : {}),
    limit: Number.POSITIVE_INFINITY,
  });
  const scopeOf = (item: { sessionId: string | null; courseId: string | null; label: string }) =>
    !item.sessionId || !item.courseId || !studyLexicalTarget(item.label)
      ? undefined
      : item.sessionId === session.id
        ? "this_class"
        : item.courseId === session.courseId
          ? "same_course"
          : undefined;
  const candidates: (PracticeCandidate & { order: number })[] = [];
  const chosen = new Set<string>();
  // needsPractice already leaves out dismissed and marked-known goals.
  for (const item of memory.needsPractice) {
    const scope = scopeOf(item);
    if (!scope || !item.sessionId) continue;
    chosen.add(item.learningItemId);
    candidates.push({
      target: item.label,
      reason: "recall_difficulty",
      scope,
      againCount: item.evidence.again,
      lastEvidenceDate: localDate(
        item.evidence.lastAgainAt ?? item.evidence.lastReviewedAt,
        timeZone,
      ),
      sourceSessionId: item.sessionId,
      order: scope === "this_class" ? 0 : 1,
    });
  }
  // An explicit "explain more simply" request counts until withdrawn, even after recall recovered.
  for (const request of memory.simplerRequests) {
    const scope = scopeOf(request);
    if (!scope || !request.sessionId || chosen.has(request.learningItemId)) continue;
    candidates.push({
      target: request.label,
      reason: "asked_simpler",
      scope,
      // Only recall_difficulty carries an Again count; a request is not review evidence.
      againCount: 0,
      lastEvidenceDate: localDate(request.askedAt, timeZone),
      sourceSessionId: request.sessionId,
      order: scope === "this_class" ? 0 : 1,
    });
  }
  return candidates
    .sort(
      (a, b) =>
        a.order - b.order ||
        b.lastEvidenceDate.localeCompare(a.lastEvidenceDate) ||
        a.target.localeCompare(b.target),
    )
    .filter(
      (candidate, index, list) =>
        list.findIndex((other) => other.target.toLowerCase() === candidate.target.toLowerCase()) ===
        index,
    )
    .slice(0, MAX_RUN_CANDIDATES)
    .map(({ order: _order, ...candidate }) => candidate);
}

export const itemFeedbackSchema = z.strictObject({
  learningItemId: z.uuid(),
  kind: z.enum(["not_a_difficulty", "explain_simpler"]),
  active: z.boolean(),
  /** The latest Again the learner was shown when dismissing; a newer one keeps the note open. */
  shownLastAgainAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type ItemFeedbackInput = z.infer<typeof itemFeedbackSchema>;

/** D49: append-only learner corrections; the same key replays without a second effect. */
export async function recordItemFeedback(
  db: Database,
  ctx: LearnerContext,
  raw: unknown,
  options: { key: string; now?: Date },
): Promise<{ replayed: boolean }> {
  if (!isValidIdempotencyKey(options.key))
    throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  const input = itemFeedbackSchema.parse(raw);
  const requestHash = sha256Hex(canonicalJson(input));
  const now = options.now ?? new Date();
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const previous = await tx
      .selectFrom("pers.item_feedback")
      .select("request_hash")
      .where("user_id", "=", ctx.userId)
      .where("operation_key", "=", options.key)
      .executeTakeFirst();
    if (previous) {
      if (previous.request_hash !== requestHash) throw errors.idempotencyMismatch();
      return { replayed: true };
    }
    const goal = await assertOwnedLearningGoal(tx, ctx, input.learningItemId);
    // Only a class goal can shape a later class run; a request elsewhere would promise nothing.
    if (input.kind === "explain_simpler" && input.active && !goal.sessionId)
      throw errors.validationFailed({ kind: ["not_applicable"] });
    // The baseline is the goal's latest answer when the correction is saved.
    const [evidence, cards] = await Promise.all([
      reviewEvidence(tx, ctx, { now, days: MEMORY_WINDOW_DAYS }),
      listCards(tx, ctx),
    ]);
    const cardIds = new Set(
      cards.filter((card) => card.learningItemId === goal.learningItemId).map((card) => card.id),
    );
    const summary = summariseGoalEvents(
      evidence.events.filter((event) => cardIds.has(event.cardId)),
    );
    let baseline = summary?.lastOrder ?? null;
    // An Again saved after the page the learner corrected (another tab or device) is not
    // something they dismissed: the baseline stays below it, so the note stays open.
    if (
      input.kind === "not_a_difficulty" &&
      input.active &&
      input.shownLastAgainAt !== undefined &&
      summary?.lastAgainAt &&
      summary.lastAgainOrder !== null &&
      (input.shownLastAgainAt === null ||
        Date.parse(summary.lastAgainAt) > Date.parse(input.shownLastAgainAt))
    )
      baseline = Math.max(0, summary.lastAgainOrder - 1);
    // The account lock serialises a learner's corrections; a strictly increasing time keeps
    // "the latest row wins" independent of the random row id when two share a millisecond.
    const latest = await tx
      .selectFrom("pers.item_feedback")
      .select("created_at")
      .where("user_id", "=", ctx.userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
    const createdAt =
      latest && latest.created_at.getTime() >= now.getTime()
        ? new Date(latest.created_at.getTime() + 1)
        : now;
    await tx
      .insertInto("pers.item_feedback")
      .values({
        user_id: ctx.userId,
        learning_item_id: goal.learningItemId,
        session_id: goal.sessionId,
        kind: input.kind satisfies FeedbackKind,
        active: input.active,
        evidence_order: baseline,
        operation_key: options.key,
        request_hash: requestHash,
        created_at: createdAt,
      })
      .execute();
    return { replayed: false };
  });
}
