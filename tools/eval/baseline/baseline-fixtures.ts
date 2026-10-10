import { z } from "../../../packages/core/node_modules/zod";
import { isFirstLanguage } from "../../../packages/core/src/acc";
import { canonicalJson, sha256Hex } from "../../../packages/core/src/plt";
import {
  type RunSnapshot,
  type RunSource,
  snapshotSourceSchema,
} from "../../../packages/core/src/proc/contracts";
import {
  buildKnowledgeGenerationInput,
  type KnowledgeGenerationInput,
} from "../../../packages/core/src/proc/knowledge-generation";
import { modelTeachingContext } from "../../../packages/core/src/proc/learner-context";
import { automaticSourceRole, decodeSourceText } from "../../../packages/core/src/src";
import { type DispatchBody, DispatchRefused } from "./cost-guard";
import { type MigrationFixture, migrationInputData } from "./haiku55-migration-fixtures";
import {
  holdout5FixtureSetId,
  holdout5MigrationFixtures,
  holdout5RepeatIds,
} from "./multilingual-holdout5-fixtures";

/** The ledger's fixture-set name for this round; the lessons are the unchanged holdout-5 set. */
export const baselineFixtureSetId = "multilingual-holdout-5-release-candidate";
export const baselineSourceFixtureSetId = holdout5FixtureSetId;
/** sha256(canonicalJson(fixtures)) of the Gemini holdout-5 round's frozen plan. */
export const holdout5FixturesHash =
  "3d88a0a8e655fca1caa395b6f689df620cad2fa0f7ff4df3eda50c29526f4471";
/** The freeze of the Gemini holdout-5 acceptance round whose recorded inputs this round compares. */
export const geminiAcceptanceRoundFreeze =
  "f7d6b2005d183e12f118e3d3c5d4427ac6b92ce446974bd680edd5fd95b79679";
/**
 * The release candidate this round measures: the merge base of this branch with the release
 * branch. Only tools/eval/baseline may differ from it.
 */
export const releaseCandidateCommit = "d32e9ab";
export const releaseBranch = "codex/gemini-release";
export const evaluationToolPath = "tools/eval/baseline";

export interface BaselineTask {
  caseId: string;
  fixture: MigrationFixture;
  repeat: boolean;
}

/** The Gemini holdout-5 order: S01-1 ... S12-12, then the repeats S03-13 and S10-14. */
export function baselineSchedule(
  fixtures: MigrationFixture[] = holdout5MigrationFixtures(),
): BaselineTask[] {
  const repeats = holdout5RepeatIds.map((id) => {
    const fixture = fixtures.find((entry) => entry.id === id);
    if (!fixture) throw new Error("holdout_repeat_fixture_missing");
    return fixture;
  });
  return [...fixtures, ...repeats].map((fixture, ordinal) => ({
    caseId: `${fixture.id}-${ordinal + 1}`,
    fixture,
    repeat: ordinal >= fixtures.length,
  }));
}

/**
 * The production learner context of a fixture: profile answers whose run settings equal the
 * fixture's explanation language, declared level, goal and example preference, plus its class.
 */
export function baselineLearnerProfile(fixture: MigrationFixture) {
  const english = fixture.explanationLanguage === "en";
  // createProcessingRun explains in English or in the learner's first language.
  const firstLanguage = english ? "fa" : fixture.explanationLanguage;
  if (!isFirstLanguage(firstLanguage)) throw new Error("explanation_language_unsupported");
  return {
    firstLanguage,
    explanationLanguage: english ? ("english" as const) : ("first_language" as const),
    level: fixture.declaredLevel,
    goal: fixture.goal,
    shorterExamples: fixture.teachingPreferences.shorterExamples,
    classDate: fixture.lessonContext.date,
    course: fixture.lessonContext.course,
  };
}
export type BaselineLearnerProfile = ReturnType<typeof baselineLearnerProfile>;

