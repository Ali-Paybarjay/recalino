import {
  assignGeneratedKnowledgeIds,
  type Claim,
  type ClassNotes,
  type EvidenceSource,
  isAnnouncingHeading,
  KNOWLEDGE_SUMMARY_LIMIT,
  type KnowledgeModel,
  type LearningItem,
  modelClaims,
  type SourceRef,
  statesAssignment,
  studyLexicalTarget,
  studyLexicalTargetMatches,
  validateKnowledgeModel,
} from "../lkm";
import { classQuotationSources, quotesClassSources } from "./knowledge-generation";

/**
 * Persisted as generation.studyPractice for D46 runs. The projection runs after validation for
 * both the v5 evidence-key wire and the legacy SourceRef wire; it never rejects output.
 */
export interface GeneratedPracticeAudit {
  version: "source-grounded-practice-2";
  applied: boolean;
  canonicalizedTextRefs: number;
  replacedGeneratedExercises: number;
  /** Recognition claims relabelled as AI expansion (meaning unchanged since version 1). */
  recognitionClaimsReclassified: number;
  /** Recognition claims kept as class content because a cited class block anchors them. */
  recognitionClaimsKeptFromClass: number;
  /** Why each relabelled recognition claim had no class anchor; audit only. */
  recognitionReclassifiedReasons: Record<string, number>;
  /** Homework claims without a stated after-class assignment, moved to the summary unchanged. */
  homeworkClaimsDemoted: number;
  /** Unsupported homework claims left in place because the summary was already full. */
  homeworkClaimsKeptAtSummaryLimit: number;
  derivedExercises: number;
  omittedCandidates: Record<string, number>;
}

