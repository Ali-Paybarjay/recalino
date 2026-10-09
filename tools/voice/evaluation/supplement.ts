/**
 * Supplementary analysis, added after the freeze and NOT pre-registered (PROTOCOL.md is
 * unchanged). The SAFETY-1 bound in holdout-report.json treats every trial as independent, but
 * the six later classes and three classes without the learner of one participant share that
 * participant's references. This reports the same holdout trials counted once per participant,
 * a more conservative bound. It never replaces a gate.
 *
 *   pnpm exec tsx --conditions=react-server tools/voice/evaluation/supplement.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVALUATION_DIR } from "./ami.ts";
import { clopperPearsonUpper, type TrialOutcome } from "./simulate.ts";

const report = JSON.parse(readFileSync(join(EVALUATION_DIR, "holdout-report.json"), "utf8")) as {
  protocolSha256: string;
  trials: TrialOutcome[];
};
const participants = new Map<string, { opportunity: boolean; falseAttribution: boolean }>();
for (const trial of report.trials) {
  if (trial.failure) continue;
  const entry = participants.get(trial.target) ?? { opportunity: false, falseAttribution: false };
  entry.opportunity ||= trial.opportunity;
  entry.falseAttribution ||= Boolean(trial.accepted && trial.accepted !== "learner");
  participants.set(trial.target, entry);
}
const withOpportunity = [...participants.values()].filter((entry) => entry.opportunity);
const failures = [...participants.values()].filter((entry) => entry.falseAttribution).length;
const output = {
  note: "Supplementary, post-hoc, not pre-registered; participant-level count of the holdout trials.",
  protocolSha256: report.protocolSha256,
  participantsWithTrials: participants.size,
  participantsWithOpportunity: withOpportunity.length,
  participantsWithFalseAttribution: failures,
  upper95: clopperPearsonUpper(failures, withOpportunity.length),
};
writeFileSync(join(EVALUATION_DIR, "supplement.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
