import { randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import { lockAccount } from "../acc";
import type { Database, DB, Tx } from "../db";
import { type Claim, claimSchema } from "../lkm";
import { getMediaAsset } from "../media";
import { getNotebook } from "../note";
import { assertSessionOwner, filterLiveSessionIds, getSession } from "../org";
import {
  AppError,
  assertOwner,
  canonicalJson,
  errors,
  isValidIdempotencyKey,
  type LearnerContext,
  readPltSettings,
  runIdempotent,
  sha256Hex,
} from "../plt";
import {
  type CardActionInput,
  type CardStatus,
  type CardTemplate,
  cardActionSchema,
  cardStatusSchema,
  cardTemplateSchema,
  type EditCardInput,
  editCardSchema,
  type GenerateCardsInput,
  generateCardsSchema,
} from "./schema";
import {
  readStudyMetadata,
  type StudyMetadata,
  savedStudyMetadata,
  studyCardContent,
} from "./study-content";

export interface StudyCard extends Partial<StudyMetadata> {
  id: string;
  ownerId: string;
  learningItemId: string;
  sessionIds: string[];
  template: CardTemplate;
  direction: "forward" | "reverse";
  front: string;
  back: string;
  provenance: Claim;
  status: CardStatus;
  contentVersion: number;
  important: boolean;
  qualityConfirmed: boolean;
  frontMediaId: string | null;
  backMediaId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CardProposal extends Partial<StudyMetadata> {
  id: string;
  cardId: string;
  noteRevisionId: string;
  front: string;
  back: string;
  provenance: Claim;
  createdAt: string;
}
export function fingerprint(front: string, back: string, lessonScope?: string): string {
  return sha256Hex(
    `${front.trim().toLocaleLowerCase("en")}\n${back.trim().toLocaleLowerCase("en")}${lessonScope ? `\nlesson:${lessonScope}` : ""}`,
  );
}
async function requireUniqueContent(
  tx: Tx,
  ctx: LearnerContext,
  front: string,
  back: string,
  exceptId?: string,
): Promise<void> {
  let query = tx
    .selectFrom("card.card")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where("dedupe_key", "=", fingerprint(front, back))
    .where("deleted_at", "is", null);
  if (exceptId) query = query.where("id", "!=", exceptId);
  if (await query.executeTakeFirst()) throw errors.validationFailed({ card: ["already_exists"] });
}
function view(row: Selectable<DB["card.card"]>, sessionIds: string[]): StudyCard {
  return {
    ...readStudyMetadata(row.study_metadata),
    id: row.id,
    ownerId: row.user_id,
    learningItemId: row.learning_item_id,
    sessionIds,
    template: cardTemplateSchema.parse(row.template),
    direction: row.direction === "reverse" ? "reverse" : "forward",
    front: row.front,
    back: row.back,
    provenance: claimSchema.parse(row.provenance),
    status: cardStatusSchema.parse(row.status),
    contentVersion: row.content_version,
    important: row.important,
    qualityConfirmed: row.quality_confirmed,
    frontMediaId: row.front_media_id,
    backMediaId: row.back_media_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
async function sessionsFor(
  db: Database | Tx,
  ctx: LearnerContext,
  cardId: string,
): Promise<string[]> {
  const links = await db
    .selectFrom("card.session_link")
    .select("card.session_link.session_id")
    .where("card.session_link.card_id", "=", cardId)
    .where("card.session_link.user_id", "=", ctx.userId)
    .execute();
  return filterLiveSessionIds(
    db,
    ctx,
    links.map((link) => link.session_id),
  );
}
export async function getCard(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
  lock = false,
): Promise<StudyCard> {
  let query = db
    .selectFrom("card.card")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  assertOwner(row ? { ownerId: row.user_id } : undefined, ctx);
  if (!row) throw errors.notFound();
  const sessionIds = await sessionsFor(db, ctx, id);
  if (!sessionIds.length) throw errors.notFound();
  return view(row, sessionIds);
}
export async function getActiveCard(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
  lock = false,
): Promise<StudyCard> {
  const card = await getCard(db, ctx, id, lock);
  if (card.status !== "active") throw errors.validationFailed({ card: ["not_active"] });
  if (!(await isCardReviewable(db, ctx, card)))
    throw errors.validationFailed({ media: ["listening_audio_unavailable"] });
  return card;
}
export async function isCardReviewable(
  db: Database | Tx,
  ctx: LearnerContext,
  card: StudyCard,
): Promise<boolean> {
  if (card.template !== "listening") return true;
  if (!card.frontMediaId) return false;
  try {
    const asset = await getMediaAsset(db, ctx, card.frontMediaId);
    return (
      asset.state === "ready" &&
      asset.kind === "tts" &&
      !!asset.objectId &&
      !!asset.mimeType?.startsWith("audio/") &&
      card.sessionIds.includes(asset.sessionId)
    );
  } catch (failure) {
    if (failure instanceof AppError && failure.code === "not_found") return false;
    throw failure;
  }
}
export async function listCards(
  db: Database | Tx,
  ctx: LearnerContext,
  options: { sessionId?: string; status?: CardStatus } = {},
): Promise<StudyCard[]> {
  if (options.sessionId) await getSession(db, ctx, options.sessionId);
  let query = db
    .selectFrom("card.card")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("deleted_at", "is", null);
  if (options.status) query = query.where("status", "=", options.status);
  const rows = await query.orderBy("created_at", "asc").orderBy("id", "asc").execute();
  const links = await db
    .selectFrom("card.session_link")
    .select(["card.session_link.card_id", "card.session_link.session_id"])
    .where("card.session_link.user_id", "=", ctx.userId)
    .execute();
  const sessions = new Map<string, string[]>();
  const live = new Set(
    await filterLiveSessionIds(
      db,
      ctx,
      links.map((link) => link.session_id),
    ),
  );
  for (const link of links) {
    if (!live.has(link.session_id)) continue;
    const values = sessions.get(link.card_id) ?? [];
    values.push(link.session_id);
    sessions.set(link.card_id, values);
  }
  return rows
    .flatMap((row) => {
      const ids = sessions.get(row.id) ?? [];
      return ids.length && (!options.sessionId || ids.includes(options.sessionId))
        ? [view(row, ids)]
        : [];
    })
    .sort((a, b) => {
      if (
        a.sessionIds[0] !== b.sessionIds[0] ||
        a.studyPosition === undefined ||
        b.studyPosition === undefined
      )
        return 0;
      return a.studyPosition - b.studyPosition;
    });
}
export async function saveRevision(
  tx: Tx,
  ctx: LearnerContext,
  id: string,
  action: string,
  now: Date,
): Promise<StudyCard> {
  const card = await getCard(tx, ctx, id);
  await tx
    .insertInto("card.revision")
    .values({
      user_id: ctx.userId,
      card_id: id,
      content_version: card.contentVersion,
      snapshot: JSON.stringify({ ...card, action }),
      created_at: now,
    })
    .execute();
  return card;
}
async function atomic<T>(
  db: Database,
  ctx: LearnerContext,
  route: string,
  input: unknown,
  key: string,
  now: Date,
  handle: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!isValidIdempotencyKey(key)) throw errors.validationFailed({ idempotencyKey: ["invalid"] });
  const result = await runIdempotent(
    db,
    {
      userId: ctx.userId,
      key,
      route,
      requestHash: sha256Hex(canonicalJson(input)),
      ttlSeconds: readPltSettings().idempotencyTtlSeconds,
      now,
      beforeKey: (tx) => lockAccount(tx, ctx.userId),
    },
    async (tx) => {
      return { status: 201, body: await handle(tx) };
    },
  );
  if (result.replayed && result.body && typeof result.body === "object") {
    const cached = result.body as { cards?: StudyCard[]; id?: string };
    if (Array.isArray(cached.cards)) {
      for (const card of cached.cards) await getCard(db, ctx, card.id);
      const target = input as { sessionId?: string };
      if (target.sessionId) await getSession(db, ctx, target.sessionId);
    } else if (cached.id) await getCard(db, ctx, cached.id);
  }
  return result.body as T;
}
/** Candidate generation is deterministic over published learning items; it never calls AI. */
export async function generateCards(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  input: GenerateCardsInput,
  options: { key: string; now?: Date },
): Promise<{ cards: StudyCard[]; proposedUpdates: number; duplicates: number }> {
  const parsed = generateCardsSchema.parse(input);
  const now = options.now ?? new Date();
  return atomic(
    db,
    ctx,
    "card.generate",
    { sessionId, ...parsed },
    options.key,
    now,
    async (tx) => {
      await assertSessionOwner(tx, ctx, sessionId);
      const notebook = await getNotebook(tx, ctx, sessionId);
      if (!notebook) throw errors.validationFailed({ notebook: ["publish_notes_first"] });
      if (
        parsed.itemIds?.some(
          (id) => !notebook.current.model.learningItems.some((item) => item.id === id),
        )
      )
        throw errors.validationFailed({ itemIds: ["unknown_item"] });
      const selected = notebook.current.model.learningItems.filter(
        (item) => !parsed.itemIds || parsed.itemIds.includes(item.id),
      );
      const cards: StudyCard[] = [];
      let proposedUpdates = 0;
      let duplicates = 0;
      for (const item of selected) {
        let learning = await tx
          .selectFrom("card.learning_item")
          .selectAll()
          .where("user_id", "=", ctx.userId)
          .where("logical_key", "=", `${sessionId}:${item.id}`)
          .executeTakeFirst();
        if (!learning)
          learning = await tx
            .insertInto("card.learning_item")
            .values({
              user_id: ctx.userId,
              logical_key: `${sessionId}:${item.id}`,
              kind: item.kind,
              created_at: now,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        // Rich items have exactly one tested direction, including when legacy callers ask for reverse.
        const reverse = parsed.reverse && !item.study;
        const content = studyCardContent(item, notebook.current.model);
        const front = reverse ? content.back : content.front;
        const back = reverse ? content.front : content.back;
        // Rich cards carry the lesson's order/date/tags and must not inherit another lesson's metadata.
        const hash = fingerprint(front, back, item.study ? sessionId : undefined);
        const duplicate = await tx
          .selectFrom("card.card")
          .selectAll()
          .where("user_id", "=", ctx.userId)
          .where("dedupe_key", "=", hash)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        // Directions are separate cards; exact duplicates can be shared by several classes.
        const sameDirection =
          duplicate ??
          (await tx
            .selectFrom("card.card")
            .selectAll()
            .where("user_id", "=", ctx.userId)
            .where("learning_item_id", "=", learning.id)
            .where("deleted_at", "is", null)
            .where("direction", "=", reverse ? "reverse" : "forward")
            .executeTakeFirst());
        if (sameDirection) {
          await tx
            .insertInto("card.session_link")
            .values({
              card_id: sameDirection.id,
              user_id: ctx.userId,
              session_id: sessionId,
              created_at: now,
            })
            .onConflict((conflict) => conflict.columns(["card_id", "session_id"]).doNothing())
            .execute();
          if (sameDirection.front !== front || sameDirection.back !== back) {
            const added = await tx
              .insertInto("card.proposal")
              .values({
                user_id: ctx.userId,
                card_id: sameDirection.id,
                note_revision_id: notebook.current.id,
                front,
                back,
                study_metadata: content.study_metadata,
                provenance: JSON.stringify(item.claim),
                fingerprint: hash,
                created_at: now,
              })
              .onConflict((conflict) =>
                conflict.columns(["card_id", "note_revision_id"]).doNothing(),
              )
              .returning("id")
              .executeTakeFirst();
            if (added) proposedUpdates++;
          } else {
            if (
              canonicalJson(readStudyMetadata(sameDirection.study_metadata)) !==
              canonicalJson(readStudyMetadata(content.study_metadata))
            ) {
              await tx
                .updateTable("card.card")
                .set({
                  study_metadata: content.study_metadata,
                  content_version: sameDirection.content_version + 1,
                  updated_at: now,
                })
                .where("id", "=", sameDirection.id)
                .execute();
              await saveRevision(tx, ctx, sameDirection.id, "study_metadata", now);
            }
            duplicates++;
          }
          cards.push(await getCard(tx, ctx, sameDirection.id));
          continue;
        }
        const quality = !item.claim.uncertain && item.front.trim() !== item.back.trim();
        const row = await tx
          .insertInto("card.card")
          .values({
            user_id: ctx.userId,
            learning_item_id: learning.id,
            direction: reverse ? "reverse" : "forward",
            template:
              item.kind === "vocabulary"
                ? "vocabulary"
                : item.kind === "grammar"
                  ? "grammar"
                  : "basic",
            front,
            back,
            study_metadata: content.study_metadata,
            provenance: JSON.stringify(item.claim),
            status: parsed.autoAdd && quality ? "active" : "candidate",
            quality_confirmed: quality,
            dedupe_key: hash,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await tx
          .insertInto("card.session_link")
          .values({ card_id: row.id, user_id: ctx.userId, session_id: sessionId, created_at: now })
          .execute();
        cards.push(await saveRevision(tx, ctx, row.id, "create", now));
      }
      return { cards, proposedUpdates, duplicates };
    },
  );
}
export async function editCard(
  db: Database,
  ctx: LearnerContext,
  id: string,
  input: EditCardInput,
  options: { key: string; now?: Date },
): Promise<StudyCard> {
  const parsed = editCardSchema.parse(input);
  const now = options.now ?? new Date();
  return atomic(db, ctx, "card.edit", { id, ...parsed }, options.key, now, async (tx) => {
    const card = await getCard(tx, ctx, id, true);
    if (card.contentVersion !== parsed.expectedVersion) throw errors.conflict();
    const provenance: Claim = { ...card.provenance, creation: "user_edit" };
    await requireUniqueContent(
      tx,
      ctx,
      parsed.front,
      parsed.back,
      parsed.newLearningGoal ? undefined : id,
    );
    if (parsed.newLearningGoal) {
      const learning = await tx
        .insertInto("card.learning_item")
        .values({
          user_id: ctx.userId,
          logical_key: `user:${randomUUID()}`,
          kind: "concept",
          created_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const row = await tx
        .insertInto("card.card")
        .values({
          user_id: ctx.userId,
          learning_item_id: learning.id,
          template: card.template === "listening" ? "basic" : card.template,
          front: parsed.front,
          back: parsed.back,
          provenance: JSON.stringify(provenance),
          dedupe_key: fingerprint(parsed.front, parsed.back),
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      for (const sessionId of card.sessionIds)
        await tx
          .insertInto("card.session_link")
          .values({ card_id: row.id, user_id: ctx.userId, session_id: sessionId })
          .execute();
      return saveRevision(tx, ctx, row.id, "new_goal", now);
    }
    await tx
      .updateTable("card.card")
      .set({
        front: parsed.front,
        back: parsed.back,
        study_metadata: null,
        provenance: JSON.stringify(provenance),
        content_version: card.contentVersion + 1,
        dedupe_key: fingerprint(parsed.front, parsed.back),
        updated_at: now,
      })
      .where("id", "=", id)
      .execute();
    return saveRevision(tx, ctx, id, "edit", now);
  });
}
export async function changeCard(
  db: Database,
  ctx: LearnerContext,
  id: string,
  input: CardActionInput,
  options: { key: string; now?: Date },
): Promise<StudyCard | { deleted: true }> {
  const parsed = cardActionSchema.parse(input);
  const now = options.now ?? new Date();
  return atomic(db, ctx, "card.change", { id, ...parsed }, options.key, now, async (tx) => {
    const card = await getCard(tx, ctx, id, true);
    if (card.contentVersion !== parsed.expectedVersion) throw errors.conflict();
    if (parsed.action === "delete") {
      await tx
        .updateTable("card.card")
        .set({
          status: "deleted",
          deleted_at: now,
          updated_at: now,
          content_version: card.contentVersion + 1,
        })
        .where("id", "=", id)
        .execute();
      return { deleted: true };
    }
    if (parsed.action === "undo") {
      const current = await tx
        .selectFrom("card.revision")
        .selectAll()
        .where("card_id", "=", id)
        .where("content_version", "=", card.contentVersion)
        .executeTakeFirstOrThrow();
      if ((current.snapshot as { action?: string }).action === "undo")
        throw errors.validationFailed({ action: ["nothing_to_undo"] });
      const previous = await tx
        .selectFrom("card.revision")
        .selectAll()
        .where("card_id", "=", id)
        .where("content_version", "<", card.contentVersion)
        .orderBy("content_version", "desc")
        .limit(1)
        .executeTakeFirst();
      if (!previous) throw errors.validationFailed({ action: ["nothing_to_undo"] });
      const prior = previous.snapshot as unknown as StudyCard;
      await requireUniqueContent(tx, ctx, prior.front, prior.back, id);
      await tx
        .updateTable("card.card")
        .set({
          front: prior.front,
          back: prior.back,
          study_metadata: savedStudyMetadata(prior),
          provenance: JSON.stringify(prior.provenance),
          status: prior.status,
          important: prior.important,
          quality_confirmed: prior.qualityConfirmed,
          front_media_id: prior.frontMediaId,
          back_media_id: prior.backMediaId,
          dedupe_key: fingerprint(
            prior.front,
            prior.back,
            prior.contentFormat === "lesson_html" ? prior.sessionIds[0] : undefined,
          ),
          content_version: card.contentVersion + 1,
          updated_at: now,
        })
        .where("id", "=", id)
        .execute();
      return saveRevision(tx, ctx, id, "undo", now);
    }
    const statuses: Partial<Record<CardActionInput["action"], CardStatus>> = {
      activate: "active",
      reject: "rejected",
      suspend: "suspended",
      resume: "active",
      know: "known",
      unmark_known: "active",
      wrong: "suspended",
    };
    const status = statuses[parsed.action] ?? card.status;
    const quality =
      parsed.action === "wrong" ? false : parsed.confirmQuality === true || card.qualityConfirmed;
    if (status === "active" && !quality)
      throw errors.validationFailed({ quality: ["confirmation_required"] });
    if (status === "active" && !(await isCardReviewable(tx, ctx, card)))
      throw errors.validationFailed({ media: ["listening_audio_required"] });
    await tx
      .updateTable("card.card")
      .set({
        status,
        quality_confirmed: quality,
        important:
          parsed.action === "important"
            ? true
            : parsed.action === "unimportant"
              ? false
              : card.important,
        content_version: card.contentVersion + 1,
        updated_at: now,
      })
      .where("id", "=", id)
      .execute();
    return saveRevision(tx, ctx, id, parsed.action, now);
  });
}
export async function listCardProposals(
  db: Database | Tx,
  ctx: LearnerContext,
  cardId: string,
): Promise<CardProposal[]> {
  await getCard(db, ctx, cardId);
  const rows = await db
    .selectFrom("card.proposal")
    .selectAll()
    .where("card_id", "=", cardId)
    .where("user_id", "=", ctx.userId)
    .where("status", "=", "pending")
    .orderBy("created_at", "desc")
    .execute();
  return rows.map((row) => ({
    ...readStudyMetadata(row.study_metadata),
    id: row.id,
    cardId,
    noteRevisionId: row.note_revision_id,
    front: row.front,
    back: row.back,
    provenance: claimSchema.parse(row.provenance),
    createdAt: row.created_at.toISOString(),
  }));
}
export async function resolveCardProposal(
  db: Database,
  ctx: LearnerContext,
  cardId: string,
  proposalId: string,
  input: { expectedVersion: number; action: "dismiss" | "apply"; newLearningGoal: boolean },
  options: { key: string; now?: Date },
): Promise<StudyCard> {
  const now = options.now ?? new Date();
  return atomic(
    db,
    ctx,
    "card.proposal",
    { cardId, proposalId, ...input },
    options.key,
    now,
    async (tx) => {
      const card = await getCard(tx, ctx, cardId, true);
      if (card.contentVersion !== input.expectedVersion) throw errors.conflict();
      const proposed = await tx
        .selectFrom("card.proposal")
        .selectAll()
        .where("id", "=", proposalId)
        .where("card_id", "=", cardId)
        .where("user_id", "=", ctx.userId)
        .where("status", "=", "pending")
        .forUpdate()
        .executeTakeFirst();
      if (!proposed) throw errors.notFound();
      if (input.action === "dismiss") {
        await tx
          .updateTable("card.proposal")
          .set({ status: "dismissed" })
          .where("id", "=", proposalId)
          .execute();
        return card;
      }
      const provenance = claimSchema.parse(proposed.provenance);
      await requireUniqueContent(
        tx,
        ctx,
        proposed.front,
        proposed.back,
        input.newLearningGoal ? undefined : cardId,
      );
      let id = cardId;
      if (input.newLearningGoal) {
        const learning = await tx
          .insertInto("card.learning_item")
          .values({
            user_id: ctx.userId,
            logical_key: `proposal:${randomUUID()}`,
            kind: "concept",
            created_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        const row = await tx
          .insertInto("card.card")
          .values({
            user_id: ctx.userId,
            learning_item_id: learning.id,
            template: card.template === "listening" ? "basic" : card.template,
            front: proposed.front,
            back: proposed.back,
            study_metadata: proposed.study_metadata,
            provenance: JSON.stringify(provenance),
            dedupe_key: proposed.fingerprint,
            quality_confirmed: !provenance.uncertain,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        id = row.id;
        for (const sessionId of card.sessionIds)
          await tx
            .insertInto("card.session_link")
            .values({ card_id: id, user_id: ctx.userId, session_id: sessionId, created_at: now })
            .execute();
      } else {
        await tx
          .updateTable("card.card")
          .set({
            front: proposed.front,
            back: proposed.back,
            study_metadata: proposed.study_metadata,
            provenance: JSON.stringify(provenance),
            dedupe_key: proposed.fingerprint,
            content_version: card.contentVersion + 1,
            quality_confirmed: !provenance.uncertain,
            status: provenance.uncertain && card.status === "active" ? "suspended" : card.status,
            updated_at: now,
          })
          .where("id", "=", id)
          .execute();
      }
      await tx
        .updateTable("card.proposal")
        .set({ status: "applied" })
        .where("id", "=", proposalId)
        .execute();
      return saveRevision(tx, ctx, id, "proposal", now);
    },
  );
}
/** Every attachment has separate asset ownership, state and class checks. */
export async function setCardMedia(
  db: Database,
  ctx: LearnerContext,
  cardId: string,
  input: {
    expectedVersion: number;
    side: "front" | "back";
    mediaId: string | null;
    listening?: boolean;
  },
  options: { key: string; now?: Date },
): Promise<StudyCard> {
  const now = options.now ?? new Date();
  return atomic(db, ctx, "card.media", { cardId, ...input }, options.key, now, async (tx) => {
    const card = await getCard(tx, ctx, cardId, true);
    if (card.contentVersion !== input.expectedVersion) throw errors.conflict();
    const asset = input.mediaId ? await getMediaAsset(tx, ctx, input.mediaId) : null;
    if (
      asset &&
      (!card.sessionIds.includes(asset.sessionId) ||
        asset.state !== "ready" ||
        !asset.mimeType ||
        !asset.objectId)
    )
      throw errors.validationFailed({ media: ["not_ready_for_this_class"] });
    const template =
      input.listening === true ? "listening" : input.listening === false ? "basic" : card.template;
    if (
      template === "listening" &&
      input.side === "front" &&
      (asset?.kind !== "tts" || !asset.mimeType?.startsWith("audio/"))
    )
      throw errors.validationFailed({ media: ["listening_audio_required"] });
    if (template === "listening" && input.side === "back" && !card.frontMediaId)
      throw errors.validationFailed({ media: ["listening_audio_required"] });
    await tx
      .updateTable("card.card")
      .set({
        ...(input.side === "front"
          ? { front_media_id: input.mediaId }
          : { back_media_id: input.mediaId }),
        template,
        content_version: card.contentVersion + 1,
        updated_at: now,
      })
      .where("id", "=", cardId)
      .execute();
    return saveRevision(tx, ctx, cardId, "media", now);
  });
}
/** Shared cards stay visible if any other non-deleted class still links them. */
export async function tombstoneSessionCards(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  const links = await tx
    .selectFrom("card.session_link")
    .select("card_id")
    .where("session_id", "=", sessionId)
    .where("user_id", "=", ctx.userId)
    .execute();
  await tx
    .deleteFrom("card.session_link")
    .where("session_id", "=", sessionId)
    .where("user_id", "=", ctx.userId)
    .execute();
  for (const link of links) {
    const remaining = await sessionsFor(tx, ctx, link.card_id);
    if (!remaining.length)
      await tx
        .updateTable("card.card")
        .set({ deleted_at: now, status: "deleted", updated_at: now })
        .where("id", "=", link.card_id)
        .where("user_id", "=", ctx.userId)
        .execute();
  }
}
