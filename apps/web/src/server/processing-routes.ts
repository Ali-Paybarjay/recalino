import "server-only";
import type { Database } from "@recalino/core/db";
import { listAvailableKnowledgeReferences } from "@recalino/core/lkm";
import { getSession } from "@recalino/core/org";
import { errors, type LearnerContext } from "@recalino/core/plt";
import {
  activateProcessingRun,
  assertKnownSourceInputBound,
  cancelRun,
  chargeableRunAmounts,
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
import { type Handler, idempotencyKey, learnerActor } from "./api";
import { PROCESSING_WAKE, runJobsSoon } from "./jobs";
import { getProcessingDefinition } from "./processing-jobs";
import { TEACHING_MEMORY_IN_GENERATION } from "./teaching-memory";

function options() {
  const job = getProcessingDefinition();
  if (!job) throw errors.validationFailed({ processing: ["storage_unavailable"] });
  // A retry uses the same options, so it follows the same D49 release switch.
  return { provider: getAiProvider(), job, teachingMemory: TEACHING_MEMORY_IN_GENERATION };
}
/**
 * GET lists the class's runs. D105 (owner decision 2026-10-20): the old manual confirmation can no
 * longer start a run around the learner's request; lesson work starts only with
 * POST /api/classes/[id]/learning {action:"process"}, so this POST is refused for the owner.
 */
export function classProcessingHandler(sessionId: string): Handler {
  return async ({ db, ctx, request }) => {
    z.uuid().parse(sessionId);
    const learner = learnerActor(ctx);
    if (request.method === "GET") return { body: await listRuns(db, learner, sessionId) };
    await getSession(db, learner, sessionId);
    throw errors.conflict({ processing: ["process_session_required"] });
  };
}
export function processingEstimateHandler(sessionId: string): Handler {
  return async ({ db, ctx }) => {
    return { body: await readProcessingEstimate(db, learnerActor(ctx), sessionId) };
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
  // Existence only: version references, never the stored lesson model.
  const regeneration =
    (await listAvailableKnowledgeReferences(db, learner, [sessionId])).length > 0;
  // D59: the same charge-once amounts the confirmation will reserve.
  const requested = provider
    ? await chargeableRunAmounts(db, learner, {
        sessionId,
        entitlementId: balance.entitlementId,
        sources: snapshot.sources,
        charactersPerPage: provider.settings.charactersPerPage,
        regeneration,
      })
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
    const learner = learnerActor(ctx);
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
        ? await retryRun(db, learner, id, idempotencyKey(request), deps)
        : await activateProcessingRun(db, learner, id, deps.job);
    runJobsSoon(["proc.process"], PROCESSING_WAKE.budgetSeconds, PROCESSING_WAKE.functionSeconds);
    return { status: 202, body: run };
  };
}
