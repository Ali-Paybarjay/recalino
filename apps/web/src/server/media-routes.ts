import "server-only";
import { getCard, studyPronunciationTarget } from "@recalino/core/card";
import type { Database } from "@recalino/core/db";
import {
  createImageMedia,
  getMediaAsset,
  listMediaAssets,
  type MediaAsset,
  mediaReadLink,
  requestTts,
  setMediaExportPermission,
} from "@recalino/core/media";
import { getNotebook } from "@recalino/core/note";
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

/** Include the private playback link in a ready response to avoid another network round trip. */
async function withPlayback(db: Database, learner: LearnerContext, media: MediaAsset) {
  if (media.state !== "ready" || media.kind !== "tts" || !media.mimeType?.startsWith("audio/"))
    return media;
  try {
    return {
      ...media,
      playback: await mediaReadLink(db, store(), learner, media.id, readPltSettings().storage),
    };
  } catch {
    // Preserve the known asset if signing is temporarily unavailable. The player can retry
    // the existing read-link endpoint without starting another speech generation.
    return media;
  }
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
          kind: z.literal("pronunciation"),
          cardId: z.uuid(),
          expectedContentVersion: z.number().int().positive(),
        }),
        z.strictObject({
          kind: z.literal("note_pronunciation"),
          learningItemId: z.string().min(1).max(100),
          expectedNotebookRevisionId: z.uuid(),
        }),
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
    let speech: { text: string; exportAllowed: boolean; purpose?: "pronunciation" };
    if (fields.kind === "pronunciation") {
      const card = await getCard(db, learner, fields.cardId);
      if (!card.sessionIds.includes(sessionId)) throw errors.notFound();
      if (card.contentVersion !== fields.expectedContentVersion)
        throw errors.validationFailed({ pronunciation: ["card_changed"] });
      if (!card.pronunciationTarget)
        throw errors.validationFailed({ pronunciation: ["target_unavailable"] });
      speech = {
        text: card.pronunciationTarget,
        exportAllowed: false,
        purpose: "pronunciation" as const,
      };
    } else if (fields.kind === "note_pronunciation") {
      const notebook = await getNotebook(db, learner, sessionId);
      if (!notebook || notebook.sessionId !== sessionId) throw errors.notFound();
      if (notebook.current.id !== fields.expectedNotebookRevisionId)
        throw errors.validationFailed({ pronunciation: ["notebook_changed"] });
      const item = notebook.current.model.learningItems.find(
        (entry) => entry.id === fields.learningItemId,
      );
      if (!item) throw errors.notFound();
      const target = studyPronunciationTarget(item);
      if (!target) throw errors.validationFailed({ pronunciation: ["target_unavailable"] });
      speech = { text: target, exportAllowed: false, purpose: "pronunciation" };
    } else speech = { text: fields.text, exportAllowed: fields.exportAllowed };
    const dependencies = getMediaDependencies();
    if (!dependencies) throw errors.validationFailed({ media: ["not_configured"] });
    const media = await requestTts(
      db,
      learner,
      { sessionId, ...speech, operationKey },
      dependencies,
    );
    if (media.state === "queued")
      runJobsSoon(["media.tts"], 90, 120, { userId: learner.userId, subjectId: media.id });
    return {
      status: 202,
      body: speech.purpose === "pronunciation" ? await withPlayback(db, learner, media) : media,
    };
  };
}
export function mediaHandler(id: string): Handler {
  return async ({ db, ctx, request, input }) => {
    const learner = actor(ctx);
    z.uuid().parse(id);
    if (request.method === "GET") {
      const media = await getMediaAsset(db, learner, id);
      return {
        body:
          new URL(request.url).searchParams.get("playback") === "1"
            ? await withPlayback(db, learner, media)
            : media,
      };
    }
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
