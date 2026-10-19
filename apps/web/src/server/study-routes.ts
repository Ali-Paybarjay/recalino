import "server-only";
import {
  cardActionSchema,
  changeCard,
  editCard,
  editCardSchema,
  generateCards,
  generateCardsSchema,
  getCard,
  listCardProposals,
  listCards,
  resolveCardProposal,
  setCardMedia,
  synchronizeAutomaticCards,
} from "@recalino/core/card";
import { getLatestVersion } from "@recalino/core/lkm";
import {
  getNotebook,
  getNotebookRevision,
  listNotebookRevisions,
  publishNotebook,
  publishNotebookSchema,
} from "@recalino/core/note";
import { getAutomaticLearningSession } from "@recalino/core/proc";
import {
  getReviewQueue,
  getReviewSettings,
  reviewInputSchema,
  reviewQueueQuerySchema,
  reviewSettingsSchema,
  submitReview,
  undoReview,
  updateReviewSettings,
} from "@recalino/core/srs";
import { z } from "zod";
import { type Handler, idempotencyKey, learnerActor } from "./api";

function valid(id: string) {
  z.uuid().parse(id);
}
export function notebookHandler(sessionId: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(sessionId);
    const learner = learnerActor(ctx);
    if (request.method === "GET") {
      const [notebook, latestKnowledge] = await Promise.all([
        getNotebook(db, learner, sessionId),
        getLatestVersion(db, learner, sessionId),
      ]);
      return { body: { notebook, latestKnowledge } };
    }
    const notebook = await publishNotebook(
      db,
      learner,
      sessionId,
      publishNotebookSchema.parse(input),
      { key: idempotencyKey(request) },
    );
    if (await getAutomaticLearningSession(db, learner, sessionId))
      await synchronizeAutomaticCards(db, learner, sessionId, {
        key: `automatic-cards:${notebook.current.id}`,
      });
    return { status: 201, body: notebook };
  };
}
export function noteVersionsHandler(sessionId: string): Handler {
  return async ({ db, ctx }) => {
    valid(sessionId);
    return { body: await listNotebookRevisions(db, learnerActor(ctx), sessionId) };
  };
}
export function noteRevisionHandler(id: string): Handler {
  return async ({ db, ctx }) => {
    valid(id);
    return { body: await getNotebookRevision(db, learnerActor(ctx), id) };
  };
}
export function classCardsHandler(sessionId: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(sessionId);
    const learner = learnerActor(ctx);
    if (request.method === "GET")
      return { body: { cards: await listCards(db, learner, { sessionId }) } };
    return {
      status: 201,
      body: await generateCards(db, learner, sessionId, generateCardsSchema.parse(input), {
        key: idempotencyKey(request),
      }),
    };
  };
}
export function cardHandler(id: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(id);
    const learner = learnerActor(ctx);
    if (request.method === "GET") return { body: await getCard(db, learner, id) };
    return {
      body: await editCard(db, learner, id, editCardSchema.parse(input), {
        key: idempotencyKey(request),
      }),
    };
  };
}
export function cardActionsHandler(id: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(id);
    return {
      body: await changeCard(db, learnerActor(ctx), id, cardActionSchema.parse(input), {
        key: idempotencyKey(request),
      }),
    };
  };
}
export function cardProposalsHandler(id: string): Handler {
  return async ({ db, ctx }) => {
    valid(id);
    return { body: await listCardProposals(db, learnerActor(ctx), id) };
  };
}
export function cardProposalHandler(id: string, proposalId: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(id);
    valid(proposalId);
    const parsed = z
      .strictObject({
        expectedVersion: z.int().positive(),
        action: z.enum(["dismiss", "apply"]),
        newLearningGoal: z.boolean(),
      })
      .parse(input);
    return {
      body: await resolveCardProposal(db, learnerActor(ctx), id, proposalId, parsed, {
        key: idempotencyKey(request),
      }),
    };
  };
}
export function cardMediaHandler(id: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(id);
    const parsed = z
      .strictObject({
        expectedVersion: z.int().positive(),
        side: z.enum(["front", "back"]),
        mediaId: z.uuid().nullable(),
        listening: z.boolean().optional(),
      })
      .parse(input);
    return {
      body: await setCardMedia(db, learnerActor(ctx), id, parsed, { key: idempotencyKey(request) }),
    };
  };
}
export function reviewQueueHandler(): Handler {
  return async ({ request, db, ctx }) => {
    const query = new URL(request.url).searchParams;
    const selection = reviewQueueQuerySchema.parse({
      sessionId: query.get("sessionId") ?? undefined,
    });
    return { body: await getReviewQueue(db, learnerActor(ctx), selection) };
  };
}
export function reviewEventHandler(): Handler {
  return async ({ input, db, ctx }) => ({
    status: 201,
    body: await submitReview(db, learnerActor(ctx), reviewInputSchema.parse(input)),
  });
}
export function reviewUndoHandler(id: string): Handler {
  return async ({ input, db, ctx }) => {
    valid(id);
    const parsed = z.strictObject({ expectedVersion: z.int().nonnegative() }).parse(input);
    return { body: await undoReview(db, learnerActor(ctx), id, parsed.expectedVersion) };
  };
}
export function reviewSettingsHandler(): Handler {
  return async ({ request, input, db, ctx }) => ({
    body:
      request.method === "GET"
        ? await getReviewSettings(db, learnerActor(ctx))
        : await updateReviewSettings(db, learnerActor(ctx), reviewSettingsSchema.parse(input)),
  });
}
