import "server-only";
import {
  ankiExportReadLink,
  getAnkiExport,
  listAnkiExports,
  requestAnkiExport,
} from "@recalino/core/anki";
import { getCard } from "@recalino/core/card";
import type { Tx } from "@recalino/core/db";
import {
  getHtmlExport,
  htmlExportReadLink,
  listHtmlExports,
  renderNotebookHtml,
  requestHtmlExport,
} from "@recalino/core/html";
import { getMediaAsset } from "@recalino/core/media";
import { getNotebookRevision } from "@recalino/core/note";
import { getSession } from "@recalino/core/org";
import {
  assertExportSize,
  type ExportArtifact,
  enqueueJob,
  errors,
  type LearnerContext,
  ownedObjectMetadata,
  readPltSettings,
} from "@recalino/core/plt";
import { z } from "zod";
import type { Handler, RequestContext } from "./api";
import { exportSettings, getExportDefinition, htmlMediaReader } from "./export-jobs";
import { runJobsSoon } from "./jobs";
import { getObjectStore } from "./storage";

const kindSchema = z.enum(["html", "anki"]);
const requestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("html"),
    action: z.enum(["preview", "create"]),
    revisionId: z.uuid(),
    mediaIds: z.array(z.uuid()).max(100),
    confirmed: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("anki"),
    action: z.enum(["preview", "create"]),
    cardIds: z.array(z.uuid()).min(1).max(10000),
    tags: z.array(z.string()).max(30),
    includeMedia: z.boolean(),
    expectedVersions: z.record(z.uuid(), z.int().positive()),
    confirmed: z.boolean().optional(),
  }),
]);
function actor(ctx: RequestContext): LearnerContext {
  if (!ctx.userId) throw errors.unauthenticated();
  return { userId: ctx.userId, requestId: ctx.requestId };
}
export function classExportsHandler(sessionId: string): Handler {
  return async ({ db, ctx, input, request }) => {
    const learner = actor(ctx);
    await getSession(db, learner, z.uuid().parse(sessionId));
    if (request.method === "GET") {
      const [html, anki] = await Promise.all([
        listHtmlExports(db, learner, sessionId),
        listAnkiExports(db, learner, sessionId),
      ]);
      return {
        body: {
          settings: exportSettings(),
          storageConfigured: getObjectStore() !== null,
          html,
          anki,
        },
      };
    }
    const fields = requestSchema.parse(input);
    const settings = exportSettings();
    if (!settings || !getObjectStore())
      throw errors.validationFailed({ exports: ["configuration_unavailable"] });
    let estimatedBytes: number;
    let items: number;
    if (fields.kind === "html") {
      if (new Set(fields.mediaIds).size !== fields.mediaIds.length)
        throw errors.validationFailed({ mediaIds: ["duplicate"] });
      const revision = await getNotebookRevision(db, learner, fields.revisionId);
      if (revision.sessionId !== sessionId) throw errors.notFound();
      estimatedBytes = renderNotebookHtml({
        revisionId: revision.id,
        revisionNumber: revision.number,
        model: revision.model,
        createdAt: revision.createdAt,
      }).length;
      for (const id of fields.mediaIds) {
        const media = await htmlMediaReader.describe(db, learner, id);
        if (media.sessionId !== sessionId) throw errors.notFound();
        estimatedBytes += Math.ceil(media.byteLength / 3) * 4 + 512;
      }
      items =
        revision.model.learningItems.length +
        revision.model.summary.length +
        revision.model.topics.reduce((n, t) => n + t.claims.length, 0) +
        revision.model.homework.length +
        revision.model.uncertainties.length;
    } else {
      estimatedBytes = 131072;
      items = fields.cardIds.length;
      if (new Set(fields.cardIds).size !== items)
        throw errors.validationFailed({ cardIds: ["duplicate"] });
      const mediaIds = new Set<string>();
      for (const id of fields.cardIds) {
        const card = await getCard(db, learner, id);
        if (!card.sessionIds.includes(sessionId)) throw errors.notFound();
        if (fields.expectedVersions[id] !== card.contentVersion) throw errors.conflict();
        if (card.template === "listening" && (!fields.includeMedia || !card.frontMediaId))
          throw errors.validationFailed({ media: ["listening_audio_export_required"] });
        if (fields.includeMedia)
          for (const mediaId of [card.frontMediaId, card.backMediaId])
            if (mediaId) mediaIds.add(mediaId);
        estimatedBytes +=
          new TextEncoder().encode(
            JSON.stringify({ front: card.front, back: card.back, provenance: card.provenance }),
          ).length * 3;
      }
      for (const id of mediaIds) {
        const media = await getMediaAsset(db, learner, id);
        if (media.state !== "ready" || !media.exportAllowed || !media.objectId)
          throw errors.validationFailed({ media: ["explicit_export_permission_required"] });
        estimatedBytes += (await ownedObjectMetadata(db, learner, media.objectId)).sizeBytes;
      }
    }
    if (items > settings.maxItems) throw errors.validationFailed({ items: ["export_limit"] });
    assertExportSize(estimatedBytes, settings);
    if (fields.action === "preview")
      return {
        body: {
          kind: fields.kind,
          estimatedBytes,
          items,
          settingsVersion: settings.version,
          excludes: ["class audio", "full transcript", "account information", "review history"],
        },
      };
    if (fields.confirmed !== true)
      throw errors.validationFailed({ confirmed: ["export_confirmation_required"] });
    const key = request.headers.get("idempotency-key");
    if (!key) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
    const definition = getExportDefinition(fields.kind);
    if (!definition) throw errors.validationFailed({ exports: ["configuration_unavailable"] });
    const onCreated = async (tx: Tx, artifact: ExportArtifact) => {
      await enqueueJob(tx, definition, {
        payload: { userId: learner.userId, artifactId: artifact.id },
        now: new Date(),
        defaults: readPltSettings().jobs,
        singletonKey: artifact.id,
      });
    };
    const result =
      fields.kind === "html"
        ? await requestHtmlExport(
            db,
            learner,
            { revisionId: fields.revisionId, mediaIds: fields.mediaIds },
            { key, settings, media: htmlMediaReader, onCreated },
          )
        : await requestAnkiExport(
            db,
            learner,
            {
              sessionId,
              cardIds: fields.cardIds,
              tags: fields.tags,
              includeMedia: fields.includeMedia,
              expectedVersions: fields.expectedVersions,
            },
            { key, settings, onCreated },
          );
    runJobsSoon([definition.kind], 90);
    return { status: 201, body: { kind: fields.kind, artifact: result } };
  };
}
export function exportArtifactHandler(kind: string, id: string): Handler {
  return async ({ db, ctx }) => {
    const learner = actor(ctx);
    const type = kindSchema.parse(kind);
    return {
      body:
        type === "html"
          ? await getHtmlExport(db, learner, z.uuid().parse(id))
          : await getAnkiExport(db, learner, z.uuid().parse(id)),
    };
  };
}
export function exportDownloadHandler(kind: string, id: string): Handler {
  return async ({ db, ctx }) => {
    const learner = actor(ctx);
    const type = kindSchema.parse(kind);
    if (type === "html") await getHtmlExport(db, learner, z.uuid().parse(id));
    else await getAnkiExport(db, learner, z.uuid().parse(id));
    const store = getObjectStore();
    if (!store) throw errors.validationFailed({ storage: ["unavailable"] });
    return {
      body:
        type === "html"
          ? await htmlExportReadLink(
              db,
              store,
              learner,
              id,
              readPltSettings().storage,
              new Date(),
              htmlMediaReader,
            )
          : await ankiExportReadLink(db, store, learner, id, readPltSettings().storage),
    };
  };
}
