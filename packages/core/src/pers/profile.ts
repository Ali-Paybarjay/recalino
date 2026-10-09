import { z } from "zod";
import {
  getAccountState,
  type LearningProfile,
  listTeachingPreferences,
  resetInferredPreferences,
  saveTeachingPreference,
} from "../acc";
import { listCards } from "../card";
import type { Database } from "../db";
import { cardHtmlToText } from "../lkm";
import { noteEditActivity } from "../note";
import { errors, type LearnerContext } from "../plt";
import { getReviewQueue, type ReviewActivity, reviewActivity } from "../srs";
import { learningMemory } from "./memory";
import type { LearningMemory } from "./memory-rules";
export interface LearningOverview {
  profile: LearningProfile;
  /** IANA zone used to show evidence dates; UTC until the learner saves one. */
  timezone: string;
  activity: ReviewActivity;
  acceptedCards: number;
  dueCards: number;
  /** Plain text only: card faces are rendered markup and are never shown as a label. */
  repeatedMistakes: { cardId: string; front: string; again: number }[];
  supportEstimate: {
    level: null;
    speaking: "unknown";
    evidenceCount: number;
    /** The latest saved answer considered, or null; never the time the page was opened. */
    updatedAt: string | null;
    uncertainty: "insufficient_evidence";
  };
  memory: LearningMemory;
  shorterExamples: boolean;
  simplerExplanations: boolean;
  suggestion: { key: "shorter_examples"; evidenceCount: number; classes: number } | null;
}
export async function learningOverview(
  db: Database,
  ctx: LearnerContext,
  now = new Date(),
): Promise<LearningOverview> {
  const [account, activity, cards, queue, preferences, edits] = await Promise.all([
    getAccountState(db, ctx.userId),
    reviewActivity(db, ctx, { now }),
    listCards(db, ctx),
    getReviewQueue(db, ctx, { now, limit: 1 }),
    listTeachingPreferences(db, ctx),
    noteEditActivity(db, ctx),
  ]);
  if (!account) throw errors.notFound();
  const memory = await learningMemory(db, ctx, {
    now,
    dueCount: queue.dueCount,
    nextDueAt: queue.nextDueAt,
  });
  const explicit = preferences.find(
      (item) => item.key === "shorter_examples" && item.origin === "explicit",
    ),
    simpler = preferences.find(
      (item) => item.key === "simpler_explanations" && item.origin === "explicit",
    ),
    inferred = preferences.find(
      (item) => item.key === "shorter_examples" && item.origin === "inferred",
    );
  const dismissed = z
    .object({ dismissed: z.boolean(), evidenceCount: z.int().nonnegative() })
    .safeParse(inferred?.value);
  const baseline = dismissed.data?.dismissed ? dismissed.data.evidenceCount : 0;
  return {
    profile: account.profile,
    timezone: account.timezone ?? "UTC",
    activity,
    acceptedCards: cards.filter((card) => card.status === "active" || card.status === "known")
      .length,
    dueCards: queue.dueCount,
    repeatedMistakes: activity.repeatedMistakes.flatMap((item) => {
      const card = cards.find((card) => card.id === item.cardId);
      return card
        ? [{ ...item, front: card.pronunciationTarget ?? cardHtmlToText(card.front) }]
        : [];
    }),
    supportEstimate: {
      level: null,
      speaking: "unknown",
      evidenceCount: activity.answers,
      updatedAt: memory.lastEvidenceAt,
      uncertainty: "insufficient_evidence",
    },
    memory,
    shorterExamples: explicit?.value === true,
    simplerExplanations: simpler?.value === true,
    suggestion:
      !explicit && edits.shorterItems - baseline >= 3 && edits.classesWithShorterEdits >= 2
        ? {
            key: "shorter_examples",
            evidenceCount: edits.shorterItems,
            classes: edits.classesWithShorterEdits,
          }
        : null,
  };
}
export const preferenceChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("set_shorter_examples"), value: z.boolean() }),
  z.strictObject({ action: z.literal("set_simpler_explanations"), value: z.boolean() }),
  z.strictObject({ action: z.literal("accept_shorter_examples") }),
  z.strictObject({ action: z.literal("dismiss_shorter_examples") }),
  z.strictObject({ action: z.literal("reset_suggestions") }),
]);
export async function changeLearningPreferences(
  db: Database,
  ctx: LearnerContext,
  input: z.infer<typeof preferenceChangeSchema>,
): Promise<LearningOverview> {
  const change = preferenceChangeSchema.parse(input);
  if (change.action === "reset_suggestions") {
    const edits = await noteEditActivity(db, ctx);
    await resetInferredPreferences(db, ctx);
    await saveTeachingPreference(db, ctx, {
      key: "shorter_examples",
      origin: "inferred",
      value: { dismissed: true, evidenceCount: edits.shorterItems },
    });
  } else if (change.action === "set_simpler_explanations")
    await saveTeachingPreference(db, ctx, {
      key: "simpler_explanations",
      origin: "explicit",
      value: change.value,
    });
  else if (change.action === "set_shorter_examples")
    await saveTeachingPreference(db, ctx, {
      key: "shorter_examples",
      origin: "explicit",
      value: change.value,
    });
  else {
    const current = await learningOverview(db, ctx);
    if (!current.suggestion) throw errors.validationFailed({ preference: ["no_suggestion"] });
    if (change.action === "accept_shorter_examples")
      await saveTeachingPreference(db, ctx, {
        key: "shorter_examples",
        origin: "explicit",
        value: true,
      });
    else
      await saveTeachingPreference(db, ctx, {
        key: "shorter_examples",
        origin: "inferred",
        value: { dismissed: true, evidenceCount: current.suggestion.evidenceCount },
      });
  }
  return learningOverview(db, ctx);
}
