import "server-only";
import type { Database } from "@recalino/core/db";
import { getLatestVersion } from "@recalino/core/lkm";
import { getSession } from "@recalino/core/org";
import { errors, type LearnerContext } from "@recalino/core/plt";
import {
  activateProcessingRun,
  assertKnownSourceInputBound,
  cancelRun,
  createProcessingRun,
  estimateRunAmounts,
  getProcessingRunSnapshot,
  getRun,
  listRuns,
  processingSelectionFingerprint,
  retryRun,
  selectProcessingSourceSnapshot,
  sourceSnapshotSchema,
} from "@recalino/core/proc";
import { allowance } from "@recalino/core/quota";
import { z } from "zod";
import { getAiProvider } from "./ai";
import type { Handler, RequestContext } from "./api";
import { runJobsSoon } from "./jobs";
import { getProcessingDefinition } from "./processing-jobs";
import { practiceCandidatesBeforeRun } from "./teaching-memory";

function actor(ctx: RequestContext): LearnerContext {
  if (!ctx.userId) throw errors.unauthenticated();
  return { userId: ctx.userId, requestId: ctx.requestId };
}
function options() {
  const job = getProcessingDefinition();
  if (!job) throw errors.validationFailed({ processing: ["storage_unavailable"] });
  return { provider: getAiProvider(), job };
}
function operationKey(request: Request) {
  const key = request.headers.get("idempotency-key");
  if (!key) throw errors.validationFailed({ "Idempotency-Key": ["required"] });
  return key;
}
export function classProcessingHandler(sessionId: string): Handler {
  return async ({ db, ctx, request, input }) => {
    z.uuid().parse(sessionId);
    const learner = actor(ctx);
    if (request.method === "GET") return { body: await listRuns(db, learner, sessionId) };
    await getSession(db, learner, sessionId);
    const expected = z
      .strictObject({
        expectedFingerprint: z.string().min(1),
        expectedSourcesVersion: z.number().int().nonnegative(),
      })
      .parse(input);
    // D49: bounded practice points, read before the run transaction and frozen with the run.
    const practiceCandidates = await practiceCandidatesBeforeRun(
      db,
      learner,
      sessionId,
      new Date(),
    );
    const run = await createProcessingRun(
      db,
      learner,
      { sessionId, operationKey: operationKey(request), ...expected },
      { ...options(), practiceCandidates: async () => practiceCandidates },
    );
    if (run.state === "queued") runJobsSoon(["proc.process"], 90);
    return { status: 202, body: run };
  };
}
export function processingEstimateHandler(sessionId: string): Handler {
  return async ({ db, ctx }) => {
    return { body: await readProcessingEstimate(db, actor(ctx), sessionId) };
  };
}
export async function readProcessingEstimate(
  db: Database,
  learner: LearnerContext,
  sessionId: string,
) {
  z.uuid().parse(sessionId);
  const snapshot = sourceSnapshotSchema.parse(
    await selectProcessingSourceSnapshot(db, learner, sessionId),
  );
  const provider = getAiProvider();
  const balance = await allowance(db, learner);
  if (provider) assertKnownSourceInputBound(snapshot, provider.settings.maxInputCharacters);
  const regeneration = (await getLatestVersion(db, learner, sessionId)) !== null;
  const requested = provider
    ? estimateRunAmounts(snapshot, provider.settings.charactersPerPage, regeneration)
    : null;
  return {
    snapshot,
    selectionFingerprint: processingSelectionFingerprint(snapshot),
    requested,
    allowance: balance,
    providerConfigured: provider?.settings.dataContractApproved === true,
    models: provider
      ? {
          language: provider.settings.llmModel,
          image: provider.settings.visionModel,
          transcription: provider.settings.sttModel,
        }
      : null,
  };
}
export function processingRunHandler(id: string): Handler {
  return async ({ db, ctx, request, input }) => {
    z.uuid().parse(id);
    const learner = actor(ctx);
    if (request.method === "GET") {
      const run = await getRun(db, learner, id);
      if (new URL(request.url).searchParams.get("includeSnapshot") === "1")
        return {
          body: {
            run,
            snapshot:
              run.state === "awaiting_upload"
                ? await getProcessingRunSnapshot(db, learner, id)
                : null,
          },
        };
      return { body: run };
    }
    if (request.method === "DELETE") return { body: await cancelRun(db, learner, id) };
    await getRun(db, learner, id);
    const fields = z.strictObject({ action: z.enum(["retry", "activate"]) }).parse(input);
    const deps = options();
    const run =
      fields.action === "retry"
        ? await retryRun(db, learner, id, operationKey(request), deps)
        : await activateProcessingRun(db, learner, id, deps.job);
    runJobsSoon(["proc.process"], 90);
    return { status: 202, body: run };
  };
}