/** D46 generation projection only; published/manual revisions never pass through this helper. */
export function finalizeGeneratedStudyPractice(
  input: KnowledgeModel,
  sources: readonly EvidenceSource[],
  /** Any D46+ snapshot (version 1 or 2); legacy queued runs have none. */
  learnerContext?: { version: number },
): { model: KnowledgeModel; audit: GeneratedPracticeAudit } {
  // Never turn a foreign, stale or out-of-bounds reference into a valid native block.
  let model = validateKnowledgeModel(input, sources, input.language.explanation);
  const audit: GeneratedPracticeAudit = {
    version: "source-grounded-practice-2",
    applied: learnerContext !== undefined && learnerContext.version >= 1,
    canonicalizedTextRefs: 0,
    replacedGeneratedExercises: 0,
    recognitionClaimsReclassified: 0,
    recognitionClaimsKeptFromClass: 0,
    recognitionReclassifiedReasons: {},
    homeworkClaimsDemoted: 0,
    homeworkClaimsKeptAtSummaryLimit: 0,
    derivedExercises: 0,
    omittedCandidates: {},
  };
  const omit = (reason: string) => {
    audit.omittedCandidates[reason] = (audit.omittedCandidates[reason] ?? 0) + 1;
  };
  // On every generation path, a Class Notes chunk whose "Class sentence" is not a faithful class
  // quotation is omitted, never rejected: noisy extraction must not cost the lesson its single
  // regeneration. Only the count is recorded, never the text (PRD-PRIV-06).
  const chunks = model.classNotes?.chunks ?? [];
  const quotation = chunks.length ? classQuotationSources(sources) : undefined;
  const kept = chunks.filter(
    (chunk) => quotation && quotesClassSources(chunk.classSentence, quotation),
  );
  for (let index = kept.length; index < chunks.length; index++)
    omit("class_sentence_not_in_sources");
  if (model.classNotes) model.classNotes.chunks = kept;
  // Every generated model: homework needs a cited after-class assignment. Nothing is deleted or
  // rejected: a claim that would overflow the summary limit stays where the model put it.
  const homework: Claim[] = [];
  for (const claim of model.homework) {
    if (statesCitedAssignment(claim, sources, input.language.explanation)) homework.push(claim);
    else if (model.summary.length >= KNOWLEDGE_SUMMARY_LIMIT) {
      homework.push(claim);
      audit.homeworkClaimsKeptAtSummaryLimit += 1;
    } else {
      model.summary.push(claim);
      audit.homeworkClaimsDemoted += 1;
    }
  }
  model.homework = homework;
  // Old queued settings without the D46 snapshot retain their original optional practice.
  if (!audit.applied) {
    if (!audit.homeworkClaimsDemoted && kept.length === chunks.length)
      return { model: input, audit };
    return {
      model: validateKnowledgeModel(
        assignGeneratedKnowledgeIds(model),
        sources,
        input.language.explanation,
      ),
      audit,
    };
  }
  // Generated recognition definitions may go beyond a cited term. They stay class content only
  // when an exact class sentence and the headword anchor them in one cited class block; any other
  // item is additional AI teaching, never a teacher quotation. Their prose is kept verbatim.
  for (const item of model.learningItems) {
    if (item.study?.set !== "recognition") continue;
    item.study.spoken = false;
    const anchor = recognitionAnchor(item, sources);
    if ("refs" in anchor) {
      item.claim = { ...item.claim, sourceRefs: anchor.refs, speakerRole: "unknown" };
      audit.recognitionClaimsKeptFromClass += 1;
      continue;
    }
    item.claim = {
      ...item.claim,
      origin: "ai_expansion",
      creation: "ai_generation",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
    };
    audit.recognitionReclassifiedReasons[anchor.reason] =
      (audit.recognitionReclassifiedReasons[anchor.reason] ?? 0) + 1;
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

function findSource(ref: SourceRef, sources: readonly EvidenceSource[]) {
  return sources.find(
    (entry) => entry.sourceId === ref.sourceId && entry.contentVersionId === ref.contentVersionId,
  );
}

/** The cited range of a printed class block; audio, personal notes and whole pages are none. */
function citedClassRange(ref: SourceRef, source: EvidenceSource | undefined): string | undefined {
  if (
    !source ||
    source.kind === "audio" ||
    !["class_material", "board_photo"].includes(source.role ?? "")
  )
    return undefined;
  const locator = ref.locator;
  if (locator.kind === "text") {
    const block = source.blocks.find((entry) => entry.id === locator.blockId);
    return block && Array.from(block.text).slice(locator.start, locator.end).join("");
  }
  if (locator.kind === "page" && locator.blockId !== null) {
    const unit = source.units.find(
      (entry) => entry.kind === "page" && entry.start === locator.page,
    );
    return source.blocks.find((block) => block.id === locator.blockId && block.unitId === unit?.id)
      ?.text;
  }
  return undefined;
}

const englishWord = /\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu;

/** An exact occurrence that neither starts nor ends inside a word ("art" is not in "Start"). */
function containsAtWordBoundary(text: string, phrase: string): boolean {
  for (let index = text.indexOf(phrase); index >= 0; index = text.indexOf(phrase, index + 1)) {
    if (
      !/[\p{L}\p{N}]$/u.test(text.slice(0, index)) &&
      !/^[\p{L}\p{N}]/u.test(text.slice(index + phrase.length))
    )
      return true;
  }
  return false;
}

function containsWord(text: string, word: string): boolean {
  const pattern = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/gu, "['’]");
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * Owner decision 2026-10-09 amending D46: a recognition item keeps its class provenance only when
 * it is certain, cites no personal notes, and one cited printed class range contains its example
 * (3+ English words, at word boundaries) together with a headword word. Only anchoring refs stay.
 */
function recognitionAnchor(
  item: LearningItem,
  sources: readonly EvidenceSource[],
): { refs: SourceRef[] } | { reason: string } {
  const study = item.study;
  if (study?.set !== "recognition" || item.claim.origin !== "from_class")
    return { reason: "recognition_model_ai_expansion" };
  if (item.claim.uncertain) return { reason: "recognition_uncertain" };
  // The source role decides, never claim.evidence: legacy-wire claims may mix personal notes in.
  if (item.claim.sourceRefs.some((ref) => findSource(ref, sources)?.role === "user_notes"))
    return { reason: "recognition_user_notes_cited" };
  if ((study.example.match(englishWord)?.length ?? 0) < 3)
    return { reason: "recognition_example_too_short" };
  const words = study.en.match(englishWord) ?? [];
  const headwords =
    words.length === 1 ? words : words.filter((word) => word.replace(/['’]/gu, "").length >= 4);
  let exampleFound = false;
  const refs = item.claim.sourceRefs.filter((ref) => {
    const range = citedClassRange(ref, findSource(ref, sources));
    if (range === undefined || !containsAtWordBoundary(range, study.example)) return false;
    exampleFound = true;
    return headwords.some((word) => containsWord(range, word));
  });
  if (refs.length) return { refs };
  return {
    reason: exampleFound
      ? "recognition_headword_absent_from_anchoring_block"
      : "recognition_example_absent_from_cited_class_block",
  };
}

/**
 * A class homework claim stays homework only when a cited block, read with the context announcing
 * it, states an affirmative after-class assignment. The context is read as one text, so a heading
 * never approves content that says there is no homework: the nearest preceding heading block in
 * the same unit (at most 6 blocks back) before the cited block, the block a cited heading
 * announces, or every block of the same unit of a photographed image, in source order.
 */
function statesCitedAssignment(
  claim: Claim,
  sources: readonly EvidenceSource[],
  explanationLanguage: string,
): boolean {
  if (claim.origin !== "from_class") return false;
  return claim.sourceRefs.some((ref) => {
    const source = findSource(ref, sources);
    if (!source) return false;
    const locator = ref.locator;
    const cited = source.blocks.filter((block) => {
      if (locator.kind === "text") return block.id === locator.blockId;
      if (locator.kind === "page") {
        const unit = source.units.find(
          (entry) => entry.kind === "page" && entry.start === locator.page,
        );
        return (
          !!unit &&
          block.unitId === unit.id &&
          (locator.blockId === null || block.id === locator.blockId)
        );
      }
      return source.units.some(
        (unit) =>
          unit.id === block.unitId &&
          unit.kind === "time" &&
          unit.start < locator.endMs &&
          (unit.end ?? unit.start) > locator.startMs,
      );
    });
    return cited.some((block) => {
      const context =
        source.kind === "image"
          ? source.blocks
              .filter((entry) => entry.unitId === block.unitId)
              .map((entry) => entry.text)
          : [block.text];
      if (source.kind !== "image") {
        const index = source.blocks.indexOf(block);
        for (let back = index - 1; back >= Math.max(0, index - 6); back -= 1) {
          const previous = source.blocks[back];
          if (!previous || previous.unitId !== block.unitId) break;
          if (!isAnnouncingHeading(previous.text)) continue;
          context.unshift(previous.text);
          break;
        }
        const next = source.blocks[index + 1];
        if (next && next.unitId === block.unitId && isAnnouncingHeading(block.text))
          context.push(next.text);
      }
      return statesAssignment(context.join("\n"), explanationLanguage);
    });
  });
}

function hasExactCitedExample(item: LearningItem, sources: readonly EvidenceSource[]): boolean {
  if (item.study?.set !== "production") return false;
  const sentence = item.study.fullSentence;
  // Anonymous audio and personal notes are not class examples for this optional practice.
  return item.claim.sourceRefs.some(
    (ref) => citedClassRange(ref, findSource(ref, sources))?.includes(sentence) ?? false,
  );
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
