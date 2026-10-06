import "server-only";
import { enqueueJob, errors, type LearnerContext, readPltSettings } from "@recalino/core/plt";
import {
  coordinateSourceDeletion,
  findPrivacyDeletionRequest,
  persistDeletionJournal,
} from "@recalino/core/priv";
import { getRun, validateAudioUploadRun } from "@recalino/core/proc";
import {
  acceptSourceNotice,
  attachSource,
  beginTemporaryAudioUpload,
  confirmTemporaryAudioPart,
  confirmUploadPart,
  createSource,
  deleteSource,
  detachSource,
  getSource,
  readInputContract,
  sessionSources,
  sourceAssets,
  sourceContentVersions,
  sourceNoticeAccepted,
  sourceReadLink,
  temporaryAudioManifest,
  temporaryAudioPartLink,
  unlockPdf,
  updateSourceSelection,
  uploadManifest,
  uploadPartLink,
} from "@recalino/core/src";
import { after } from "next/server";
import { z } from "zod";
import type { Handler, RequestContext } from "./api";
import { notifyAutomaticLearning } from "./automatic-learning-notifications";
import { runJobsSoon } from "./jobs";
import { privacyDependencies } from "./privacy";
import { sourceAudioJobDefinition, sourceUploadJobDefinition } from "./source-jobs";
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
export function sourceContractHandler(): Handler {
  return async ({ db, ctx }) => {
    const contract = await readInputContract(db);
    return {
      body: {
        contract,
        noticeAccepted: await sourceNoticeAccepted(db, actor(ctx), contract.noticeVersion),
        storageConfigured: getObjectStore() !== null,
      },
    };
  };
}
export function sourceNoticeHandler(): Handler {
  return async ({ db, ctx, input }) => {
    const fields = z.strictObject({ version: z.string(), confirmed: z.boolean() }).parse(input);
    await acceptSourceNotice(db, actor(ctx), fields.version, fields.confirmed);
    return { body: { accepted: true } };
  };
}
export function sourcesHandler(): Handler {
  return async ({ db, ctx, request, input }) => {
    if (request.method === "GET")
      return {
        body: await sourceAssets(
          db,
          actor(ctx),
          new URL(request.url).searchParams.get("checksum") ?? undefined,
        ),
      };
    const fields = z.object({ kind: z.string() }).parse(input);
    if (fields.kind !== "audio") store();
    const operationKey = request.headers.get("idempotency-key");
    if (!operationKey) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
    const learner = actor(ctx);
    const body = await createSource(db, learner, {
      ...(input as Record<string, unknown>),
      operationKey,
    });
    const sessionId = (input as Record<string, unknown>).sessionId;
    if (typeof sessionId === "string") await notifyAutomaticLearning(db, learner, sessionId);
    return { status: 201, body };
  };
}
export function sourceHandler(id: string): Handler {
  return async ({ db, ctx, input, request }) => {
    z.uuid().parse(id);
    if (request.method === "GET") return { body: await getSource(db, actor(ctx), id) };
    const fields = z.strictObject({ mode: z.enum(["original", "all"]) }).parse(input);
    const learner = actor(ctx);
    const dependencies = privacyDependencies();
    const body = await deleteSource(db, learner, id, fields.mode, new Date(), {
      onDelete: async (tx, sourceId, _, sessionIds) => {
        await coordinateSourceDeletion(tx, learner, sourceId, sessionIds, dependencies);
      },
    });
    if (fields.mode === "all") {
      const receipt = await findPrivacyDeletionRequest(db, learner, "source", id);
      if (!receipt) throw errors.conflict();
      await persistDeletionJournal(db, learner, receipt.id, dependencies);
      runJobsSoon(["src.maintenance", "priv.cleanup"], 90);
      return { status: 202, body: { ...body, privacyRequestId: receipt.id } };
    }
    runJobsSoon(["src.maintenance", "priv.cleanup"], 90);
    return { body };
  };
}
export function sourceContentHandler(id: string): Handler {
  return async ({ db, ctx }) => ({
    body: await sourceContentVersions(db, actor(ctx), z.uuid().parse(id)),
  });
}
export function sourceReadHandler(id: string): Handler {
  return async ({ db, ctx }) => {
    const learner = actor(ctx);
    await getSource(db, learner, z.uuid().parse(id));
    return { body: await sourceReadLink(db, store(), learner, id, readPltSettings().storage) };
  };
}
export function classSourcesHandler(id: string): Handler {
  return async ({ db, ctx, input, request }) => {
    z.uuid().parse(id);
    if (request.method === "GET") return { body: await sessionSources(db, actor(ctx), id) };
    const fields = z.strictObject({ assetId: z.uuid() }).parse(input);
    const learner = actor(ctx);
    const linkId = await attachSource(db, learner, id, fields.assetId);
    await notifyAutomaticLearning(db, learner, id);
    return { body: { linkId } };
  };
}
export function classSourceHandler(id: string, sourceId: string): Handler {
  return async ({ db, ctx, input, request }) => {
    z.uuid().parse(id);
    z.uuid().parse(sourceId);
    if (request.method === "DELETE") {
      await detachSource(db, actor(ctx), id, sourceId);
      return { body: { removed: true } };
    }
    const learner = actor(ctx);
    const body = await updateSourceSelection(db, learner, id, sourceId, input);
    await notifyAutomaticLearning(db, learner, id);
    return { body };
  };
}
export function sourceUploadHandler(id: string): Handler {
  return async ({ db, ctx }) => ({
    body: await uploadManifest(db, actor(ctx), z.uuid().parse(id)),
  });
}
export function sourcePartHandler(id: string, index: string): Handler {
  return async ({ db, ctx, request }) => {
    const learner = actor(ctx);
    await uploadManifest(db, learner, z.uuid().parse(id));
    const partIndex = z.coerce.number().int().nonnegative().parse(index);
    if (request.method === "POST") {
      const result = await confirmUploadPart(db, store(), learner, id, partIndex);
      if (result !== "verified") throw errors.validationFailed({ upload: ["part_not_verified"] });
      return { body: { confirmed: true } };
    }
    return {
      body: await uploadPartLink(db, store(), learner, id, partIndex, readPltSettings().storage),
    };
  };
}
export function sourceCompleteHandler(id: string): Handler {
  return async ({ db, ctx }) => {
    const learner = actor(ctx);
    const manifest = await uploadManifest(db, learner, z.uuid().parse(id));
    if (["verified", "rejected", "abandoned", "deleted"].includes(manifest.state))
      return { body: manifest };
    const definition = sourceUploadJobDefinition();
    if (!definition) throw errors.validationFailed({ storage: ["unavailable"] });
    const jobId = await db.transaction().execute((tx) =>
      enqueueJob(tx, definition, {
        payload: { userId: learner.userId, uploadId: id },
        singletonKey: `src:${id}`,
        now: new Date(),
        defaults: readPltSettings().jobs,
      }),
    );
    runJobsSoon(["src.verify_upload"], 90);
    return { status: 202, body: { ...manifest, jobId } };
  };
}