/** The rule createProcessingRun applies to the profile. */
export function runExplanationLanguage(
  profile: Pick<BaselineLearnerProfile, "explanationLanguage" | "firstLanguage">,
): string {
  return profile.explanationLanguage === "english" ? "en" : profile.firstLanguage;
}

/** The worker reports a source missing when it has no blocks or any unextracted unit. */
export function workerMissingSourceIds(sources: readonly RunSource[]): string[] {
  return sources
    .filter(
      (source) => !source.blocks.length || source.units.some((unit) => unit.status !== "extracted"),
    )
    .map((source) => source.sourceId);
}

/**
 * A minimal PDF with one page per entry; an empty entry is a page without any text layer, which
 * production extraction cannot read. Only the page structure matters to the worker: the lesson
 * text arrives as the fixture's content version.
 */
export function syntheticPagedPdf(pages: readonly string[]): Uint8Array {
  const pdfString = (text: string) =>
    text.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (character) => `\\${character}`);
  const pageObject = (index: number) => 4 + index * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${pageObject(index)} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, text] of pages.entries()) {
    const stream = text ? `BT /F1 9 Tf 20 760 Td (${pdfString(text)}) Tj ET` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject(index) + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let document = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new Uint8Array(Buffer.from(document, "latin1"));
}

/**
 * How each fixture source enters production: an upload declaration (and its bytes, verified by
 * the production verifier; class audio stays on the device and has none), then an appended
 * machine-extraction content version holding the fixture units and blocks unchanged. Failed units
 * keep their status and reason, so the worker reports the source missing exactly as after a
 * production extraction. `expected` is the source the worker then reads: the fixture source with
 * the metadata production verification assigns (a text upload always has a page count, 1 for
 * every holdout-5 text, where the Gemini acceptance round's fixture-fed worker sent null).
 */
export function baselineSourceRows(fixture: MigrationFixture) {
  return fixture.sources.map((raw, index) => {
    const source = snapshotSourceSchema.parse(raw);
    if (
      source.ranges.length ||
      source.captureAnchor !== null ||
      source.objectId !== null ||
      !["text", "pdf", "audio"].includes(source.kind)
    )
      throw new Error("fixture_source_shape_unsupported");
    const role = source.role ?? (source.kind === "audio" ? "class_audio" : "class_material");
    const text = source.blocks.map((block) => block.text).join("\n\n");
    const bytes =
      source.kind === "text"
        ? new Uint8Array(Buffer.from(text, "utf8"))
        : source.kind === "pdf"
          ? syntheticPagedPdf(
              source.units.map((unit) =>
                source.blocks
                  .filter((block) => block.unitId === unit.id)
                  .map((block) => block.text)
                  .join(" "),
              ),
            )
          : undefined;
    const sizeBytes = bytes?.byteLength ?? Math.max(1, Buffer.byteLength(text, "utf8"));
    const sha256 = bytes ? sha256Hex(bytes) : source.sha256;
    return {
      index,
      fixtureSourceId: source.sourceId,
      fixtureContentVersionId: source.contentVersionId,
      declaration: {
        kind: source.kind,
        mimeType: source.mimeType,
        sizeBytes,
        sha256,
        displayName: `Class source ${index + 1}`,
        ...(source.durationMs === null ? {} : { durationMs: source.durationMs }),
        // Class audio stays on the device (D29): it is declared, never uploaded.
        parts: bytes ? [{ index: 0, sizeBytes, sha256 }] : [],
      },
      bytes,
      role,
      content: {
        originKey: `baseline-source:${index + 1}`,
        schemaVersion: "1" as const,
        provenance: "machine_extraction" as const,
        // Categories come from processing; audio is always class audio.
        settings:
          source.kind === "audio"
            ? {}
            : { sourceClassification: { role, confidence: "high" as const } },
        units: source.units,
        blocks: source.blocks,
      },
      expected: snapshotSourceSchema.parse({
        ...source,
        role,
        pageCount:
          source.kind === "text" && bytes
            ? Math.max(1, Math.ceil(decodeSourceText(bytes).length / 3000))
            : source.pageCount,
      }),
      missing: workerMissingSourceIds([source]).length > 0,
    };
  });
}
export type BaselineSourceRow = ReturnType<typeof baselineSourceRows>[number];

