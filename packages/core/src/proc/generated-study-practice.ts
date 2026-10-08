import {
  assignGeneratedKnowledgeIds,
  type ClassNotes,
  type EvidenceSource,
  type KnowledgeModel,
  type LearningItem,
  modelClaims,
  studyLexicalTarget,
  studyLexicalTargetMatches,
  validateKnowledgeModel,
} from "../lkm";
import type { LearnerTeachingContext } from "./learner-context";

export interface GeneratedPracticeAudit {
  version: "source-grounded-practice-1";
  applied: boolean;
  canonicalizedTextRefs: number;
  replacedGeneratedExercises: number;
  recognitionClaimsReclassified: number;
  derivedExercises: number;
  omittedCandidates: Record<string, number>;
}

/** D46 generation projection only; published/manual revisions never pass through this helper. */
export function finalizeGeneratedStudyPractice(
  input: KnowledgeModel,
  sources: readonly EvidenceSource[],
  learnerContext?: LearnerTeachingContext,
): { model: KnowledgeModel; audit: GeneratedPracticeAudit } {
  // Never turn a foreign, stale or out-of-bounds reference into a valid native block.
  let model = validateKnowledgeModel(input, sources, input.language.explanation);
  const audit: GeneratedPracticeAudit = {
    version: "source-grounded-practice-1",
    applied: learnerContext?.version === 1,
    canonicalizedTextRefs: 0,
    replacedGeneratedExercises: 0,
    recognitionClaimsReclassified: 0,
    derivedExercises: 0,
    omittedCandidates: {},
  };
  // Old queued settings without the D46 snapshot retain their original optional practice.
  if (!audit.applied) return { model: input, audit };
  // Generated recognition definitions may go beyond a cited term. Treat them as additional
  // AI teaching, never as a verified class statement or teacher quotation. Keep their prose.
  for (const item of model.learningItems) {
    if (item.study?.set !== "recognition") continue;
    item.claim = {
      ...item.claim,
      origin: "ai_expansion",
      creation: "ai_generation",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
    };
    item.study.spoken = false;
    audit.recognitionClaimsReclassified += 1;
  }
  for (const claim of modelClaims(model)) {
    for (const ref of claim.sourceRefs) {
      const locator = ref.locator;
      if (locator.kind !== "text") continue;
      const source = sources.find(
        (entry) =>
          entry.sourceId === ref.sourceId && entry.contentVersionId === ref.contentVersionId,
      );
      const block = source?.blocks.find((entry) => entry.id === locator.blockId);
      // Existence and bounds were validated above. Preserve source, version, block and authority.
      if (!source || !block) continue;
      const unit = source.units.find((entry) => entry.id === block.unitId);
      // Match the transport's native locator: page/time references must never become text refs.
      if (
        (source.kind === "pdf" && unit?.kind === "page") ||
        (source.kind === "audio" && unit?.kind === "time" && unit.end !== undefined)
      )
        continue;
      const end = Array.from(block.text).length;
      if (locator.start !== 0 || locator.end !== end) {
        ref.locator = { kind: "text", blockId: block.id, start: 0, end };
        audit.canonicalizedTextRefs += 1;
      }
    }
  }
  const omit = (reason: string) => {
    audit.omittedCandidates[reason] = (audit.omittedCandidates[reason] ?? 0) + 1;
  };
  if (model.classNotes) {
    audit.replacedGeneratedExercises = model.classNotes.gapfill.length;
    const exercises: ClassNotes["gapfill"] = [];
    const sentences = new Set<string>();
    for (const item of model.learningItems) {
      const study = item.study;
      if (study?.set !== "production") continue;
      if (item.kind === "grammar" || study.kind === "grammar") {
        omit("grammar_has_own_card_task");
        continue;
      }
      if (item.claim.origin !== "from_class" || item.claim.uncertain) {
        omit("not_certain_class_evidence");
        continue;
      }
      if (!hasExactCitedExample(item, sources)) {
        omit("example_absent_from_cited_class_block");
        continue;
      }
      const target = studyLexicalTarget(study.en);
      if (!target || !studyLexicalTargetMatches(target, study.fullSentence)) {
        omit("lexical_target_not_literal");
        continue;
      }
      const exercise = oneWordExercise(study.fullSentence, target.parts);
      if (!exercise) {
        omit("no_unique_literal_word");
        continue;
      }
      if (sentences.has(exercise.sentence)) {
        omit("duplicate_example");
        continue;
      }
      if (exercises.length >= 12) {
        omit("practice_limit");
        continue;
      }
      sentences.add(exercise.sentence);
      exercises.push(exercise);
    }
    model.classNotes.gapfill = exercises;
    audit.derivedExercises = exercises.length;
  }
  // References participate in content identities, including mistake itemId links.
  model = assignGeneratedKnowledgeIds(model);
  return {
    model: validateKnowledgeModel(model, sources, input.language.explanation),
    audit,
  };
}

function hasExactCitedExample(item: LearningItem, sources: readonly EvidenceSource[]): boolean {
  if (item.study?.set !== "production") return false;
  const sentence = item.study.fullSentence;
  return item.claim.sourceRefs.some((ref) => {
    const source = sources.find(
      (entry) => entry.sourceId === ref.sourceId && entry.contentVersionId === ref.contentVersionId,
    );
    // Anonymous audio and personal notes are not class examples for this optional practice.
    if (
      !source ||
      source.kind === "audio" ||
      !["class_material", "board_photo"].includes(source.role ?? "")
    )
      return false;
    const locator = ref.locator;
    if (locator.kind === "text") {
      const block = source.blocks.find((entry) => entry.id === locator.blockId);
      return (
        !!block &&
        Array.from(block.text).slice(locator.start, locator.end).join("").includes(sentence)
      );
    }
    if (locator.kind === "page" && locator.blockId !== null) {
      const unit = source.units.find(
        (entry) => entry.kind === "page" && entry.start === locator.page,
      );
      return source.blocks.some(
        (block) =>
          block.id === locator.blockId &&
          block.unitId === unit?.id &&
          block.text.includes(sentence),
      );
    }
    return false;
  });
}

function oneWordExercise(
  sentence: string,
  parts: string[],
): ClassNotes["gapfill"][number] | undefined {
  if (sentence.includes("_")) return undefined;
  // Prefer a final lexical particle (to/with), never a following noun or -ing complement.
  for (const word of parts.flatMap((part) => part.split(" ")).reverse()) {
    if (!/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(word)) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = Array.from(
      sentence.matchAll(
        new RegExp(`(?<![\\p{L}\\p{N}'’_-])${escaped}(?![\\p{L}\\p{N}'’_-])`, "giu"),
      ),
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match || match.index === undefined) continue;
    const blank = `${sentence.slice(0, match.index)}______${sentence.slice(match.index + match[0].length)}`;
    if (blank.length <= 2000 && blank.replace("______", match[0]) === sentence)
      return { sentence: blank, answer: match[0] };
  }
  return undefined;
}
