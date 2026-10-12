import "server-only";
import { releaseCaptureLease, renewCaptureLease } from "@recalino/core/org";
import { enqueueJob, errors, type LearnerContext, readPltSettings } from "@recalino/core/plt";
import {
  beginStagedAudioUpload,
  confirmTemporaryAudioPart,
  getSource,
  stagedAudioManifest,
  stagedAudioManifestSchema,
  temporaryAudioPartLink,
} from "@recalino/core/src";
import { z } from "zod";
import type { Handler, RequestContext } from "./api";
import { notifyAutomaticLearning } from "./automatic-learning-notifications";
import { captureFlags, stagedAudioJobDefinition } from "./capture-staging-jobs";
import { PROCESSING_WAKE, runJobsSoon } from "./jobs";
import { getObjectStore } from "./storage";

function actor(ctx: RequestContext): LearnerContext {
  if (!ctx.userId) throw errors.unauthenticated();
  return { userId: ctx.userId, requestId: ctx.requestId };
}
function store() {
  const value = getObjectStore();
  if (!value) throw errors.validationFailed({ storage: ["unavailable"] });
  return value;
}
function enabled() {
  if (!captureFlags().earlyUpload)
    throw errors.validationFailed({ audio: ["early_upload_disabled"] });
}

const stagedRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), parts: stagedAudioManifestSchema.shape.parts }),
  z.strictObject({
    action: z.literal("confirm_part"),
    uploadId: z.uuid(),
    index: z.number().int().nonnegative(),
  }),
  z.strictObject({ action: z.literal("complete"), uploadId: z.uuid() }),
]);
/** D60: the temporary server copy of one sealed in-app recording part, sent during capture. */
export function stagedAudioHandler(assetId: string): Handler {
  return async ({ db, ctx, input, request }) => {
    const learner = actor(ctx);
    await getSource(db, learner, z.uuid().parse(assetId));
    enabled();
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams;
      const uploadId = z.uuid().parse(query.get("uploadId"));
      const manifest = await stagedAudioManifest(db, learner, assetId, uploadId);
      const index = query.get("index");
      if (index === null) return { body: manifest };
      return {
        body: await temporaryAudioPartLink(
          db,
          store(),
          learner,
          assetId,
          uploadId,
          z.coerce.number().int().nonnegative().parse(index),
          readPltSettings().storage,
        ),
      };
    }
    const fields = stagedRequestSchema.parse(input);
    if (fields.action === "start") {
      store();
      return {
        status: 201,
        body: await beginStagedAudioUpload(db, learner, assetId, { parts: fields.parts }),
      };
    }
    const manifest = await stagedAudioManifest(db, learner, assetId, fields.uploadId);
    if (fields.action === "confirm_part") {
      const result = await confirmTemporaryAudioPart(
        db,
        store(),
        learner,
        assetId,
        fields.uploadId,
        fields.index,
      );
      if (result === "missing") return { body: { confirmed: false } };
      if (result !== "verified")
        throw errors.validationFailed({ audio: ["part_integrity_mismatch"] });
      return { body: { confirmed: true } };
    }
    if (manifest.state !== "pending") return { status: 202, body: { ...manifest, jobId: null } };
    const definition = stagedAudioJobDefinition();
    if (!definition) throw errors.validationFailed({ storage: ["unavailable"] });
    const jobId = await db.transaction().execute((tx) =>
      enqueueJob(tx, definition, {
        payload: { userId: learner.userId, assetId, uploadId: fields.uploadId },
        singletonKey: `staged-audio:${fields.uploadId}`,
        now: new Date(),
        defaults: readPltSettings().jobs,
      }),
    );
    runJobsSoon(
      ["src.verify_staged_audio", "proc.capture_transcription"],
      PROCESSING_WAKE.budgetSeconds,
      PROCESSING_WAKE.functionSeconds,
    );
    return { status: 202, body: { ...manifest, jobId } };
  };
}

const captureRequestSchema = z.strictObject({ action: z.enum(["open", "close"]) });
/**
 * The capture lease of one class (D60): while it is open, automatic learning waits so no lesson
 * is built from part of a class. The response tells the app which approved behaviours are on.
 */
export function classCaptureHandler(sessionId: string): Handler {
  return async ({ db, ctx, input }) => {
    const learner = actor(ctx);
    const id = z.uuid().parse(sessionId);
    const { action } = captureRequestSchema.parse(input);
    const flags = captureFlags();
    if (action === "close") {
      await releaseCaptureLease(db, learner, id);
      // Stop: a class waiting on the lease is processed now, not at the next reconcile.
      await notifyAutomaticLearning(db, learner, id, false);
      runJobsSoon(
        ["proc.automatic_learning", "proc.capture_transcription", "proc.process"],
        PROCESSING_WAKE.budgetSeconds,
        PROCESSING_WAKE.functionSeconds,
      );
      return { body: { ...flags, openUntil: null } };
    }
    if (!flags.earlyUpload) return { body: { ...flags, openUntil: null } };
    const { openUntil } = await renewCaptureLease(db, learner, id);
    return { body: { ...flags, openUntil: openUntil.toISOString() } };
  };
}