/** The role selectSourceSnapshot derives from a row's content version (src/service.ts). */
export function snapshotRoleOf(row: BaselineSourceRow) {
  return automaticSourceRole(
    row.declaration.kind,
    "sourceClassification" in row.content.settings
      ? row.content.settings.sourceClassification
      : { role: row.role, confidence: "high" },
  );
}

/** Fixture sources as the production worker reads them, with fixture identifiers. */
export function expectedRunSources(fixture: MigrationFixture): RunSource[] {
  return baselineSourceRows(fixture).map((row) => row.expected);
}

export interface BaselineSourceMapping {
  fixtureSourceId: string;
  sourceId: string;
  fixtureContentVersionId: string | null;
  contentVersionId: string;
}

/** Database identifiers to fixture identifiers; both sides are UUIDs, so text replacement is exact. */
export function baselineIdMap(sources: readonly BaselineSourceMapping[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) {
    map.set(source.sourceId, source.fixtureSourceId);
    if (source.fixtureContentVersionId)
      map.set(source.contentVersionId, source.fixtureContentVersionId);
  }
  return map;
}

export function mapIdsInText(text: string, map: ReadonlyMap<string, string>): string {
  let mapped = text;
  for (const [from, to] of map) mapped = mapped.split(from).join(to);
  return mapped;
}

/** Deep copy with every database identifier renamed to its fixture identifier. */
export function mapIds<T>(value: T, map: ReadonlyMap<string, string>): T {
  const mapped = JSON.parse(mapIdsInText(JSON.stringify(value), map)) as T;
  const text = JSON.stringify(mapped);
  for (const from of map.keys())
    if (text.includes(from)) throw new Error("database_identifier_remains");
  return mapped;
}

/** Upload identity the knowledge input never contains (buildKnowledgeInput drops both). */
const uploadIdentityFields = new Set<keyof RunSource>(["objectId", "sha256"]);

/** Every model-visible field of the worker's snapshot source, renamed, must equal the fixture. */
export function compareSnapshotToFixture(
  snapshot: Pick<RunSnapshot, "sources">,
  fixture: MigrationFixture,
  map: ReadonlyMap<string, string>,
): string[] {
  const differences: string[] = [];
  const expectedSources = expectedRunSources(fixture);
  if (snapshot.sources.length !== expectedSources.length) differences.push("source_count");
  expectedSources.forEach((expected, index) => {
    const found = snapshot.sources[index];
    if (!found) return;
    const actual = mapIds(snapshotSourceSchema.parse(found), map);
    for (const field of Object.keys(snapshotSourceSchema.shape) as (keyof RunSource)[])
      if (
        !uploadIdentityFields.has(field) &&
        canonicalJson(actual[field] ?? null) !== canonicalJson(expected[field] ?? null)
      )
        differences.push(`source_${index + 1}_${field}`);
  });
  const missing = mapIds(workerMissingSourceIds(snapshot.sources), map);
  if (canonicalJson(missing) !== canonicalJson(fixture.missingSourceIds))
    differences.push("missing_source_ids");
  return differences;
}

/**
 * The content-contract generation data the release worker assembles for this fixture
 * (proc/worker.ts, generationData), with fixture identifiers: a new learner has no practice
 * history, so the model receives the declared version 1 context and no practice focus.
 */
export function expectedGenerationData(fixture: MigrationFixture): KnowledgeGenerationInput {
  const data = migrationInputData(fixture);
  const teaching = modelTeachingContext(data.learnerContext, []);
  return {
    explanationLanguage: data.explanationLanguage,
    teachingPreferences: data.teachingPreferences,
    ...(teaching ? { learnerContext: teaching } : {}),
    sources: expectedRunSources(fixture),
    missingSourceIds: data.missingSourceIds,
    lessonContext: { date: fixture.lessonContext.date, course: fixture.lessonContext.course },
  };
}