export function sourceUnlockHandler(assetId: string): Handler {
  return async ({ db, ctx, input }) => {
    const learner = actor(ctx),
      source = await getSource(db, learner, z.uuid().parse(assetId));
    if (source.kind !== "pdf" || !source.verified_at || source.page_count) throw errors.conflict();
    let { password } = z.strictObject({ password: z.string().min(1).max(1000) }).parse(input);
    const storage = store();
    after(async () => {
      try {
        await unlockPdf(db, storage, learner, assetId, password);
      } finally {
        password = "";
      }
    });
    return { status: 202, body: { state: "unlocking" } };
  };
}

const audioRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("start"),
    runId: z.uuid(),
    reservationId: z.uuid(),
    parts: z
      .array(
        z.strictObject({
          index: z.number().int().nonnegative(),
          sizeBytes: z.number().int().positive(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .min(1)
      .max(10000),
  }),
  z.strictObject({ action: z.literal("complete"), runId: z.uuid(), uploadId: z.uuid() }),
  z.strictObject({
    action: z.literal("confirm_part"),
    runId: z.uuid(),
    uploadId: z.uuid(),
    index: z.number().int().nonnegative(),
  }),
]);
export function sourceAudioHandler(assetId: string): Handler {
  return async ({ db, ctx, input, request }) => {
    const learner = actor(ctx);
    await getSource(db, learner, z.uuid().parse(assetId));
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams,
        uploadId = z.uuid().parse(query.get("uploadId"));
      const manifest = await temporaryAudioManifest(db, learner, assetId, uploadId);
      const index = query.get("index");
      return {
        body:
          index === null
            ? manifest
            : await temporaryAudioPartLink(
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
    const fields = audioRequestSchema.parse(input),
      run = await getRun(db, learner, fields.runId);
    if (fields.action === "start") {
      await validateAudioUploadRun(db, learner, run.id, assetId, fields.reservationId);
      store();
      return {
        status: 201,
        body: await beginTemporaryAudioUpload(db, learner, assetId, {
          reservationId: fields.reservationId,
          parts: fields.parts,
        }),
      };
    }
    const manifest = await temporaryAudioManifest(db, learner, assetId, fields.uploadId);
    await validateAudioUploadRun(db, learner, run.id, assetId, manifest.reservationId);
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
    const definition = sourceAudioJobDefinition();
    if (!definition) throw errors.validationFailed({ audio: ["verifier_unavailable"] });
    const jobId = await db.transaction().execute((tx) =>
      enqueueJob(tx, definition, {
        payload: { userId: learner.userId, assetId, uploadId: fields.uploadId, runId: run.id },
        singletonKey: `audio:${fields.uploadId}`,
        now: new Date(),
        defaults: readPltSettings().jobs,
      }),
    );
    // Verification activates the confirmed run; keep its processing jobs moving immediately.
    runJobsSoon(["src.verify_audio", "proc.process"], 90);
    return { status: 202, body: { ...manifest, jobId } };
  };
}
