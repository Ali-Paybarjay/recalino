import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  OpenRouterProvider,
  ProviderError,
  providerSettingsSchema,
} from "../../packages/core/src/aip";
import {
  assignGeneratedKnowledgeIds,
  type KnowledgeModel,
  modelClaims,
  normalizeGeneratedStudyModel,
  renderClassNotesHtml,
  renderStudyCard,
  validateKnowledgeModel,
} from "../../packages/core/src/lkm";
import { AppError, errors, sha256Hex } from "../../packages/core/src/plt";
import type { RunSource } from "../../packages/core/src/proc/contracts";
import {
  generatedKnowledgeSchema,
  legacyKnowledgeWireSchema,
} from "../../packages/core/src/proc/generated-knowledge";
import {
  finalizeGeneratedStudyPractice,
  type GeneratedPracticeAudit,
} from "../../packages/core/src/proc/generated-study-practice";
import {
  compactKnowledgeBudget,
  compactKnowledgeInstruction,
} from "../../packages/core/src/proc/knowledge-compact";
import { buildKnowledgeInput } from "../../packages/core/src/proc/knowledge-input";
import { buildKnowledgeRepairInput } from "../../packages/core/src/proc/knowledge-repair";
import { buildKnowledgeStudyRepairInput } from "../../packages/core/src/proc/knowledge-study-repair";
import { buildKnowledgeTranslationInput } from "../../packages/core/src/proc/knowledge-translation";
import {
  declaredTeachingContext,
  modelTeachingContext,
  selectPracticeFocus,
  snapshotLearnerTeachingContext,
} from "../../packages/core/src/proc/learner-context";
import { knowledgePrompt } from "../../packages/core/src/proc/worker";
import { automaticSourceRole, sourceClassificationPrompt } from "../../packages/core/src/src";

// An explicitly invoked live evaluation, never discovered by the mocked test suite.
const live = process.argv.includes("--run-live");
const replayIndex = process.argv.indexOf("--replay-from");
const replayFrom = replayIndex < 0 ? undefined : process.argv[replayIndex + 1];
if (replayIndex >= 0 && !replayFrom)
  throw new Error("A captured synthetic evaluation directory is required.");
if (live && replayFrom) throw new Error("Replay never sends new provider requests.");
const noRepair = process.argv.includes("--no-repair");
const levelIndex = process.argv.indexOf("--level");
const selectedLevel = levelIndex < 0 ? undefined : process.argv[levelIndex + 1];
if (selectedLevel !== undefined && selectedLevel !== "A2" && selectedLevel !== "B2")
  throw new Error("The synthetic evaluation level must be A2 or B2.");