/**
 * The exact content-contract knowledge input (knowledge_generation_keys_v5) the release worker
 * sends for this fixture, with fixture identifiers. Upload identity is dropped by
 * buildKnowledgeInput, so only the fixture and production's own page count enter it; that page
 * count is the one model-visible field in which it differs from the Gemini acceptance round's
 * recorded input (see recordedInputComparison). The input does not depend on the output budget,
 * compaction or a repair reason; only the system prompt and schema do.
 */
export function expectedKnowledgeInput(
  fixture: MigrationFixture,
  maxInputCharacters: number,
  maxOutputTokens?: number,
) {
  return buildKnowledgeGenerationInput(
    expectedGenerationData(fixture),
    maxInputCharacters,
    maxOutputTokens === undefined ? {} : { maxOutputTokens },
  ).input;
}

const sourceMetadataSchema = z.record(z.string(), z.unknown());
const contentInputSchema = z
  .object({
    format: z.unknown(),
    explanationLanguage: z.unknown(),
    teachingPreferences: z.unknown(),
    learnerContext: z.unknown().optional(),
    lessonContext: z.unknown().optional(),
    missingSourceIds: z.unknown(),
    sources: z.array(sourceMetadataSchema),
  })
  .passthrough();
const semanticFields = [
  ["format", "format"],
  ["explanationLanguage", "explanation_language"],
  ["teachingPreferences", "teaching_preferences"],
  ["learnerContext", "learner_context"],
  ["lessonContext", "lesson_context"],
  ["missingSourceIds", "missing_source_ids"],
] as const;

/**
 * The semantic input of a content-contract knowledge request against the fixture's: format,
 * explanation language, teaching preferences, learner context, lesson context, missing
 * material, and per source its role, its other metadata and its evidence blocks (keys, native
 * locators, text and block annotations). Key order is not semantic; every value is.
 */
export function contentKnowledgeInputDifferences(sent: string, expected: string): string[] {
  let actual: z.infer<typeof contentInputSchema>;
  let wanted: z.infer<typeof contentInputSchema>;
  try {
    actual = contentInputSchema.parse(JSON.parse(sent));
    wanted = contentInputSchema.parse(JSON.parse(expected));
  } catch {
    return ["input_unreadable"];
  }
  const same = (left: unknown, right: unknown) =>
    canonicalJson(left ?? null) === canonicalJson(right ?? null);
  const differences: string[] = [];
  for (const [field, name] of semanticFields)
    if (!same(actual[field], wanted[field])) differences.push(name);
  if (actual.sources.length !== wanted.sources.length) differences.push("source_count");
  wanted.sources.forEach((source, index) => {
    const found = actual.sources[index];
    if (!found) return;
    const { role, evidence, ...metadata } = source;
    const { role: foundRole, evidence: foundEvidence, ...foundMetadata } = found;
    if (!same(foundRole, role)) differences.push(`source_${index + 1}_role`);
    if (!same(foundMetadata, metadata)) differences.push(`source_${index + 1}_metadata`);
    if (!same(foundEvidence, evidence)) differences.push(`source_${index + 1}_blocks`);
  });
  const known = new Set<string>([...semanticFields.map(([field]) => field), "sources"]);
  for (const field of new Set([...Object.keys(actual), ...Object.keys(wanted)]))
    if (!known.has(field) && !same(actual[field], wanted[field]))
      differences.push(`field_${field}`);
  // The named comparisons cover every value; the whole canonical form must agree as well.
  if (!differences.length && canonicalJson(actual) !== canonicalJson(wanted))
    differences.push("input");
  return differences;
}

export interface RecordedInputComparison {
  /** contentKnowledgeInputDifferences of the recorded input against this round's. */
  differences: string[];
  /** Text sources whose page count differs: recorded (the earlier round) and this release's. */
  textPageCounts: { source: number; recorded: unknown; release: unknown }[];
  /**
   * Every other model-visible field is equal: sources, roles, blocks, missing material,
   * explanation language, teaching preferences, learner context and lesson context. Only a text
   * source the earlier round sent with a null page count may differ, and only by that count.
   */
  allOtherFieldsEqual: boolean;
  stringIdentical: boolean;
}

