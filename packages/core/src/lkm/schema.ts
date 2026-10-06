import { z } from "zod";
import { errors } from "../plt";
import { normalizeGeneratedStudyModel, persianStudyFields } from "./study-policy";
import { classNotesSchema, studyContentSchema } from "./study-schema";

export const LKM_SCHEMA_VERSION = "1";
const id = z.string().min(1).max(100);
const text = z.string().min(1).max(20000);
const integer = z.number().int().nonnegative();
export const locatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("time"), startMs: integer, endMs: integer.positive() }),
  z.strictObject({ kind: z.literal("page"), page: integer.positive(), blockId: id.nullable() }),
  z.strictObject({ kind: z.literal("text"), blockId: id, start: integer, end: integer.positive() }),
]);
export const sourceRefSchema = z.strictObject({
  sourceId: z.uuid(),
  contentVersionId: z.uuid(),
  locator: locatorSchema,
});
export type SourceRef = z.infer<typeof sourceRefSchema>;
export const claimSchema = z.strictObject({
  id,
  text,
  origin: z.enum(["from_class", "ai_expansion"]),
  creation: z.enum(["machine_extraction", "ai_generation", "user_edit", "user_confirmed"]),
  evidence: z.enum(["audio", "board", "material", "user_notes", "ai"]),
  sourceRefs: z.array(sourceRefSchema).max(30),
  speakerRole: z.enum(["teacher", "student", "unknown"]),
  uncertain: z.boolean(),
});
export type Claim = z.infer<typeof claimSchema>;
export const learningItemSchema = z.strictObject({
  id,
  kind: z.enum(["vocabulary", "grammar", "expression", "concept", "example"]),
  front: text,
  back: text,
  claim: claimSchema,
  study: studyContentSchema.optional(),
});
export type LearningItem = z.infer<typeof learningItemSchema>;
export const knowledgeModelSchema = z.strictObject({
  schemaVersion: z.literal(LKM_SCHEMA_VERSION),
  title: z.string().min(1).max(300),
  language: z.strictObject({ learning: z.literal("en"), explanation: z.string().min(2).max(16) }),
  summary: z.array(claimSchema).max(100),
  topics: z
    .array(
      z.strictObject({
        id,
        title: z.string().min(1).max(300),
        claims: z.array(claimSchema).max(300),
      }),
    )
    .max(100),
  learningItems: z.array(learningItemSchema).max(500),
  homework: z.array(claimSchema).max(100),
  uncertainties: z.array(claimSchema).max(100),
  coverage: z.strictObject({ complete: z.boolean(), missingSourceIds: z.array(z.uuid()).max(100) }),
  classNotes: classNotesSchema.optional(),
});
export type KnowledgeModel = z.infer<typeof knowledgeModelSchema>;
export interface EvidenceSource {
  sourceId: string;
  kind: "audio" | "image" | "pdf" | "html" | "text";
  contentVersionId: string | null;
  role?: "class_audio" | "board_photo" | "class_material" | "user_notes";
  units: readonly { id: string; kind: "page" | "time" | "document"; start: number; end?: number }[];
  blocks: readonly { id: string; text: string; unitId?: string; speakerRole?: string }[];
}

export function modelClaims(model: KnowledgeModel): Claim[] {
  return [
    ...model.summary,
    ...model.topics.flatMap((topic) => topic.claims),
    ...model.learningItems.map((item) => item.claim),
    ...model.homework,
    ...model.uncertainties,
  ];
}