// D49: opt-in memory case — an explicit simpler-explanation choice plus synthetic practice points.
const memory = process.argv.includes("--memory");
const startedAt = new Date().toISOString();
const directory = resolve(
  memory ? "artifacts/verification/d49-live-teaching" : "artifacts/verification/d46-live-teaching",
  startedAt.replace(/[:.]/g, "-"),
);
const settings = providerSettingsSchema.parse(
  JSON.parse(await readFile("config/openrouter-defaults.json", "utf8")),
);
const sourceId = "11111111-1111-4111-8111-111111111111";
const lessonContext = { date: "2026-10-07", course: "Synthetic English comparison" };
const source: RunSource = {
  sourceId,
  contentVersionId: "22222222-2222-4222-8222-222222222222",
  objectId: null,
  sha256: sha256Hex("D46 synthetic lesson, no learner data"),
  kind: "text",
  mimeType: "text/plain",
  role: "class_material",
  durationMs: null,
  pageCount: null,
  captureAnchor: null,
  ranges: [],
  units: [{ id: "lesson", kind: "document", start: 1, status: "extracted" }],
  blocks: [
    {
      id: "purpose",
      unitId: "lesson",
      kind: "paragraph",
      text: "Synthetic English lesson: talk about changes, plans and getting along with people. This printed class material contains no learner answers, handwriting, audio, speaker identities or homework.",
    },
    {
      id: "perfect",
      unitId: "lesson",
      kind: "paragraph",
      text: "The present perfect links a past event to now: have/has + past participle. Class examples: I have lost my keys. (They are still missing.) I lost my keys yesterday. (A finished past time.) Do not combine yesterday with the present perfect. Contrast the present result with a finished past time; do not claim that these examples are the learner's own sentences.",
    },
    {
      id: "forward",
      unitId: "lesson",
      kind: "paragraph",
      text: "look forward to means feel pleased about a future event. The word to is a preposition, followed by a noun or an -ing form. Class example: I look forward to meeting my new neighbours. A useful contrast is look forward to meeting, not look forward to meet. Common combinations include look forward to a holiday and look forward to seeing someone.",
    },
    {
      id: "along",
      unitId: "lesson",
      kind: "paragraph",
      text: "get on with someone means have a friendly relationship with them in British English. Class example: I get on with my neighbours very well. Common combinations include get on with colleagues and get on well with someone. The lesson did not teach the different sense get on with a task.",
    },
  ],
};
// Synthetic class identifier only; the live evaluation never reads or writes a database.
const SYNTHETIC_SOURCE_CLASS = "00000000-0000-4000-8000-0000000000d4";
const cases = (["A2", "B2"] as const)
  .filter((level) => selectedLevel === undefined || selectedLevel === level)
  .map((declaredLevel) => {
    const snapshot = snapshotLearnerTeachingContext(
      { level: declaredLevel, goal: "general" },
      memory
        ? {
            simplerExplanations: true,
            // Synthetic points only. "be pressed for time" is absent from the lesson and must
            // be filtered out before the model sees anything.
            practiceCandidates: [
              {
                target: "look forward to + -ing / noun",
                reason: "recall_difficulty",
                scope: "same_course",
                againCount: 3,
                lastEvidenceDate: "2026-10-06",
                sourceSessionId: SYNTHETIC_SOURCE_CLASS,
              },
              {
                target: "get on with sb",
                reason: "asked_simpler",
                scope: "this_class",
                againCount: 0,
                lastEvidenceDate: "2026-10-05",
                sourceSessionId: SYNTHETIC_SOURCE_CLASS,
              },
              {
                target: "be pressed for time",
                reason: "recall_difficulty",
                scope: "same_course",
                againCount: 2,
                lastEvidenceDate: "2026-10-04",
                sourceSessionId: SYNTHETIC_SOURCE_CLASS,
              },
            ],
          }
        : {},
    );
    const learnerContext = modelTeachingContext(snapshot, selectPracticeFocus(snapshot, [source]));
    const data = {
      explanationLanguage: "fa",
      teachingPreferences: { shorterExamples: false },
      learnerContext,
      lessonContext,
      sources: [source],
      missingSourceIds: [] as string[],
    };
    return {
      declaredLevel,
      data,
      prepared: buildKnowledgeInput(data, settings.maxInputCharacters),
    };
  });
if (!live && !replayFrom) {
  process.stdout.write(
    `${JSON.stringify({ live: false, model: settings.llmModel, plannedGenerations: cases.length, maxOutputTokens: settings.maxOutputTokens, cases: cases.map((item) => ({ declaredLevel: item.declaredLevel, inputCharacters: item.prepared.input.length })), command: `pnpm exec tsx tools/eval/personalized-teaching-live.ts --run-live${memory ? " --memory" : ""}`, memory, learnerContext: cases.map((item) => item.data.learnerContext) })}\n`,
  );
  process.exit(0);
}

const envIndex = process.argv.indexOf("--env-file");
const envFile = envIndex < 0 ? "apps/web/.env.local" : process.argv[envIndex + 1];
if (!envFile) throw new Error("An existing provider environment file must be specified.");
let credential = "synthetic-replay-network-disabled";
if (live) {
  credential = process.env.OPENROUTER_API_KEY ?? "";
  if (!credential) credential = parseEnv(await readFile(envFile, "utf8")).OPENROUTER_API_KEY ?? "";
}
if (!credential) throw new Error("Existing provider credential unavailable.");
if (
  replayFrom &&
  JSON.stringify(
    JSON.parse(await readFile(resolve(replayFrom, "synthetic-source.json"), "utf8")),
  ) !== JSON.stringify(source)
)
  throw new Error("Captured source differs from the fixed synthetic lesson.");