/**
 * An earlier round's recorded knowledge input against this round's. The Gemini acceptance round
 * fed the fixture sources to the worker directly, so its text sources had no page count; here a
 * text upload passes production verification (DefaultSourceVerifier), which sets one. That is the
 * only difference allowed; anything else means the two rounds did not send the same lesson.
 */
export function recordedInputComparison(
  recorded: string,
  release: string,
): RecordedInputComparison {
  const differences = contentKnowledgeInputDifferences(recorded, release);
  const stringIdentical = recorded === release;
  let normalized: z.infer<typeof contentInputSchema>;
  let wanted: z.infer<typeof contentInputSchema>;
  try {
    normalized = contentInputSchema.parse(JSON.parse(recorded));
    wanted = contentInputSchema.parse(JSON.parse(release));
  } catch {
    return { differences, textPageCounts: [], allOtherFieldsEqual: false, stringIdentical };
  }
  const textPageCounts: RecordedInputComparison["textPageCounts"] = [];
  wanted.sources.forEach((source, index) => {
    const found = normalized.sources[index];
    if (!found || source.kind !== "text" || found.kind !== "text") return;
    if (canonicalJson(found.pageCount ?? null) === canonicalJson(source.pageCount ?? null)) return;
    textPageCounts.push({
      source: index + 1,
      recorded: found.pageCount ?? null,
      release: source.pageCount ?? null,
    });
    // Production verification only adds a page count; it never changes a recorded one.
    if (found.pageCount === null && typeof source.pageCount === "number")
      normalized.sources[index] = { ...found, pageCount: source.pageCount };
  });
  return {
    differences,
    textPageCounts,
    allOtherFieldsEqual:
      contentKnowledgeInputDifferences(JSON.stringify(normalized), release).length === 0,
    stringIdentical,
  };
}

/**
 * Content-contract steps whose user input is the lesson's knowledge input, and their json_object
 * fallbacks. knowledge:study-repair carries the generated lesson instead and is not compared.
 */
export const lessonInputStages: ReadonlySet<string> = new Set(
  ["knowledge", "knowledge:compact", "knowledge:repair"].flatMap((stage) => [
    stage,
    `${stage}:json`,
  ]),
);
const userTextSchema = z.tuple(
  [
    z.unknown(),
    z.object({
      role: z.literal("user"),
      content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })], z.unknown()),
    }),
  ],
  z.unknown(),
);
/** The user text of a [system, user] chat request, or undefined when the messages differ. */
export function userInputText(messages: unknown): string | undefined {
  const parsed = userTextSchema.safeParse(messages);
  return parsed.success ? parsed.data[1].content[0].text : undefined;
}
export interface KnowledgeInputCheck {
  stage: string;
  semanticMatch: boolean;
  stringIdentical: boolean;
  differences: string[];
}

/**
 * Before a knowledge generation is paid for, its user input, renamed to fixture identifiers, must
 * equal the fixture's content-contract input semantically; anything else would not measure this
 * lesson.
 */
export function knowledgeInputInspector(input: {
  expected: string;
  map: () => ReadonlyMap<string, string>;
  record: (check: KnowledgeInputCheck) => void;
}) {
  return ({ stage, body }: { stage: string; body: DispatchBody }) => {
    if (!lessonInputStages.has(stage)) return;
    const text = userInputText(body.messages);
    if (text === undefined) throw new DispatchRefused("knowledge_input_unreadable");
    const sent = mapIdsInText(text, input.map());
    const differences = contentKnowledgeInputDifferences(sent, input.expected);
    const semanticMatch = differences.length === 0;
    input.record({ stage, semanticMatch, stringIdentical: sent === input.expected, differences });
    if (!semanticMatch) throw new DispatchRefused("knowledge_input_differs_from_fixture");
  };
}
