import "server-only";
import {
  type AccountState,
  acceptDocuments,
  DOCUMENTS,
  profileChangeSchema,
  updateProfile,
} from "@recalino/core/acc";
import { errors, type LearnerContext } from "@recalino/core/plt";
import { z } from "zod";
import type { Handler, RequestContext } from "./api";

function learner(ctx: RequestContext): LearnerContext {
  if (ctx.userId === null) throw errors.unauthenticated();
  return { userId: ctx.userId, requestId: ctx.requestId };
}

/** What the setup and Settings screens need after a change; no internal fields. */
export function profileView(state: AccountState) {
  return {
    setupStep: state.setupStep,
    setupComplete: state.setupComplete,
    timezone: state.timezone,
    profile: state.profile,
  };
}

/** PATCH /api/profile: one setup answer or one Settings edit (FR-ACC-003, 004, 005, 006). */
export function profileHandler(now: () => Date = () => new Date()): Handler {
  return async ({ input, ctx, db }) => {
    const change = profileChangeSchema.parse(input);
    const state = await updateProfile(db, learner(ctx), change, { now: now() });
    return { body: profileView(state) };
  };
}

const consentsSchema = z.object({
  acceptances: z
    .array(z.object({ document: z.enum(DOCUMENTS), version: z.string().min(1).max(16) }))
    .min(1)
    .max(DOCUMENTS.length),
});

/** POST /api/consents: accept the texts the learner just read (FR-ACC-003 step 7, FR-ACC-007). */
export function consentsHandler(now: () => Date = () => new Date()): Handler {
  return async ({ input, ctx, db }) => {
    const { acceptances } = consentsSchema.parse(input);
    await acceptDocuments(db, learner(ctx), acceptances, { now: now() });
    return { body: { accepted: acceptances.map((item) => item.document) } };
  };
}
