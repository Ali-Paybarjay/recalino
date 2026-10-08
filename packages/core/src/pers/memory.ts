import { z } from "zod";
import { lockAccount } from "../acc";
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
  sha256Hex,
} from "../plt";
import type { PracticeCandidate } from "../proc";
import { reviewEvidence } from "../srs";
import {
  deriveLearningMemory,
  type FeedbackKind,
  type LearningMemory,
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

async function feedbackRows(
  db: Database | Tx,
  ctx: LearnerContext,
  learningItemIds: readonly string[],
): Promise<MemoryFeedbackInput[]> {
  if (!learningItemIds.length) return [];
  const rows = await db
    .selectFrom("pers.item_feedback")
    .select(["learning_item_id", "kind", "active", "evidence_order", "created_at"])
    .where("user_id", "=", ctx.userId)
    .where("learning_item_id", "in", [...new Set(learningItemIds)])
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

/** PRD-PERS-03/05, D48: evidence-backed practice notes; computed on read, never by a model. */
export async function learningMemory(
  db: Database | Tx,
  ctx: LearnerContext,
  options: { now?: Date; dueCount?: number; nextDueAt?: string | null } = {},
): Promise<LearningMemory> {
  const now = options.now ?? new Date();
  const [evidence, cards] = await Promise.all([
    reviewEvidence(db, ctx, { now, days: MEMORY_WINDOW_DAYS }),
    listCards(db, ctx),
  ]);
  const evidenced = new Set(evidence.events.map((event) => event.cardId));
  const relevant = cards.filter((card) => evidenced.has(card.id));
  const learningItemIds = [...new Set(relevant.map((card) => card.learningItemId))];
  const [goals, feedback] = await Promise.all([
    goalContext(db, ctx, learningItemIds),
    feedbackRows(db, ctx, learningItemIds),
  ]);
  return deriveLearningMemory({
    now,
    window: { from: evidence.from, to: evidence.to, days: evidence.days },
    cards: relevant.map(memoryCard),
    events: evidence.events,
    dueAt: evidence.dueAt,
    goals,
    feedback,
    dueCount: options.dueCount ?? 0,
    nextDueAt: options.nextDueAt ?? null,
    hasCards: cards.some((card) => card.status === "active" || card.status === "known"),
  });
}

/**
 * D48 phase 3: a bounded, explainable selection snapshotted when a class run starts.
 * Only this class and other classes of the same course are eligible; the worker keeps a
 * same-course point only when its exact target occurs in this class's extracted text.
 */
export async function practiceCandidatesForRun(
  tx: Tx,
  ctx: LearnerContext,
  input: { sessionId: string; now?: Date },
): Promise<PracticeCandidate[]> {
  const session = await getSession(tx, ctx, input.sessionId);
  const memory = await learningMemory(tx, ctx, { now: input.now });
  const eligible = [...memory.needsPractice];
  // An explicit "explain more simply" request counts even after the recall has recovered.
  for (const item of memory.simplerRequests)
    if (!eligible.some((entry) => entry.learningItemId === item.learningItemId))
      eligible.push(item);
  const candidates: (PracticeCandidate & { order: number })[] = [];
  for (const item of eligible) {
    if (!item.sessionId || !item.courseId || !studyLexicalTarget(item.label)) continue;
    const scope =
      item.sessionId === session.id
        ? "this_class"
        : item.courseId === session.courseId
          ? "same_course"
          : undefined;
    if (!scope) continue;
    const simpler = item.feedback.explainSimplerAt !== null;
    const difficulty = item.status === "needs_practice" && !item.dismissed;
    if (!simpler && !difficulty) continue;
    candidates.push({
      target: item.label,
      reason: difficulty ? "recall_difficulty" : "asked_simpler",
      scope,
      againCount: item.evidence.again,
      lastEvidenceDate: item.evidence.lastReviewedAt.slice(0, 10),
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
});
export type ItemFeedbackInput = z.infer<typeof itemFeedbackSchema>;

/** D48: append-only learner corrections; the same key replays without a second effect. */
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
    // The baseline is the goal's latest answer the learner could see when correcting the note.
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
    await tx
      .insertInto("pers.item_feedback")
      .values({
        user_id: ctx.userId,
        learning_item_id: goal.learningItemId,
        session_id: goal.sessionId,
        kind: input.kind satisfies FeedbackKind,
        active: input.active,
        evidence_order: summary?.lastOrder ?? null,
        operation_key: options.key,
        request_hash: requestHash,
        created_at: now,
      })
      .execute();
    return { replayed: false };
  });
}