/** Source existence, version, range and attribution are deterministic; semantic quality is EVAL. */
export function validateKnowledgeModel(
  raw: unknown,
  sources: readonly EvidenceSource[],
  explanationLanguage: string,
): KnowledgeModel {
  const parsed = knowledgeModelSchema.safeParse(raw);
  if (!parsed.success) throw errors.validationFailed({ output: ["schema_invalid"] });
  const model = parsed.data;
  const fail = (reason: string): never => {
    throw errors.validationFailed({ output: [reason] });
  };
  if (model.language.explanation !== explanationLanguage) fail("language_mismatch");
  const ids = new Set<string>();
  for (const claim of modelClaims(model)) {
    if (ids.has(claim.id)) fail("duplicate_claim_id");
    ids.add(claim.id);
    if (["user_edit", "user_confirmed"].includes(claim.creation)) fail("unverified_user_action");
    if (claim.origin === "from_class" && (!claim.sourceRefs.length || claim.evidence === "ai"))
      fail("class_evidence_missing");
    if (
      claim.origin === "ai_expansion" &&
      (claim.evidence !== "ai" || claim.speakerRole !== "unknown")
    )
      fail("expansion_attribution_invalid");
    for (const ref of claim.sourceRefs) {
      const source = sources.find(
        (s) => s.sourceId === ref.sourceId && s.contentVersionId === ref.contentVersionId,
      );
      if (!source) throw errors.validationFailed({ output: ["source_reference_invalid"] });
      if (
        (claim.evidence === "audio" && source.kind !== "audio") ||
        (claim.evidence === "board" &&
          (source.kind !== "image" || source.role !== "board_photo")) ||
        (claim.evidence === "user_notes" && source.role !== "user_notes")
      )
        fail("evidence_kind_mismatch");
      const locator = ref.locator;
      if (locator.kind === "time") {
        if (
          source.kind !== "audio" ||
          locator.endMs <= locator.startMs ||
          !source.units.some(
            (unit) =>
              unit.kind === "time" &&
              unit.start <= locator.startMs &&
              (unit.end ?? unit.start) >= locator.endMs,
          )
        )
          fail("time_reference_invalid");
      } else if (locator.kind === "page") {
        const unit = source.units.find((u) => u.kind === "page" && u.start === locator.page);
        if (
          source.kind !== "pdf" ||
          !unit ||
          (locator.blockId !== null &&
            !source.blocks.some((b) => b.id === locator.blockId && b.unitId === unit.id))
        )
          fail("page_reference_invalid");
      } else {
        const block = source.blocks.find((b) => b.id === locator.blockId);
        if (!block || locator.end <= locator.start || locator.end > Array.from(block.text).length)
          fail("text_reference_invalid");
      }
      if (claim.speakerRole === "teacher") {
        if (source.kind !== "audio" || claim.evidence !== "audio" || locator.kind !== "time")
          throw errors.validationFailed({ output: ["teacher_attribution_invalid"] });
        const roles = source.blocks.filter((b) =>
          source.units.some(
            (u) =>
              u.id === b.unitId &&
              u.kind === "time" &&
              u.start < locator.endMs &&
              (u.end ?? u.start) > locator.startMs,
          ),
        );
        if (!roles.length || roles.some((b) => b.speakerRole !== "teacher"))
          fail("teacher_role_unconfirmed");
      }
    }
  }
  for (const item of model.learningItems) {
    if (ids.has(`item:${item.id}`)) fail("duplicate_item_id");
    ids.add(`item:${item.id}`);
    const study = item.study;
    if (study?.set === "production") {
      if (model.language.explanation.split("-")[0] !== "fa") fail("study_language_invalid");
      if (study.kind === "grammar") {
        if (!study.taskFa || !study.prompt) fail("study_grammar_prompt_missing");
        if (
          study.prompt?.trim().toLocaleLowerCase("en") ===
            study.fullSentence.trim().toLocaleLowerCase("en") ||
          study.taskFa
            ?.toLocaleLowerCase("en")
            .includes(study.fullSentence.trim().toLocaleLowerCase("en"))
        )
          fail("study_answer_exposed");
      } else {
        const gap = study.gapSentence;
        if (!gap?.includes("______")) fail("study_gap_missing");
        const sentence = gap as string;
        if (/[A-Za-z_]______|______[A-Za-z_]/u.test(sentence)) fail("study_gap_hint");
        const pieces = sentence.trim().split("______");
        if (pieces.length > 4) fail("study_gap_invalid");
        const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const skeleton = new RegExp(`^${pieces.map(escapePattern).join("[\\s\\S]+?")}$`, "u");
        if (study.fullSentence.includes("______") || !skeleton.test(study.fullSentence.trim()))
          fail("study_sentence_mismatch");
        const exactAnswer = new RegExp(
          `(?:^|[^A-Za-z])${escapePattern(study.en)}(?:$|[^A-Za-z])`,
          "iu",
        );
        if (exactAnswer.test(study.faMeaning) || exactAnswer.test(sentence))
          fail("study_answer_exposed");
        const target = study.en
          .replace(/\([^)]*\)/g, "")
          .split(/\s+\/\s+/)[0]
          ?.trim();
        if (target && !/\b(?:sb|sth|someone|something)\b/i.test(target)) {
          const answer = new RegExp(`(?:^|[^A-Za-z])${escapePattern(target)}(?:$|[^A-Za-z])`, "iu");
          if (answer.test(study.faMeaning) || answer.test(sentence)) fail("study_answer_exposed");
        }
      }
    }
  }
  if (model.learningItems.filter((item) => item.study?.set === "production").length > 18)
    fail("study_core_limit");
  for (const mistake of model.classNotes?.mistakes?.items ?? []) {
    if (
      mistake.itemId &&
      !model.learningItems.some(
        (item) => item.id === mistake.itemId && item.study?.set === "production",
      )
    )
      fail("study_mistake_item_missing");
  }
  if (new Set(model.topics.map((topic) => topic.id)).size !== model.topics.length)
    fail("duplicate_topic_id");
  const missing = model.coverage.missingSourceIds;
  if (
    new Set(missing).size !== missing.length ||
    missing.some((sid) => !sources.some((s) => s.sourceId === sid)) ||
    model.coverage.complete !== (missing.length === 0)
  )
    fail("coverage_invalid");
  const explanation = modelClaims(model)
    .map((c) => c.text)
    .join(" ");
  if (explanation && !matchesExplanationScript(explanation, explanationLanguage))
    fail("language_script_mismatch");
  if (
    explanationLanguage.split("-")[0] === "fa" &&
    persianStudyFields(model).some(
      (field) => !matchesExplanationScript(field.text, explanationLanguage),
    )
  )
    fail("language_script_mismatch");
  return normalizeGeneratedStudyModel(
    model,
    sources.some((source) => source.kind === "audio"),
  );
}

/** D31: reject clear script mismatches; language fluency still requires human EVAL. */
export function matchesExplanationScript(textValue: string, language: string): boolean {
  const expected = language.split("-")[0];
  if (["fa", "ar", "ur", "ps"].includes(expected ?? ""))
    return /\p{Script=Arabic}/u.test(textValue);
  if (["zh", "ja"].includes(expected ?? ""))
    return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(textValue);
  if (expected === "ko") return /\p{Script=Hangul}/u.test(textValue);
  if (["ru", "uk", "bg"].includes(expected ?? "")) return /\p{Script=Cyrillic}/u.test(textValue);
  if (expected === "hi") return /\p{Script=Devanagari}/u.test(textValue);
  if (expected === "en") return /\p{Script=Latin}/u.test(textValue);
  return true;
}
