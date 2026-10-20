import {
  type EvidenceSource,
  type KnowledgeModel,
  type LearningItem,
  studyLexicalTarget,
  studyLexicalTargetMatches,
  validateKnowledgeModel,
} from "../lkm";
import { AppError, errors } from "../plt";
import { gapContentWords, gapWords, lexicalGapProblem } from "./knowledge-generation";
import { sentenceMismatch, wordBoundary } from "./knowledge-study-repair";
import { invalidCardAllowance } from "./lesson-budget";

/**
 * D110 (owner decision 2026-10-20): one model response with several independent bad study cards
 * no longer fails its whole lesson. A deterministic guard first rebuilds two kinds of gap the
 * model writes wrongly but the immutable full sentence fixes, then drops the cards that still
 * fail, within a bound. It never calls a provider and never writes text of its own: a rebuilt
 * gap is the full sentence with one span blanked, and every validator rule runs afterwards.
 */
export const STUDY_OUTPUT_GUARD_VERSION = "study-output-guard-1";

/** Code-owned counts only, recorded in the publish generation metadata (PRD-PRIV-06). */
export interface StudyOutputAudit {
  version: typeof STUDY_OUTPUT_GUARD_VERSION;
  /** The production limit the lesson (or part) was checked against (D62, D78). */
  productionLimit: number;
  gapsRebuilt: { spacing: number; derivedBlank: number };
  /** Invalid cards removed, by the validation code each one failed. */
  droppedItems: Record<string, number>;
  /** Valid production cards beyond the limit, kept in model order; not counted as invalid. */
  trimmedOverLimit: number;
  /** Mistakes kept without their link to a removed card. */
  unlinkedMistakes: number;
  /** Wire items the content-contract assembly omitted, by code. */
  assemblyOmitted: Record<string, number>;
}

/** D110: what the content-contract assembly omitted from one paid response. */
export interface AssemblyOmissions {
  omitted: Record<string, number>;
  /** How many of the omitted items were production cards. */
  omittedProduction: number;
}

const BLANK = "______";
const hint = /[A-Za-z_]______|______[A-Za-z_]/u;
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const letterOrDigit = /[\p{L}\p{N}]/u;
const count = (counts: Record<string, number>, code: string, by = 1) => {
  counts[code] = (counts[code] ?? 0) + by;
};
const total = (counts: Readonly<Record<string, number>>) =>
  Object.values(counts).reduce((sum, value) => sum + value, 0);
const isProduction = (item: LearningItem) => item.study?.set === "production";

export function emptyStudyOutputAudit(productionLimit: number): StudyOutputAudit {
  return {
    version: STUDY_OUTPUT_GUARD_VERSION,
    productionLimit,
    gapsRebuilt: { spacing: 0, derivedBlank: 0 },
    droppedItems: {},
    trimmedOverLimit: 0,
    unlinkedMistakes: 0,
    assemblyOmitted: {},
  };
}

/** The audit of a lesson taught in parts: every part's counts, at the lesson's limit. */
export function combineStudyOutputAudits(
  productionLimit: number,
  audits: readonly StudyOutputAudit[],
): StudyOutputAudit {
  const combined = emptyStudyOutputAudit(productionLimit);
  for (const audit of audits) {
    combined.gapsRebuilt.spacing += audit.gapsRebuilt.spacing;
    combined.gapsRebuilt.derivedBlank += audit.gapsRebuilt.derivedBlank;
    for (const [code, value] of Object.entries(audit.droppedItems))
      count(combined.droppedItems, code, value);
    combined.trimmedOverLimit += audit.trimmedOverLimit;
    combined.unlinkedMistakes += audit.unlinkedMistakes;
    for (const [code, value] of Object.entries(audit.assemblyOmitted))
      count(combined.assemblyOmitted, code, value);
  }
  return combined;
}

/**
 * gap_spacing: a gap whose only difference from its sentence is whitespace beside a blank
 * ("gradually ______ , with" for "gradually gained momentum, with"). The hidden spans are taken
 * from the full sentence at word boundaries; other differences are never guessed.
 */