const providerCredential = credential;
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "synthetic-source.json"), JSON.stringify(source, null, 2));
interface Receipt {
  level: string;
  stage: string;
  status: number;
  requestId?: string;
  model?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  usdCost?: number;
}
const receipts: Receipt[] = [];
let current = { level: "", stage: "" };
const provider = new OpenRouterProvider(providerCredential, settings, async (url, init) => {
  if (!live) throw new Error("Replay network dispatch is disabled.");
  const response = await fetch(url, init);
  const receipt: Receipt = { ...current, status: response.status };
  const syntheticResponse = await response
    .clone()
    .json()
    .catch(() => null);
  await writeFile(
    resolve(directory, `${current.level}-${current.stage}-response-${receipts.length + 1}.json`),
    JSON.stringify(
      { syntheticOnly: true, status: response.status, body: syntheticResponse },
      null,
      2,
    ).replaceAll(providerCredential, "[redacted]"),
  );
  if (response.ok) {
    const raw = syntheticResponse as {
      id?: string;
      model?: string;
      choices?: { finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    receipt.requestId = raw.id;
    receipt.model = raw.model;
    receipt.finishReason = raw.choices?.[0]?.finish_reason;
    receipt.inputTokens = raw.usage?.prompt_tokens;
    receipt.outputTokens = raw.usage?.completion_tokens;
    receipt.cachedInputTokens = raw.usage?.prompt_tokens_details?.cached_tokens;
    receipt.usdCost = raw.usage?.cost;
  }
  receipts.push(receipt);
  await writeFile(resolve(directory, "receipts.json"), JSON.stringify(receipts, null, 2));
  return response;
});
function reason(error: unknown): string {
  if (error instanceof ProviderError) return error.code;
  if (error instanceof AppError) {
    const fields = error.details?.fields;
    const output =
      fields && typeof fields === "object" && "output" in fields ? fields.output : undefined;
    return Array.isArray(output) && typeof output[0] === "string" ? output[0] : error.code;
  }
  return "evaluation_error";
}
function validate(generated: ReturnType<typeof generatedKnowledgeSchema.parse>): KnowledgeModel {
  if (
    generated.sourceClassifications.length !== 1 ||
    generated.sourceClassifications[0]?.sourceId !== source.sourceId
  )
    throw errors.validationFailed({ output: ["source_classification_invalid"] });
  const { sourceClassifications, ...knowledge } = generated;
  const classified = {
    ...source,
    role: automaticSourceRole(
      source.kind,
      sourceClassifications[0]?.classification ?? { role: "class_material", confidence: "high" },
    ),
  };
  return validateKnowledgeModel(
    {
      ...assignGeneratedKnowledgeIds(normalizeGeneratedStudyModel(knowledge, false)),
      coverage: { complete: true, missingSourceIds: [] },
    },
    [classified],
    "fa",
  );
}
const results: {
  level: string;
  passed: boolean;
  initialValidation?: string;
  finalError?: string;
  durationMs: number;
  productionItems?: number;
  recognitionItems?: number;
  sourcedClaims?: number;
  aiClaims?: number;
  rawSourceWarnings?: string[];
  generatedPractice?: GeneratedPracticeAudit;
  files?: Record<string, string>;
}[] = [];
const repairable = new Set([
  "language_script_mismatch",
  "source_classification_invalid",
  "source_reference_invalid",
  "evidence_kind_mismatch",
  "time_reference_invalid",
  "page_reference_invalid",
  "text_reference_invalid",
  "unverified_user_action",
  "class_evidence_missing",
  "expansion_attribution_invalid",
  "teacher_attribution_invalid",
  "teacher_role_unconfirmed",
  "study_language_invalid",
  "study_approximation_missing",
  "study_approximation_unsupported",
  "study_grammar_prompt_missing",
  "study_gap_missing",
  "study_gap_hint",
  "study_gap_invalid",
  "study_sentence_mismatch",
  "study_answer_exposed",
  "study_target_unsupported",
  "study_core_limit",
  "study_mistake_item_missing",
]);
for (const item of cases) {
  const began = Date.now();
  let initialValidation: string | undefined;
  let uncertain = false;
  try {
    const generate = async (compact: boolean) => {
      if (replayFrom)
        return {
          output: generatedKnowledgeSchema.parse(
            JSON.parse(
              await readFile(resolve(replayFrom, `${item.declaredLevel}-generated.json`), "utf8"),
            ),
          ),
        };
      current = { level: item.declaredLevel, stage: compact ? "compact" : "generation" };
      return provider.structured({
        operationKey: randomUUID(),
        model: settings.llmModel,
        schema: legacyKnowledgeWireSchema,
        schemaName: "class_knowledge",
        system: [
          knowledgePrompt(
            "fa",
            false,
            compact ? compactKnowledgeBudget(settings.maxOutputTokens) : settings.maxOutputTokens,
            false,
            item.data.learnerContext,
          ),
          item.prepared.sourceRefPrompt,
          "Return one sourceClassifications entry per source, using the exact sourceId. " +
            sourceClassificationPrompt +
            " Audio always uses evidence audio; use class_material as its classification placeholder. Images already have an automatically detected role from vision: preserve that category. Use the detected category when choosing claim evidence, but never treat personal notes as proof of authorship or a speaker's identity.",
          ...(compact ? [compactKnowledgeInstruction("fa")] : []),
        ].join(" "),
        input: item.prepared.input,
      });
    };
    let generated: ReturnType<typeof generatedKnowledgeSchema.parse>;
    try {
      generated = (await generate(false)).output;
    } catch (error) {
      if (
        noRepair ||
        !(error instanceof ProviderError) ||
        error.uncertain ||
        !error.accounting ||
        error.code !== "provider_output_truncated"
      )
        throw error;
      initialValidation = error.code;
      generated = (await generate(true)).output;
    }
    await writeFile(
      resolve(directory, `${item.declaredLevel}-generated.json`),
      JSON.stringify(generated, null, 2),
    );
    const warnings: string[] = [];
    if (modelClaims(generated).some((claim) => claim.speakerRole !== "unknown"))
      warnings.push("unexpected_speaker_role");
    if (generated.classNotes?.mistakes?.items.length) warnings.push("unexpected_learner_mistake");
    if (
      generated.classNotes?.date !== lessonContext.date ||
      generated.classNotes?.course !== lessonContext.course
    )
      warnings.push("incorrect_lesson_context");
    let model: KnowledgeModel;
    try {
      model = validate(generated);
    } catch (error) {
      const failure = reason(error);
      initialValidation = failure;
      process.stdout.write(
        `${JSON.stringify({ level: item.declaredLevel, semanticFailure: failure, startingBoundedRepair: !noRepair && repairable.has(failure) })}\n`,
      );
      if (noRepair || replayFrom || !repairable.has(failure)) throw error;
      if (failure === "study_sentence_mismatch") {
        // Same as the worker: answer-span repair receives declared choices only.
        const repair = buildKnowledgeStudyRepairInput(
          generated,
          settings.maxInputCharacters,
          declaredTeachingContext(item.data.learnerContext),
        );
        current = { level: item.declaredLevel, stage: "study-repair" };
        const result = await provider.structured({
          operationKey: randomUUID(),
          model: settings.llmModel,
          schema: repair.schema,
          schemaName: "class_study_sentence_repair",
          system: repair.system,
          input: repair.input,
        });
        model = validate(repair.apply(result.output));
      } else {
        const repair = buildKnowledgeRepairInput(item.data, settings.maxInputCharacters);
        current = { level: item.declaredLevel, stage: "evidence-repair" };
        const result = await provider.structured({
          operationKey: randomUUID(),
          model: settings.llmModel,
          schema: repair.schema,
          schemaName: "class_knowledge_repair",
          system: [
            knowledgePrompt("fa", false, settings.maxOutputTokens, true, item.data.learnerContext),
            repair.system,
          ].join(" "),
          input: repair.input,
        });
        await writeFile(
          resolve(directory, `${item.declaredLevel}-repair.json`),
          JSON.stringify(result.output, null, 2),
        );
        try {
          model = validate(repair.decode(result.output));
        } catch (repairError) {
          if (reason(repairError) !== "language_script_mismatch") throw repairError;
          repair.assertLanguageRepairEvidence(result.output);
          const translation = buildKnowledgeTranslationInput(
            result.output,
            "fa",
            settings.maxInputCharacters,
            declaredTeachingContext(item.data.learnerContext),
          );
          current = { level: item.declaredLevel, stage: "language-repair" };
          const translated = await provider.structured({
            operationKey: randomUUID(),
            model: settings.llmModel,
            schema: translation.schema,
            schemaName: "class_knowledge_translation",
            system: translation.system,
            input: translation.input,
          });
          model = validate(repair.decode(translation.apply(translated.output)));
        }
      }
    }
    const practice = finalizeGeneratedStudyPractice(
      normalizeGeneratedStudyModel(model, false, lessonContext),
      [source],
      item.data.learnerContext,
    );
    model = practice.model;
    if (practice.audit.derivedExercises === 0)
      warnings.push("synthetic_exact_class_examples_missing_practice");
    if (
      model.classNotes?.gapfill.some(
        (exercise) =>
          exercise.sentence.split("______").length !== 2 ||
          !/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(exercise.answer),
      )
    )
      warnings.push("gapfill_blank_or_answer_count_invalid");
    const notes = renderClassNotesHtml(model);
    const cards = model.learningItems.map((entry) => ({
      id: entry.id,
      ...renderStudyCard(entry, "fa"),
    }));
    await writeFile(
      resolve(directory, `${item.declaredLevel}-model.json`),
      JSON.stringify(model, null, 2),
    );
    await writeFile(resolve(directory, `${item.declaredLevel}-notes.html`), notes);
    await writeFile(
      resolve(directory, `${item.declaredLevel}-cards.json`),
      JSON.stringify(cards, null, 2),
    );
    const claims = modelClaims(model);
    results.push({
      level: item.declaredLevel,
      passed: warnings.length === 0 && !!model.classNotes && cards.length > 0,
      initialValidation,
      durationMs: Date.now() - began,
      productionItems: model.learningItems.filter((entry) => entry.study?.set === "production")
        .length,
      recognitionItems: model.learningItems.filter((entry) => entry.study?.set === "recognition")
        .length,
      sourcedClaims: claims.filter((claim) => claim.origin === "from_class").length,
      aiClaims: claims.filter((claim) => claim.origin === "ai_expansion").length,
      generatedPractice: practice.audit,
      rawSourceWarnings: warnings,
      files: {
        generated: `${item.declaredLevel}-generated.json`,
        model: `${item.declaredLevel}-model.json`,
        notes: `${item.declaredLevel}-notes.html`,
        cards: `${item.declaredLevel}-cards.json`,
      },
    });
  } catch (error) {
    uncertain = error instanceof ProviderError && error.uncertain;
    results.push({
      level: item.declaredLevel,
      passed: false,
      initialValidation,
      finalError: reason(error),
      durationMs: Date.now() - began,
    });
  }
  const report = {
    startedAt,
    replayFrom,
    newPaidCalls: receipts.filter((receipt) => receipt.status === 200).length,
    syntheticOnly: true,
    productionDataSent: false,
    databaseUsed: false,
    model: settings.llmModel,
    promptVersion: settings.promptVersion,
    structuredTemperature: settings.structuredTemperature,
    maxOutputTokens: settings.maxOutputTokens,
    results,
    receipts,
    reportedUsdCost: receipts.reduce((sum, receipt) => sum + (receipt.usdCost ?? 0), 0),
    missingCostReceipts: receipts.filter(
      (receipt) => receipt.status === 200 && receipt.usdCost === undefined,
    ).length,
  };
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(
    `${JSON.stringify({ level: item.declaredLevel, result: results.at(-1), receipts: receipts.filter((receipt) => receipt.level === item.declaredLevel), directory })}\n`,
  );
  if (uncertain) break;
}
await writeFile(
  resolve(directory, "comparison.html"),
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic A2 / B2 teaching comparison</title><style>body{font-family:system-ui;margin:16px}main{display:flex;gap:16px}section{flex:1}iframe{width:100%;height:90vh;border:1px solid #aaa}</style><h1>Synthetic A2 / B2 teaching comparison</h1><p>Identical class sources and general-English goal; Persian explanations. These are live model outputs, not a mastery assessment.</p><main>' +
    results
      .filter((result) => result.files)
      .map(
        (result) =>
          `<section><h2>${result.level}</h2><iframe sandbox="" title="${result.level} notes" src="${result.level}-notes.html"></iframe></section>`,
      )
      .join("") +
    "</main></html>",
);
if (results.length !== cases.length || results.some((result) => !result.passed))
  process.exitCode = 1;
