import { z } from "zod";

const shortText = z.string().min(1).max(2000);
const prose = z.string().min(1).max(10000);
const optionalText = shortText.optional();
export const studyKindSchema = z.enum([
  "grammar",
  "collocation",
  "register",
  "pronunciation",
  "british",
]);
const common = {
  en: shortText.describe("English item including the grammar frame needed to use it; plain text."),
  faMeaning: shortText.describe("Natural conversational meaning in language.explanation."),
  topic: z.string().min(1).max(150).describe("One or two topic tag words."),
  kind: studyKindSchema.optional(),
};
// Words as the generation check counts them: letters or digits joined by an apostrophe or hyphen.
const transcribedWords = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/**
 * The class words a grammar ipa transcribes: one to six Latin-script words, which may carry
 * numbers, punctuation and shared symbols such as "£5", "20°C" or "doesnʼt", but no character
 * of another script and no blank, bracket, slash or markup from a task cue.
 */
function isTranscribedText(value: string): boolean {
  const words = value.match(transcribedWords)?.length ?? 0;
  return (
    value.trim() === value &&
    words >= 1 &&
    words <= 6 &&
    /\p{Script=Latin}/u.test(value) &&
    !/[^\p{scx=Latin}\p{scx=Common}\p{scx=Inherited}\p{Number}\p{Punctuation}\p{Separator}\p{Mark}]/u.test(
      value,
    ) &&
    !/[\p{Pc}\p{Ps}\p{Pe}<>/\\]|&(?:#\d+|[a-z]+);/iu.test(value)
  );
}
export const productionStudySchema = z
  .strictObject({
    set: z.literal("production"),
    ...common,
    ipa: shortText.describe("British non-rhotic IPA, with slashes, stress and natural weak forms."),
    // Optional so that older stored revisions, which never had it, stay valid.
    ipaText: shortText
      .refine(isTranscribedText)
      .optional()
      .describe(
        "Grammar items only: the 1 to 6 consecutive English words that ipa transcribes, exactly as written in the sentence they come from. Omit for every other item.",
      ),
    faApprox: optionalText.describe(
      "Persian vowel-marked pronunciation; required for fa, omitted for other explanation languages.",
    ),
    trap: optionalText.describe("Only a genuine misleading spelling or pronunciation trap."),
    gapSentence: optionalText.describe(
      "Copy fullSentence exactly, replacing only target span(s) with ______; keep all other characters unchanged. Separable targets may use 2–3 blanks. Omit for grammar.",
    ),
    fullSentence: shortText.describe(
      "Complete British English example (8–15 words), identical to the filled gapSentence, or a corrected grammar task.",
    ),
    collocations: z
      .array(shortText)
      .max(3)
      .describe("Two or three frequent collocations when relevant."),
    noteFa: prose.describe(
      "Usage/register/nuance in language.explanation, including evidenced corrections.",
    ),
    imageFa: shortText.describe(
      "One concrete mental image, never an invented fact about the learner.",
    ),
    sourceFa: shortText.describe(
      "Source label in language.explanation; authorship and teacher speech require evidence.",
    ),
    taskFa: optionalText.describe(
      "Grammar instruction in language.explanation, paired with prompt.",
    ),
    prompt: optionalText.describe("English grammar task prompt without the corrected answer."),
  })
  // A lexical or recognition ipa transcribes en itself, so only grammar names its words.
  .refine((study) => study.ipaText === undefined || study.kind === "grammar", {
    path: ["ipaText"],
  });
export const recognitionStudySchema = z.strictObject({
  set: z.literal("recognition"),
  ...common,
  example: shortText,
  ipa: optionalText,
  faApprox: optionalText,
  trap: optionalText,
  noteFa: prose.optional(),
  spoken: z
    .boolean()
    .describe(
      "True only for an explicitly confirmed teacher explanation absent from board/slides; anonymous audio does not establish teacher identity.",
    ),
});
export const studyContentSchema = z.discriminatedUnion("set", [
  productionStudySchema,
  recognitionStudySchema,
]);
export type ProductionStudyContent = z.infer<typeof productionStudySchema>;
export type RecognitionStudyContent = z.infer<typeof recognitionStudySchema>;
export type StudyContent = z.infer<typeof studyContentSchema>;

export const taskBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("table"),
    headers: z.array(shortText).max(12),
    rows: z.array(z.array(shortText).max(12)).max(100),
  }),
  z.strictObject({ type: z.literal("text"), textFa: prose }),
  z.strictObject({ type: z.literal("quote"), quoteEn: prose }),
  z.strictObject({
    type: z.literal("items"),
    items: z
      .array(
        z.strictObject({
          prompt: shortText,
          learnerAnswer: optionalText,
          model: shortText,
          whyFa: optionalText,
        }),
      )
      .max(100),
  }),
]);
export const taskGroupSchema = z.strictObject({
  title: shortText,
  blocks: z.array(taskBlockSchema).max(30),
});
export type TaskBlock = z.infer<typeof taskBlockSchema>;
export type TaskGroup = z.infer<typeof taskGroupSchema>;
export const mistakeKindSchema = z.enum([
  "grammar",
  "word-choice",
  "collocation",
  "preposition",
  "word-order",
  "pronunciation",
  "spelling",
  "register",
]);
export const classNotesSchema = z.strictObject({
  date: z.iso.date().describe("The supplied lesson date, copied exactly; server controlled."),
  institution: optionalText,
  course: optionalText,
  coverage: shortText.describe(
    "One line describing the supported lesson content, in the lesson's own terms.",
  ),
  sourceNote: prose.optional(),
  coreIntro: prose.optional(),
  oralIntro: prose.optional(),
  chunks: z
    .array(z.strictObject({ pattern: shortText, classSentence: shortText, noteFa: shortText }))
    .max(100),
  board: z.array(shortText).max(100),
  tasks: z.array(taskGroupSchema).max(30),
  mistakes: z
    .strictObject({
      speechStatus: z
        .enum(["verified", "unverified", "no_audio"])
        .describe("Server controlled. Generation must never assert a verified learner voice."),
      noteFa: prose.optional(),
      pendingSpeech: z
        .boolean()
        .optional()
        .describe("Server projection only; other recordings await voice confirmation."),
      patterns: z
        .array(
          z.strictObject({
            labelFa: shortText,
            count: z.int().min(2).max(100),
            examples: z.array(shortText).max(30),
            ruleFa: shortText,
          }),
        )
        .max(15),
      items: z
        .array(
          z.strictObject({
            source: z.enum(["speech", "handwriting"]),
            said: shortText.describe(
              "Exact original words; **bold** marks only the mistaken words.",
            ),
            correct: shortText,
            whyFa: shortText,
            kind: mistakeKindSchema,
            teacherCorrected: z.boolean(),
            where: optionalText,
            itemId: z.string().min(1).max(100).optional(),
            voiceEvidence: z
              .strictObject({
                analysisId: z.uuid(),
                version: z.int().positive(),
                sourceId: z.uuid(),
                sourceVersionId: z.uuid(),
                speakerId: z.string().min(1).max(200),
                startMs: z.int().nonnegative(),
                endMs: z.int().positive(),
              })
              .optional()
              .describe("Server projection only. Generated voice assertions are discarded."),
          }),
        )
        .max(15),
    })
    .optional(),
  register: z
    .array(z.strictObject({ notThis: shortText, sayThis: shortText, whyFa: shortText }))
    .max(100),
  gapfill: z
    .array(z.strictObject({ sentence: shortText, answer: shortText, whyFa: optionalText }))
    .max(12),
  culture: z.array(taskGroupSchema).max(30).optional(),
});
export type ClassNotes = z.infer<typeof classNotesSchema>;
