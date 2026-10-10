import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "../../../packages/core/node_modules/zod";
import {
  type KnowledgeModel,
  renderClassNotesHtml,
  renderStudyCard,
} from "../../../packages/core/src/lkm";
import type { MigrationRoundState } from "./ledger";

/** Writes through a temporary file, so a crash never leaves half a JSON file behind. */
export async function saveJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
}

/** Every knowledge-family provider step the worker can dispatch for one class. */
export function knowledgeFamilyStep(step: string): boolean {
  return step === "knowledge" || step.startsWith("knowledge:");
}

/**
 * The knowledge dispatches of a content-contract run: its generation (knowledge), its one
 * recovery (knowledge:compact after truncation, knowledge:repair after an invalid lesson) and
 * the answer-span knowledge:study-repair. A json_object fallback joins its step.
 */
export const contentKnowledgeSteps = [
  "knowledge",
  "knowledge:compact",
  "knowledge:repair",
  "knowledge:study-repair",
] as const;
export function contentKnowledgeDispatch(stage: string): boolean {
  return (contentKnowledgeSteps as readonly string[]).includes(stage.replace(/:json$/, ""));
}

export const providerAttemptRecordSchema = z.strictObject({
  step: z.string(),
  attempt: z.number().int().positive(),
  httpRequests: z.number().int().nonnegative(),
  lastStatus: z.number().int().nullable(),
  outcome: z.enum(["generated", "rejected", "unknown", "refused"]),
});
export type ProviderAttemptRecord = z.infer<typeof providerAttemptRecordSchema>;

export interface DispatchRecord {
  operationKey: string;
  status: number | null;
  outcome: "response" | "unknown" | "refused";
}

/**
 * The worker's provider attempts, read from the dispatches themselves: its operation key is
 * `${runId}:${step}:${attempt}`, and its one json_object fallback adds `:json` to the same attempt.
 */
export function providerAttemptsFromDispatches(
  dispatches: readonly DispatchRecord[],
): ProviderAttemptRecord[] {
  const attempts = new Map<string, ProviderAttemptRecord>();
  for (const dispatch of dispatches) {
    const match = /^[0-9a-f-]{36}:(.+):(\d+)(?::json)?$/.exec(dispatch.operationKey);
    const step = match?.[1] ?? "unknown";
    const attempt = Number(match?.[2] ?? 1);
    const key = `${step}:${attempt}`;
    const previous = attempts.get(key);
    attempts.set(
      key,
      providerAttemptRecordSchema.parse({
        step,
        attempt,
        httpRequests: (previous?.httpRequests ?? 0) + (dispatch.outcome === "refused" ? 0 : 1),
        lastStatus: dispatch.status,
        outcome:
          dispatch.outcome === "refused"
            ? "refused"
            : dispatch.outcome === "unknown"
              ? "unknown"
              : dispatch.status !== null && dispatch.status >= 200 && dispatch.status < 300
                ? "generated"
                : "rejected",
      }),
    );
  }
  return [...attempts.values()];
}

/**
 * finalLocalPass: the run published an output version (ready, or partial_ready for incomplete
 * material). firstGenerationPass: that output came after exactly one knowledge-family generation,
 * i.e. one knowledge attempt and one knowledge-family response that carried a generation (2xx).
 * A rate-limited or grammar-rejected request generated nothing and is not a generation. On the
 * content contract the generations counted are the 2xx responses of contentKnowledgeSteps.
 */
export function caseOutcome(
  run: { state: string; lastError: string | null; outputVersionId: string | null },
  attempts: readonly ProviderAttemptRecord[],
  knowledgeGenerations: number,
) {
  const finalLocalPass =
    (run.state === "ready" || run.state === "partial_ready") && run.outputVersionId !== null;
  const knowledgeAttempts = attempts.filter((attempt) => knowledgeFamilyStep(attempt.step));
  const attemptsByStep: Record<string, number> = {};
  for (const attempt of attempts)
    attemptsByStep[attempt.step] = (attemptsByStep[attempt.step] ?? 0) + 1;
  return {
    runState: run.state,
    lastError: run.lastError,
    finalLocalPass,
    firstGenerationPass:
      finalLocalPass &&
      knowledgeGenerations === 1 &&
      knowledgeAttempts.every((attempt) => attempt.step === "knowledge"),
    attemptsByStep,
    providerAttempts: attempts.length,
    knowledgeGenerationAttempts: knowledgeAttempts.length,
    knowledgeGenerations,
  };
}

export const validationDossierSchema = z
  .object({
    caseId: z.string(),
    fixtureId: z.string(),
    repeat: z.boolean(),
    runState: z.string().nullable(),
    lastError: z.string().nullable(),
    finalLocalPass: z.boolean(),
    firstGenerationPass: z.boolean(),
    attemptsByStep: z.record(z.string(), z.number().int().nonnegative()),
    providerAttempts: z.number().int().nonnegative(),
    usdCost: z.number().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  })
  .passthrough();
export type ValidationDossier = z.infer<typeof validationDossierSchema>;

/** The same card shape as the haiku55 live harness: rendered front/back per learning item. */
export function studyCards(model: KnowledgeModel, explanationLanguage: string) {
  return model.learningItems.map((item) => ({
    id: item.id,
    ...renderStudyCard(item, explanationLanguage),
  }));
}

/** final-model.json, notes.html and cards.json of a published case, exactly as graders see them. */
export async function writePublishedCase(
  dossier: string,
  input: {
    publishedModel: KnowledgeModel;
    finalModel: KnowledgeModel;
    explanationLanguage: string;
  },
) {
  await saveJson(resolve(dossier, "published-model.json"), input.publishedModel);
  await saveJson(resolve(dossier, "final-model.json"), input.finalModel);
  await writeFile(resolve(dossier, "notes.html"), renderClassNotesHtml(input.finalModel));
  await saveJson(
    resolve(dossier, "cards.json"),
    studyCards(input.finalModel, input.explanationLanguage),
  );
}

/** summary.json in the haiku55 round layout, with this round's production-path facts. */
export function roundSummary(input: {
  freeze: string;
  model: string;
  mode: "live" | "mock-fetch";
  state: MigrationRoundState;
  expectedCases: number;
  cumulativeEvaluationUsd: number;
}) {
  const { state } = input;
  const results = state.results;
  return {
    freeze: input.freeze,
    syntheticOnly: true,
    actualProductionPipeline: true,
    mode: input.mode,
    model: input.model,
    completedCases: results.length,
    expectedCases: input.expectedCases,
    spentUsd: state.spentUsd,
    httpRequests: state.requests.length,
    paidResponses: state.requests.filter((request) => request.state === "completed").length,
    finalLocalPasses: results.filter((result) => result.finalLocalPass === true).length,
    firstGenerationPasses: results.filter((result) => result.firstGenerationPass === true).length,
    partialReadyCases: results.filter((result) => result.runState === "partial_ready").length,
    cumulativeMigrationQaUsd: input.cumulativeEvaluationUsd,
    stopped: state.stopped,
    stopReason: state.stopReason,
    unresolved: state.requests.filter((request) => request.state === "started"),
    uncertainOutcomes: state.requests.filter((request) => request.state === "uncertain"),
    results,
    contentQualityReviewStillRequired: true,
  };
}