function respacedGap(gap: string, full: string): string | undefined {
  const pieces = gap.trim().split(BLANK);
  const last = pieces.length - 1;
  if (last < 1 || last > 3) return undefined;
  const edges = pieces.map((piece, index) =>
    index === 0 ? piece.trimEnd() : index === last ? piece.trimStart() : piece.trim(),
  );
  // Adjacent blanks with nothing between them are never split by guesswork.
  if (edges.slice(1, last).some((piece) => !letterOrDigit.test(piece))) return undefined;
  const sentence = full.trim();
  const offset = full.length - full.trimStart().length;
  const match = new RegExp(`^${edges.map(escapePattern).join("\\s*([\\s\\S]+?)\\s*")}$`, "du").exec(
    sentence,
  );
  if (!match?.indices) return undefined;
  const rebuilt: string[] = [];
  let end = 0;
  for (const span of match.indices.slice(1)) {
    if (!span) return undefined;
    let [from, to] = span;
    while (from < to && /\s/u.test(sentence[from] ?? "")) from += 1;
    while (to > from && /\s/u.test(sentence[to - 1] ?? "")) to -= 1;
    const hidden = sentence.slice(from, to);
    if (!letterOrDigit.test(hidden) || !wordBoundary(sentence, from) || !wordBoundary(sentence, to))
      return undefined;
    rebuilt.push(full.slice(end, offset + from), BLANK);
    end = offset + to;
  }
  rebuilt.push(full.slice(end));
  return rebuilt.join("");
}

/**
 * gap_blank_derived: a missing blank, only for a one-part target that occurs exactly once,
 * uninflected and not joined to another word. A sentence that still shows a word starting with
 * one of the target's content words (concealed, conceal-ment) is never derived.
 */
function derivedBlankGap(part: string, targetText: string, full: string): string | undefined {
  const occurrences = [...full.matchAll(new RegExp(escapePattern(part), "giu"))]
    .map((found) => ({ start: found.index, end: found.index + found[0].length }))
    .filter(({ start, end }) => wordBoundary(full, start) && wordBoundary(full, end));
  const [occurrence] = occurrences;
  if (occurrences.length !== 1 || !occurrence) return undefined;
  const rebuilt = `${full.slice(0, occurrence.start)}${BLANK}${full.slice(occurrence.end)}`;
  const content = gapContentWords(targetText);
  const visible = gapWords(rebuilt.replaceAll(BLANK, " "));
  if (visible.some((word) => content.some((stem) => word.startsWith(stem)))) return undefined;
  return rebuilt;
}

/**
 * D110: rebuilds only gaps that would fail validation and that the full sentence alone fixes.
 * An item that passes today is returned unchanged (byte-identical, same content-hash id), and a
 * second pass changes nothing. A rebuilt gap is kept only when it hides exactly the target.
 */
export function sanitizeGeneratedStudyGaps<T extends { learningItems: LearningItem[] }>(
  model: T,
): { model: T; spacing: number; derivedBlank: number } {
  let spacing = 0;
  let derivedBlank = 0;
  const learningItems = model.learningItems.map((item) => {
    const study = item.study;
    if (study?.set !== "production" || study.kind === "grammar") return item;
    const target = studyLexicalTarget(study.en);
    const full = study.fullSentence;
    if (!target || full.includes(BLANK)) return item;
    const gap = study.gapSentence;
    let rebuilt: string | undefined;
    let rule: "spacing" | "derivedBlank";
    if (gap?.includes(BLANK)) {
      if (!sentenceMismatch(gap, full)) return item;
      rebuilt = respacedGap(gap, full);
      rule = "spacing";
    } else {
      const [part] = target.parts;
      if (target.parts.length !== 1 || !part) return item;
      rebuilt = derivedBlankGap(part, target.text, full);
      rule = "derivedBlank";
    }
    if (
      rebuilt === undefined ||
      hint.test(rebuilt) ||
      sentenceMismatch(rebuilt, full) ||
      !letterOrDigit.test(rebuilt.replaceAll(BLANK, "")) ||
      lexicalGapProblem(study.en, full, rebuilt) !== undefined ||
      studyLexicalTargetMatches(target, rebuilt)
    )
      return item;
    if (rule === "spacing") spacing += 1;
    else derivedBlank += 1;
    return { ...item, study: { ...study, gapSentence: rebuilt } };
  });
  return spacing || derivedBlank
    ? { model: { ...model, learningItems }, spacing, derivedBlank }
    : { model, spacing, derivedBlank };
}

/** D62, D78: this lesson's (or part's) own production limit, below the class ceiling. */
export function assertLessonProductionLimit(model: KnowledgeModel, productionLimit: number) {
  if (model.learningItems.filter(isProduction).length > productionLimit)
    throw errors.validationFailed({ output: ["study_core_limit"] });
}

