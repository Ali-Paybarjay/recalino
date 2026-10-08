import { lockAccount } from "../acc";
import type { Database } from "../db";
import { claimSchema, listVersions } from "../lkm";
import {
  automaticLearningGoalKey,
  automaticLearningGoalStem,
  automaticLearningGoalsMatch,
  getNotebook,
} from "../note";
import { assertSessionOwner } from "../org";
import {
  canonicalJson,
  errors,
  isValidIdempotencyKey,
  type LearnerContext,
  readPltSettings,
  runIdempotent,
  sha256Hex,
} from "../plt";
import { fingerprint, saveRevision } from "./cards";
import { readStudyMetadata, studyCardContent } from "./study-content";

export interface AutomaticCardSyncResult {
  revisionId: string;
  created: number;
  updated: number;
  proposed: number;
  retained: number;
}

/** Synchronize the current saved notes without replacing learner choices, card IDs or review state. */
export async function synchronizeAutomaticCards(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  options: { key: string; now?: Date },
): Promise<AutomaticCardSyncResult> {
  if (!isValidIdempotencyKey(options.key))
    throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  const now = options.now ?? new Date();
  const result = await runIdempotent(
    db,
    {
      userId: ctx.userId,
      key: options.key,
      route: "card.automatic_sync",
      requestHash: sha256Hex(canonicalJson({ sessionId })),
      ttlSeconds: readPltSettings().idempotencyTtlSeconds,
      now,
      beforeKey: async (tx) => {
        await lockAccount(tx, ctx.userId);
        await assertSessionOwner(tx, ctx, sessionId);
      },
    },
    async (tx) => {
      const notebook = await getNotebook(tx, ctx, sessionId);
      if (!notebook) throw errors.validationFailed({ notebook: ["publish_notes_first"] });
      const versions = await listVersions(tx, ctx, sessionId);
      const historicalItems = new Map(
        versions.flatMap((version) =>
          version.model.learningItems.map((item) => [item.id, item] as const),
        ),
      );
      const original = versions.find(
        (version) => version.id === notebook.current.knowledgeVersionId,
      );
      if (!original) throw errors.notFound();
      const machineItems = new Map(original.model.learningItems.map((item) => [item.id, item]));
      const goalCounts = new Map<string, number>();
      const stemCounts = new Map<string, number>();
      for (const item of original.model.learningItems) {
        const goal = automaticLearningGoalKey(item);
        goalCounts.set(goal, (goalCounts.get(goal) ?? 0) + 1);
        const stem = automaticLearningGoalStem(item);
        stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
      }
      // Include rejected/deleted cards: automatic additions must not resurrect a discarded goal.
      const existing = await tx
        .selectFrom("card.card as card")
        .innerJoin("card.session_link as link", "link.card_id", "card.id")
        .innerJoin("card.learning_item as learning", "learning.id", "card.learning_item_id")
        .selectAll("card")
        .select(["learning.logical_key as logicalKey", "learning.kind as learningKind"])
        .where("card.user_id", "=", ctx.userId)
        .where("link.user_id", "=", ctx.userId)
        .where("link.session_id", "=", sessionId)
        .where("card.direction", "=", "forward")
        .orderBy("card.id")
        .execute();
      const counts: AutomaticCardSyncResult = {
        revisionId: notebook.current.id,
        created: 0,
        updated: 0,
        proposed: 0,
        retained: 0,
      };
      for (const sourceItem of notebook.current.model.learningItems) {
        const content = studyCardContent(sourceItem, notebook.current.model);
        const item = { ...sourceItem, ...content };
        const machine = machineItems.get(item.id);
        if (!machine) continue;
        const goal = automaticLearningGoalKey(machine);
        const logicalKey = `${sessionId}:${item.id}`;
        const exact = existing.filter((card) => card.logicalKey === logicalKey);
        const previousItem = (card: (typeof existing)[number]) => {
          const priorId = card.logicalKey.startsWith(`${sessionId}:`)
            ? card.logicalKey.slice(sessionId.length + 1)
            : null;
          return priorId ? historicalItems.get(priorId) : undefined;
        };
        const semantic = existing.filter((card) => {
          const previous = previousItem(card);
          return previous && automaticLearningGoalKey(previous) === goal;
        });
        const expanded = existing.filter((card) => {
          const previous = previousItem(card);
          return previous && automaticLearningGoalsMatch(previous, machine);
        });
        const matches = exact.length
          ? exact
          : goalCounts.get(goal) === 1 && semantic.length
            ? semantic
            : stemCounts.get(automaticLearningGoalStem(machine)) === 1
              ? expanded
              : [];
        const hash = fingerprint(item.front, item.back, item.study ? sessionId : undefined);
        if (
          matches.some((card) => card.deleted_at || ["rejected", "deleted"].includes(card.status))
        ) {
          counts.retained++;
          continue;
        }
        if (matches.length > 1) {
          // Ambiguous existing identities stay intact; never create another duplicate goal.
          counts.retained++;
          continue;
        }
        const matched = matches[0];
        if (matched) {
          // Keep the goal ID stable while making ordinary manual generation find the current item.
          if (matched.logicalKey.startsWith(`${sessionId}:`) && matched.logicalKey !== logicalKey) {
            const occupied = await tx
              .selectFrom("card.learning_item")
              .select("id")
              .where("user_id", "=", ctx.userId)
              .where("logical_key", "=", logicalKey)
              .executeTakeFirst();
            if (!occupied)
              await tx
                .updateTable("card.learning_item")
                .set({ logical_key: logicalKey })
                .where("id", "=", matched.learning_item_id)
                .execute();
          }
          const quality = !item.claim.uncertain && item.front.trim() !== item.back.trim();
          const prior = claimSchema.parse(matched.provenance);
          const contentChanged = matched.front !== item.front || matched.back !== item.back;
          const provenanceChanged = canonicalJson(prior) !== canonicalJson(item.claim);
          const metadataChanged =
            canonicalJson(readStudyMetadata(matched.study_metadata)) !==
            canonicalJson(readStudyMetadata(item.study_metadata));
          if (!contentChanged && !provenanceChanged && !metadataChanged) {
            counts.retained++;
            continue;
          }
          if (!contentChanged && !provenanceChanged && metadataChanged) {
            await tx
              .updateTable("card.card")
              .set({
                study_metadata: item.study_metadata,
                content_version: matched.content_version + 1,
                updated_at: now,
              })
              .where("id", "=", matched.id)
              .execute();
            await saveRevision(tx, ctx, matched.id, "study_metadata", now);
            counts.updated++;
            continue;
          }
          const conflicting = await tx
            .selectFrom("card.card")
            .select("id")
            .where("user_id", "=", ctx.userId)
            .where("dedupe_key", "=", hash)
            .where("deleted_at", "is", null)
            .where("id", "!=", matched.id)
            .executeTakeFirst();
          const linked = await tx
            .selectFrom("card.session_link")
            .select("session_id")
            .where("card_id", "=", matched.id)
            .where("user_id", "=", ctx.userId)
            .execute();
          const protectedContent =
            prior.creation === "user_edit" || !quality || !!conflicting || linked.length > 1;
          if (protectedContent) {
            if (contentChanged) {
              const proposal = await tx
                .insertInto("card.proposal")
                .values({
                  user_id: ctx.userId,
                  card_id: matched.id,
                  note_revision_id: notebook.current.id,
                  front: item.front,
                  back: item.back,
                  study_metadata: item.study_metadata,
                  provenance: JSON.stringify(item.claim),
                  fingerprint: hash,
                  created_at: now,
                })
                .onConflict((conflict) =>
                  conflict.columns(["card_id", "note_revision_id"]).doNothing(),
                )
                .returning("id")
                .executeTakeFirst();
              if (proposal) counts.proposed++;
              else counts.retained++;
            } else counts.retained++;
          } else {
            await tx
              .updateTable("card.card")
              .set({
                front: item.front,
                back: item.back,
                study_metadata: item.study_metadata,
                provenance: JSON.stringify(item.claim),
                dedupe_key: hash,
                quality_confirmed: quality,
                content_version: matched.content_version + 1,
                updated_at: now,
              })
              .where("id", "=", matched.id)
              .execute();
            await saveRevision(tx, ctx, matched.id, "automatic_update", now);
            counts.updated++;
          }
          continue;
        }
        const duplicate = await tx
          .selectFrom("card.card")
          .selectAll()
          .where("user_id", "=", ctx.userId)
          .where("dedupe_key", "=", hash)
          .orderBy("created_at", "desc")
          .executeTakeFirst();
        if (duplicate) {
          if (!duplicate.deleted_at && !["rejected", "deleted"].includes(duplicate.status))
            await tx
              .insertInto("card.session_link")
              .values({
                user_id: ctx.userId,
                card_id: duplicate.id,
                session_id: sessionId,
                created_at: now,
              })
              .onConflict((conflict) => conflict.columns(["card_id", "session_id"]).doNothing())
              .execute();
          counts.retained++;
          continue;
        }
        let learning = await tx
          .selectFrom("card.learning_item")
          .select("id")
          .where("user_id", "=", ctx.userId)
          .where("logical_key", "=", logicalKey)
          .executeTakeFirst();
        if (!learning)
          learning = await tx
            .insertInto("card.learning_item")
            .values({
              user_id: ctx.userId,
              logical_key: logicalKey,
              kind: item.kind,
              created_at: now,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
        const quality = !item.claim.uncertain && item.front.trim() !== item.back.trim();
        const card = await tx
          .insertInto("card.card")
          .values({
            user_id: ctx.userId,
            learning_item_id: learning.id,
            direction: "forward",
            template:
              item.kind === "vocabulary"
                ? "vocabulary"
                : item.kind === "grammar"
                  ? "grammar"
                  : "basic",
            front: item.front,
            back: item.back,
            study_metadata: item.study_metadata,
            provenance: JSON.stringify(item.claim),
            status: quality ? "active" : "candidate",
            quality_confirmed: quality,
            dedupe_key: hash,
            created_at: now,
            updated_at: now,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await tx
          .insertInto("card.session_link")
          .values({ user_id: ctx.userId, card_id: card.id, session_id: sessionId, created_at: now })
          .execute();
        await saveRevision(tx, ctx, card.id, "automatic_create", now);
        counts.created++;
      }
      return { status: 200, body: counts };
    },
  );
  return result.body as AutomaticCardSyncResult;
}
