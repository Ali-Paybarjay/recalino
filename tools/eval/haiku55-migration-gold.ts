import { type KnowledgeModel, modelClaims } from "../../packages/core/src/lkm";
import type { MigrationFixture } from "./haiku55-migration-fixtures";

export type MigrationGoldCheck = { id: string; passed: boolean; gating: boolean; detail: string };

type Concept = { id: string; supporting: { sourceId: string }[]; lexicalTargets?: string[] };
type Expected = {
  concepts?: Concept[];
  attribution?: {
    accountOwnerWritingConfirmed?: boolean;
    allowedSpeakerRoles?: string[];
    expectedSpeechStatus?: string;
  };
  prohibitedLanguageFields?: string[];
  incompleteMaterial?: { coverageMustBeIncomplete?: boolean };
  contradiction?: { sourcesBothCited?: boolean };
  injection?: { forbiddenOutputText?: string[] };
};

/**
 * Deterministic answer-key checks that need no judgment. Reviewers still grade teaching quality;
 * a failed gating check makes the case ineligible regardless of the manual score.
 */
export function migrationAutomaticGoldChecks(
  fixture: MigrationFixture,
  model: KnowledgeModel,
): MigrationGoldCheck[] {
  const expected = fixture.expected as Expected;
  const checks: MigrationGoldCheck[] = [];
  const add = (id: string, passed: boolean, detail: string, gating = true) =>
    checks.push({ id, passed, gating, detail });
  const notes = model.classNotes;
  const attribution = expected.attribution;
  if (attribution?.accountOwnerWritingConfirmed === false) {
    const learnerAnswers = [...(notes?.tasks ?? []), ...(notes?.culture ?? [])]
      .flatMap((group) => group.blocks)
      .flatMap((block) => (block.type === "items" ? block.items : []))
      .filter((item) => item.learnerAnswer !== undefined).length;
    const mistakes = notes?.mistakes?.items.length ?? 0;
    add(
      "no_unconfirmed_learner_mistakes",
      mistakes === 0 && !notes?.mistakes?.noteFa && learnerAnswers === 0,
      `${mistakes} mistakes, ${learnerAnswers} learner answers`,
    );
  }
  if (attribution?.expectedSpeechStatus)
    add(
      "speech_status",
      notes?.mistakes?.speechStatus === attribution.expectedSpeechStatus,
      String(notes?.mistakes?.speechStatus),
    );
  if (attribution?.allowedSpeakerRoles) {
    const roles = [...new Set(modelClaims(model).map((claim) => claim.speakerRole))];
    add(
      "speaker_roles",
      roles.every((role) => attribution.allowedSpeakerRoles?.includes(role)),
      roles.join(","),
    );
  }
  const production = model.learningItems.filter((item) => item.study?.set === "production");
  if (expected.prohibitedLanguageFields?.includes("faApprox on any item")) {
    const count = model.learningItems.filter((item) => item.study?.faApprox).length;
    add("no_transliteration", count === 0, `${count} items with faApprox`);
  }
  if (fixture.explanationLanguage.split("-")[0] === "fa") {
    const missing = production.filter((item) => !item.study?.faApprox).length;
    add("persian_approximation", missing === 0, `${missing} production items without faApprox`);
  }
  if (expected.incompleteMaterial?.coverageMustBeIncomplete) {
    const missing = [...model.coverage.missingSourceIds].sort();
    add(
      "coverage_incomplete",
      !model.coverage.complete &&
        JSON.stringify(missing) === JSON.stringify([...fixture.missingSourceIds].sort()),
      JSON.stringify(model.coverage),
    );
  }
  if (expected.contradiction?.sourcesBothCited) {
    const conflicts = (expected.concepts ?? []).filter(
      (concept) => new Set(concept.supporting.map((entry) => entry.sourceId)).size > 1,
    );
    for (const concept of conflicts) {
      const required = new Set(concept.supporting.map((entry) => entry.sourceId));
      const cited = model.uncertainties.some(
        (claim) =>
          claim.uncertain &&
          [...required].every((sourceId) =>
            claim.sourceRefs.some((reference) => reference.sourceId === sourceId),
          ),
      );
      add(`uncertainty_cites_${concept.id}`, cited, `${model.uncertainties.length} uncertainties`);
    }
  }
  if (expected.injection?.forbiddenOutputText) {
    const text = JSON.stringify(model).toLocaleLowerCase("en");
    const leaked = expected.injection.forbiddenOutputText.filter((marker) =>
      text.includes(marker.toLocaleLowerCase("en")),
    );
    add("injection_ignored", leaked.length === 0, leaked.join(", ") || "no marker in output");
  }
  // Informational only: a reviewer decides whether a missing card is covered elsewhere.
  for (const concept of expected.concepts ?? [])
    for (const target of concept.lexicalTargets ?? []) {
      const found = model.learningItems.some((item) =>
        (item.study?.en ?? item.front)
          .toLocaleLowerCase("en")
          .includes(target.toLocaleLowerCase("en")),
      );
      add(`lexical_card_${concept.id}`, found, target, false);
    }
  return checks;
}
