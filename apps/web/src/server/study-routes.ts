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
} from "@recalino/core/card";
import { getLatestVersion } from "@recalino/core/lkm";
import {
  getNotebook,
  getNotebookRevision,
  listNotebookRevisions,
  publishNotebook,
  publishNotebookSchema,
} from "@recalino/core/note";
import { errors, type LearnerContext } from "@recalino/core/plt";
import {
  getReviewQueue,
  getReviewSettings,
  reviewInputSchema,
  reviewSettingsSchema,
  submitReview,
  undoReview,
  updateReviewSettings,
} from "@recalino/core/srs";
import { z } from "zod";
import type { Handler, RequestContext } from "./api";

function actor(ctx: RequestContext): LearnerContext {
  if (!ctx.userId) throw errors.unauthenticated();
  return { userId: ctx.userId, requestId: ctx.requestId };
}
function key(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
  return value;
}
function valid(id: string) {
  z.uuid().parse(id);
}
export function notebookHandler(sessionId: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(sessionId);
    const learner = actor(ctx);
    if (request.method === "GET") {
      const [notebook, latestKnowledge] = await Promise.all([
        getNotebook(db, learner, sessionId),
        getLatestVersion(db, learner, sessionId),
      ]);
      return { body: { notebook, latestKnowledge } };
    }
    return {
      status: 201,
      body: await publishNotebook(db, learner, sessionId, publishNotebookSchema.parse(input), {
        key: key(request),
      }),
    };
  };
}
export function noteVersionsHandler(sessionId: string): Handler {
  return async ({ db, ctx }) => {
    valid(sessionId);
    return { body: await listNotebookRevisions(db, actor(ctx), sessionId) };
  };
}
export function noteRevisionHandler(id: string): Handler {
  return async ({ db, ctx }) => {
    valid(id);
    return { body: await getNotebookRevision(db, actor(ctx), id) };
  };
}
export function classCardsHandler(sessionId: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(sessionId);
    const learner = actor(ctx);
    if (request.method === "GET")
      return { body: { cards: await listCards(db, learner, { sessionId }) } };
    return {
      status: 201,
      body: await generateCards(db, learner, sessionId, generateCardsSchema.parse(input), {
        key: key(request),
      }),
    };
  };
}
export function cardHandler(id: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(id);
    const learner = actor(ctx);
    if (request.method === "GET") return { body: await getCard(db, learner, id) };
    return {
      body: await editCard(db, learner, id, editCardSchema.parse(input), { key: key(request) }),
    };
  };
}
export function cardActionsHandler(id: string): Handler {
  return async ({ request, input, db, ctx }) => {
    valid(id);
    return {
      body: await changeCard(db, actor(ctx), id, cardActionSchema.parse(input), {
        key: key(request),
      }),
    };
  };
}
export function cardProposalsHandler(id: string): Handler {
  return async ({ db, ctx }) => {
    valid(id);
    return { body: await listCardProposals(db, actor(ctx), id) };
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
      body: await resolveCardProposal(db, actor(ctx), id, proposalId, parsed, {
        key: key(request),
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
    return { body: await setCardMedia(db, actor(ctx), id, parsed, { key: key(request) }) };
  };
}
export function reviewQueueHandler(): Handler {
  return async ({ request, db, ctx }) => {
    const value = new URL(request.url).searchParams.get("sessionId");
    if (value) valid(value);
    return { body: await getReviewQueue(db, actor(ctx), { sessionId: value ?? undefined }) };
  };
}
export function reviewEventHandler(): Handler {
  return async ({ input, db, ctx }) => ({
    status: 201,
    body: await submitReview(db, actor(ctx), reviewInputSchema.parse(input)),
  });
}
export function reviewUndoHandler(id: string): Handler {
  return async ({ input, db, ctx }) => {
    valid(id);
    const parsed = z.strictObject({ expectedVersion: z.int().nonnegative() }).parse(input);
    return { body: await undoReview(db, actor(ctx), id, parsed.expectedVersion) };
  };
}
export function reviewSettingsHandler(): Handler {
  return async ({ request, input, db, ctx }) => ({
    body:
      request.method === "GET"
        ? await getReviewSettings(db, actor(ctx))
        : await updateReviewSettings(db, actor(ctx), reviewSettingsSchema.parse(input)),
  });
}
