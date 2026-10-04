import "server-only";
import {
  createImageMedia,
  getMediaAsset,
  listMediaAssets,
  mediaReadLink,
  requestTts,
  setMediaExportPermission,
} from "@recalino/core/media";
import { getSession } from "@recalino/core/org";
import { errors, type LearnerContext, readPltSettings } from "@recalino/core/plt";
import { z } from "zod";
import type { Handler, RequestContext } from "./api";
import { runJobsSoon } from "./jobs";
import { getMediaDependencies } from "./media-jobs";
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
export function classMediaHandler(sessionId: string): Handler {
  return async ({ db, ctx, input, request }) => {
    const learner = actor(ctx);
    z.uuid().parse(sessionId);
    await getSession(db, learner, sessionId);
    if (request.method === "GET")
      return {
        body: {
          media: await listMediaAssets(db, learner, sessionId),
          ttsConfigured: getMediaDependencies()?.provider?.settings.dataContractApproved === true,
        },
      };
    const operationKey = request.headers.get("idempotency-key");
    if (!operationKey) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
    const fields = z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("tts"), text: z.string(), exportAllowed: z.boolean() }),
        z.strictObject({
          kind: z.literal("image"),
          sourceId: z.uuid(),
          crop: z.unknown().optional(),
          exportAllowed: z.boolean(),
        }),
      ])
      .parse(input);
    if (fields.kind === "image") {
      const { kind: _, ...image } = fields;
      return {
        status: 201,
        body: await createImageMedia(db, store(), learner, { ...image, sessionId, operationKey }),
      };
    }
    const dependencies = getMediaDependencies();
    if (!dependencies) throw errors.validationFailed({ media: ["not_configured"] });
    const media = await requestTts(
      db,
      learner,
      { sessionId, text: fields.text, exportAllowed: fields.exportAllowed, operationKey },
      dependencies,
    );
    if (media.state === "queued") runJobsSoon(["media.tts"], 90);
    return { status: 202, body: media };
  };
}
export function mediaHandler(id: string): Handler {
  return async ({ db, ctx, request, input }) => {
    const learner = actor(ctx);
    z.uuid().parse(id);
    if (request.method === "GET") return { body: await getMediaAsset(db, learner, id) };
    return {
      body: await setMediaExportPermission(
        db,
        learner,
        id,
        z.strictObject({ exportAllowed: z.boolean() }).parse(input).exportAllowed,
      ),
    };
  };
}
export function mediaReadHandler(id: string): Handler {
  return async ({ db, ctx }) => {
    const learner = actor(ctx);
    z.uuid().parse(id);
    await getMediaAsset(db, learner, id);
    return { body: await mediaReadLink(db, store(), learner, id, readPltSettings().storage) };
  };
}