/** The single code-owned validation code of a failure, if it has exactly one. */
function validationCode(error: unknown): string | undefined {
  if (!(error instanceof AppError) || error.code !== "validation_failed") return undefined;
  const output = (error.details?.fields as { output?: unknown } | undefined)?.output;
  const code = Array.isArray(output) && output.length === 1 ? output[0] : undefined;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(code) ? code : undefined;
}

export interface StudySalvage {
  productionLimit: number;
  assemblyOmitted?: AssemblyOmissions | null;
  /** A part of a multi-part lesson may lose all its cards; the merged lesson keeps the floor. */
  floor: boolean;
}

/**
 * D110: drops the cards that fail on their own, within the response's allowance, and trims valid
 * cards beyond the limit in model order. Each card is checked by validateKnowledgeModel itself on
 * a probe that holds only that card, so no rule is duplicated. Anything the drops cannot fix
 * (a model-scoped problem, too many invalid cards, no production card left) rethrows `trigger`:
 * the run then repairs or fails exactly as it did before.
 */
export function salvageStudyItems(
  candidate: KnowledgeModel,
  sources: readonly EvidenceSource[],
  explanationLanguage: string,
  options: StudySalvage,
  trigger: unknown,
): {
  model: KnowledgeModel;
  droppedItems: Record<string, number>;
  trimmedOverLimit: number;
  unlinkedMistakes: number;
} {
  if (!validationCode(trigger)) throw trigger;
  const { classNotes: _notes, ...rest } = candidate;
  const base: KnowledgeModel = {
    ...rest,
    summary: [],
    topics: [],
    learningItems: [],
    homework: [],
    uncertainties: [],
  };
  try {
    // Language, coverage and other lesson-wide checks: no card can be dropped to fix them.
    validateKnowledgeModel(base, sources, explanationLanguage);
  } catch {
    throw trigger;
  }
  const problems = candidate.learningItems.map((item) => {
    try {
      validateKnowledgeModel({ ...base, learningItems: [item] }, sources, explanationLanguage);
      return undefined;
    } catch (error) {
      const code = validationCode(error);
      if (!code) throw trigger;
      return code;
    }
  });
  const droppedItems: Record<string, number> = {};
  const removed = new Set<string>();
  let trimmedOverLimit = 0;
  let production = 0;
  const learningItems = candidate.learningItems.filter((item, index) => {
    const problem = problems[index];
    if (problem) {
      count(droppedItems, problem);
      removed.add(item.id);
      return false;
    }
    if (!isProduction(item)) return true;
    if (production >= options.productionLimit) {
      trimmedOverLimit += 1;
      removed.add(item.id);
      return false;
    }
    production += 1;
    return true;
  });
  const omitted = options.assemblyOmitted;
  const invalid = total(droppedItems) + (omitted ? total(omitted.omitted) : 0);
  const basis =
    candidate.learningItems.filter(isProduction).length + (omitted?.omittedProduction ?? 0);
  if (!removed.size || invalid > invalidCardAllowance(basis) || (options.floor && production === 0))
    throw trigger;
  let unlinkedMistakes = 0;
  const notes = candidate.classNotes;
  const mistakes = notes?.mistakes;
  const pruned: KnowledgeModel = {
    ...candidate,
    learningItems,
    ...(notes && mistakes
      ? {
          classNotes: {
            ...notes,
            mistakes: {
              ...mistakes,
              items: mistakes.items.map((mistake) => {
                if (!mistake.itemId || !removed.has(mistake.itemId)) return mistake;
                unlinkedMistakes += 1;
                const { itemId: _itemId, ...kept } = mistake;
                return kept;
              }),
            },
          },
        }
      : {}),
  };
  try {
    const model = validateKnowledgeModel(pruned, sources, explanationLanguage);
    assertLessonProductionLimit(model, options.productionLimit);
    return { model, droppedItems, trimmedOverLimit, unlinkedMistakes };
  } catch {
    throw trigger;
  }
}

/**
 * D110: a lesson taught in parts keeps at least one production card. Each part may lose all of
 * its own; when the merged lesson has none, it fails with the first dropped card's code.
 */
export function assertStudyFloor(model: KnowledgeModel, audit: StudyOutputAudit) {
  if (model.learningItems.some(isProduction)) return;
  const [code] = [...Object.keys(audit.droppedItems), ...Object.keys(audit.assemblyOmitted)];
  if (code) throw errors.validationFailed({ output: [code] });
}

export function productionCards(model: KnowledgeModel): number {
  return model.learningItems.filter(isProduction).length;
}
