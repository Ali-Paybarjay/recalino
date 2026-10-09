import "server-only";
import { getLearningSession, listLearningSessions } from "@recalino/core/note";
import {
  createCourse,
  createCourseSchema,
  createSession,
  createSessionSchema,
  createUnit,
  createUnitSchema,
  deleteCourse,
  deleteUnit,
  getCourse,
  getSession,
  listCourses,
  listUnits,
  renameCourse,
  renameCourseSchema,
  sessionListSchema,
  updateSession,
  updateSessionSchema,
  updateUnit,
  updateUnitSchema,
} from "@recalino/core/org";
import { AppError, errors, type LearnerContext } from "@recalino/core/plt";
import { persistDeletionJournal, requestSessionDeletion } from "@recalino/core/priv";
import { z } from "zod";
import type { Handler, RequestContext } from "./api";
import { runJobsSoon } from "./jobs";
import { privacyDependencies } from "./privacy";

function learner(ctx: RequestContext): LearnerContext {
  if (ctx.userId === null) throw errors.unauthenticated();
  return { userId: ctx.userId, requestId: ctx.requestId };
}

function key(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
  return value;
}

const idSchema = z.uuid();

/** FR-ORG-002. Ownership and idempotency remain in the domain transaction. */
export function coursesHandler(): Handler {
  return async ({ request, input, ctx, db }) => {
    const actor = learner(ctx);
    if (request.method === "GET") return { body: await listCourses(db, actor) };
    return {
      status: 201,
      body: await createCourse(db, actor, createCourseSchema.parse(input), { key: key(request) }),
    };
  };
}

export function courseHandler(id: string): Handler {
  return async ({ request, input, ctx, db }) => {
    const actor = learner(ctx);
    idSchema.parse(id);
    if (request.method === "GET") return { body: await getCourse(db, actor, id) };
    if (request.method === "PATCH")
      return { body: await renameCourse(db, actor, id, renameCourseSchema.parse(input)) };
    await deleteCourse(db, actor, id);
    return { body: { deleted: true } };
  };
}

/** FR-ORG-003: units are always scoped to an owned course. */
export function courseUnitsHandler(courseId: string): Handler {
  return async ({ request, input, ctx, db }) => {
    const actor = learner(ctx);
    idSchema.parse(courseId);
    if (request.method === "GET") return { body: await listUnits(db, actor, courseId) };
    const fields = z
      .strictObject({ name: z.string(), position: z.number().optional() })
      .parse(input);
    return {
      status: 201,
      body: await createUnit(db, actor, createUnitSchema.parse({ ...fields, courseId }), {
        key: key(request),
      }),
    };
  };
}

export function unitHandler(id: string): Handler {
  return async ({ request, input, ctx, db }) => {
    const actor = learner(ctx);
    idSchema.parse(id);
    if (request.method === "PATCH")
      return { body: await updateUnit(db, actor, id, updateUnitSchema.parse(input)) };
    await deleteUnit(db, actor, id);
    return { body: { deleted: true } };
  };
}

/** FR-ORG-001,005: server pagination and optional names; no allowance is used. */
export function classesHandler(): Handler {
  return async ({ request, input, ctx, db }) => {
    const actor = learner(ctx);
    if (request.method === "GET") {
      const search = new URL(request.url).searchParams;
      const query = sessionListSchema.parse({
        courseId: search.get("courseId") ?? undefined,
        unitId: search.get("unitId") ?? undefined,
        limit: search.has("limit") ? Number(search.get("limit")) : undefined,
        offset: search.has("offset") ? Number(search.get("offset")) : undefined,
        order: search.get("order") ?? undefined,
      });
      return { body: await listLearningSessions(db, actor, query) };
    }
    return {
      status: 201,
      body: await createSession(db, actor, createSessionSchema.parse(input), { key: key(request) }),
    };
  };
}

/** FR-ORG-004,007: tombstoned classes have the same response as missing classes. */
export function classSessionHandler(id: string): Handler {
  return async ({ request, input, ctx, db }) => {
    const actor = learner(ctx);
    idSchema.parse(id);
    if (request.method === "GET") return { body: await getLearningSession(db, actor, id) };
    if (request.method === "PATCH") {
      return { body: await updateSession(db, actor, id, updateSessionSchema.parse(input)) };
    }
    const deletionKey = request.headers.get("idempotency-key");
    if (!deletionKey) {
      await getSession(db, actor, id);
      throw errors.validationFailed({ "Idempotency-Key": ["required"] });
    }
    const dependencies = privacyDependencies();
    const result = await requestSessionDeletion(db, actor, id, deletionKey, dependencies);
    try {
      await persistDeletionJournal(db, actor, result.id, dependencies);
    } catch (failure) {
      // The class is already hidden; only its durable deletion record is missing. Say so, and
      // let the same Idempotency-Key retry the record (FR-ORG-007).
      throw new AppError("internal", {
        details: {
          deletion: { requestId: result.id, kind: "session", state: "acknowledgement_pending" },
        },
        reason: failure instanceof AppError ? failure.reason : "deletion_journal_failed",
      });
    }
    runJobsSoon(["priv.cleanup"], 90);
    return { status: 202, body: result };
  };
}
