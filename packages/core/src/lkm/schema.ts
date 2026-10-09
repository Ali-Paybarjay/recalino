import { z } from "zod";
import { FIRST_LANGUAGES } from "../acc";
import { errors } from "../plt";
import { explanationStudyFields, normalizeGeneratedStudyModel } from "./study-policy";
import { classNotesSchema, studyContentSchema } from "./study-schema";
import { studyLexicalTarget, studyLexicalTargetMatches } from "./study-target";

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
  if (
    model.language.explanation !== explanationLanguage ||
    !isExplanationLanguage(explanationLanguage)
  )
    fail("language_mismatch");
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
    if (study?.faApprox && explanationLanguage.split("-")[0] !== "fa")
      fail("study_approximation_unsupported");
    if (study?.set === "production") {
      if (explanationLanguage.split("-")[0] === "fa" && !study.faApprox)
        fail("study_approximation_missing");
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
        const target = studyLexicalTarget(study.en);
        if (!target) fail("study_target_unsupported");
        else if (
          studyLexicalTargetMatches(target, study.faMeaning) ||
          studyLexicalTargetMatches(target, sentence)
        )
          fail("study_answer_exposed");
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
  if (
    modelClaims(model).some(
      (claim) => !matchesExplanationScript(claim.text, explanationLanguage),
    ) ||
    model.learningItems.some(
      (item) => !item.study && !matchesExplanationScript(item.back, explanationLanguage),
    ) ||
    explanationStudyFields(model).some(
      (field) => !matchesExplanationScript(field.text, explanationLanguage),
    ) ||
    model.learningItems.some(
      (item) => item.study?.faApprox && !matchesExplanationScript(item.study.faApprox, "fa"),
    )
  )
    fail("language_script_mismatch");
  return normalizeGeneratedStudyModel(
    model,
    sources.some((source) => source.kind === "audio"),
  );
}

/** D31: supported account codes, English explanations and existing regional revisions. */
export function isExplanationLanguage(language: string): boolean {
  if (language === "en" || FIRST_LANGUAGES.includes(language)) return true;
  try {
    const locale = new Intl.Locale(language);
    if (locale.toString() !== language) return false;
    const code = locale.language;
    // Chinese writing-system choice is explicit in the first-language catalog.
    return code === "zh"
      ? FIRST_LANGUAGES.includes(`zh-${locale.script}`)
      : code === "en" || FIRST_LANGUAGES.includes(code);
  } catch {
    return false;
  }
}

const scriptPatterns: Record<string, RegExp> = {
  Latn: /\p{Script=Latin}/u,
  Cyrl: /\p{Script=Cyrillic}/u,
  Arab: /\p{Script=Arabic}/u,
  Deva: /\p{Script=Devanagari}/u,
  Beng: /\p{Script=Bengali}/u,
  Grek: /\p{Script=Greek}/u,
  Armn: /\p{Script=Armenian}/u,
  Geor: /\p{Script=Georgian}/u,
  Hebr: /\p{Script=Hebrew}/u,
  Ethi: /\p{Script=Ethiopic}/u,
  Tibt: /\p{Script=Tibetan}/u,
  Gujr: /\p{Script=Gujarati}/u,
  Thaa: /\p{Script=Thaana}/u,
  Guru: /\p{Script=Gurmukhi}/u,
  Taml: /\p{Script=Tamil}/u,
  Telu: /\p{Script=Telugu}/u,
  Knda: /\p{Script=Kannada}/u,
  Mlym: /\p{Script=Malayalam}/u,
  Sinh: /\p{Script=Sinhala}/u,
  Thai: /\p{Script=Thai}/u,
  Laoo: /\p{Script=Lao}/u,
  Mymr: /\p{Script=Myanmar}/u,
  Khmr: /\p{Script=Khmer}/u,
  Orya: /\p{Script=Oriya}/u,
  Hans: /\p{Script=Han}/u,
  Hant: /\p{Script=Han}/u,
  Jpan: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  Kore: /\p{Script=Hangul}/u,
  Cans: /\p{Script=Canadian_Aboriginal}/u,
  Yiii: /\p{Script=Yi}/u,
  Mong: /\p{Script=Mongolian}/u,
};
// Some selectable languages have more than one established writing system.
const alternateScripts: Record<string, readonly string[]> = {
  az: ["Cyrl", "Arab"],
  bs: ["Cyrl"],
  cr: ["Latn"],
  ff: ["Adlm"],
  ha: ["Arab"],
  iu: ["Latn"],
  kk: ["Latn", "Arab"],
  ks: ["Deva"],
  ku: ["Arab"],
  mn: ["Mong"],
  pa: ["Arab"],
  sd: ["Deva"],
  sr: ["Latn"],
  tg: ["Arab"],
  uz: ["Cyrl", "Arab"],
};
scriptPatterns.Adlm = /\p{Script=Adlam}/u;
// Same-script orthography: Persian/Urdu keheh and Farsi yeh are spelled ك and ي/ى/ة in Arabic.
// پ چ ژ گ stay allowed because Arabic pronunciation notes use them for /p tʃ ʒ g/.
const sameScriptOrthography: Record<string, { foreign: RegExp; native: RegExp }> = {
  ar: { foreign: /[کی]/gu, native: /[كيىة]/gu },
};
const quotedSpans = /«[^«»]*»|"[^"]*"|“[^“”]*”|\([^()]*\)/gu;
const arabicLetter = /(?=\p{Letter})\p{Script=Arabic}/u;

/** Quoted loanwords and glosses are data; the surrounding prose decides the orthography. */
function hasForeignOrthography(text: string, language: string): boolean {
  const orthography = sameScriptOrthography[language];
  if (!orthography) return false;
  const prose = text.replace(quotedSpans, " ");
  const judged = arabicLetter.test(prose) ? prose : text;
  const count = (pattern: RegExp) => judged.match(pattern)?.length ?? 0;
  return count(orthography.foreign) > count(orthography.native);
}

/** Reject clear script mismatches; same-script language fluency still needs EVAL. */
export function matchesExplanationScript(textValue: string, language: string): boolean {
  try {
    const locale = new Intl.Locale(language);
    if (!isExplanationLanguage(language) && locale.language !== "zh") return false;
    const primary = locale.maximize().script;
    const explanation = textValue.replace(/\/[\p{Script=Latin}ɐ-ʯθβχˈˌːˑ .…~-]+\//gu, " ");
    const scripts = [primary, ...(alternateScripts[locale.language] ?? [])];
    const patterns = scripts.flatMap((script) =>
      script && scriptPatterns[script] ? [scriptPatterns[script]] : [],
    );
    if (!patterns.length || !patterns.some((pattern) => pattern.test(explanation))) return false;
    if (hasForeignOrthography(explanation, locale.language)) return false;
    // English targets are allowed inside explanations, but a quoted English term
    // must not make Persian/Hebrew/etc prose pass a Latin-language check.
    return Array.from(explanation).every(
      (character) =>
        !/\p{Letter}/u.test(character) ||
        /\p{Script=Latin}/u.test(character) ||
        /\p{Script=Common}/u.test(character) ||
        /\p{Script=Inherited}/u.test(character) ||
        patterns.some((pattern) => pattern.test(character)),
    );
  } catch {
    return false;
  }
}
