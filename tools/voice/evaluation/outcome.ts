/**
 * Records why round voice-eval-ami-v1 produced no policy. calibrate.ts (frozen) stops with "no
 * acceptance impostors" because its consistency rule rejected every genuine confirmation. This
 * script was added after that stop and is NOT pre-registered. It reads the calibration split
 * only, plus the resource figures of every check (no identity decision), and writes
 * outcome.json. It reads no holdout identity result and computes no gate.
 *
 *   pnpm exec tsx --conditions=react-server tools/voice/evaluation/outcome.ts
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AMI_FEATURES, AMI_GROUPS, CONDITIONS, EVALUATION_DIR } from "./ami.ts";
import { CALIBRATION_RULE, protocolHash } from "./calibrate.ts";
import { assertFrozen } from "./freeze.ts";
import {
  type CandidateFeature,
  classFeature,
  enrollmentFeature,
  majorityIsLearner,
  quantiles,
  referenceStatus,
  round,
  similarity,
  targets,
} from "./simulate.ts";
import { resourceSummary } from "./summary.ts";

const count = (values: readonly string[]) =>
  values.reduce<Record<string, number>>((total, value) => {
    total[value] = (total[value] ?? 0) + 1;
    return total;
  }, {});
const learnerShare = (candidate: CandidateFeature, participant: string) => {
  const annotated = Object.values(candidate.shares).reduce((sum, value) => sum + value, 0);
  return annotated ? (candidate.shares[participant] ?? 0) / annotated : 0;
};

const freeze = assertFrozen();
const calibration = targets("calibration");
const modelVersion = classFeature(`${calibration[0]?.group}b`, "headset").modelRevision;
const impostors: { meeting: string; learnerShare: number; cleanSpeechMs: number; sim: number }[] =
  [];
const genuine: number[] = [];
for (const target of calibration) {
  if (!target.sample) continue;
  const first = classFeature(`${target.group}b`, "headset");
  for (const candidate of first.candidates) {
    if (!candidate.vector) continue;
    const value = similarity(target.sample, candidate.vector);
    if (value === null) continue;
    if (!majorityIsLearner(candidate, target.participant))
      impostors.push({
        meeting: first.meeting,
        learnerShare: round(learnerShare(candidate, target.participant), 3) as number,
        cleanSpeechMs: candidate.cleanSpeechMs,
        sim: round(value, 4) as number,
      });
    else if (candidate === target.confirmed) genuine.push(value);
  }
}
impostors.sort((a, b) => b.sim - a.sim);
const limit = (impostors[0]?.sim ?? 0) + CALIBRATION_RULE.consistencyBuffer;
// Without the consistency limit: what the first confirmation would otherwise have taught.
const unlimited = {
  id: "outcome-diagnostic",
  modelVersion,
  acceptScore: 2,
  minMargin: CALIBRATION_RULE.minMargin,
  referenceConsistency: -1,
  minCleanSpeechMs: CALIBRATION_RULE.minCleanSpeechMs,
  autoAccept: false,
};
const enrolment = AMI_GROUPS.flatMap((group) =>
  readdirSync(AMI_FEATURES)
    .filter((file) => file.startsWith(`enrol.${group}.`))
    .map((file) => enrollmentFeature(group, file.split(".")[2] ?? "").failure ?? "ok"),
);
const output = {
  note: "Not pre-registered. Explains why the frozen calibration produced no policy; reads the calibration split and resource figures only.",
  protocol: "voice-eval-ami-v1",
  protocolSha256: protocolHash(),
  manifestSha256: freeze.manifestSha256,
  enrolmentAllParticipants: count(enrolment),
  calibration: {
    participants: calibration.length,
    withSample: calibration.filter((target) => target.sample).length,
    firstConfirmation: count(
      calibration.map((target) =>
        target.confirmed ? (target.confirmed.vector ? "voiceprint" : "no_voiceprint") : "none",
      ),
    ),
    referenceWithoutConsistencyLimit: count(
      calibration.map((target) =>
        referenceStatus(target, target.confirmed, unlimited, modelVersion),
      ),
    ),
    consistencyImpostorSimilarity: quantiles(impostors.map((item) => item.sim)),
    genuineConfirmationSimilarity: quantiles(genuine.map((value) => round(value, 4) as number)),
    frozenConsistencyLimit: round(limit, 4),
    genuineAtOrAboveLimit: genuine.filter((value) => value >= limit).length,
    closestImpostors: impostors.slice(0, 8),
  },
  conclusion:
    "No reference passes the frozen consistency limit, so calibration has no acceptance impostors and no policy exists. EVIDENCE (≥100 holdout opportunities) cannot be met; the holdout was not run and automatic acceptance stays off.",
  resources: resourceSummary(
    AMI_GROUPS.flatMap((group) => [
      { meeting: `${group}b`, condition: "headset" as const },
      ...["c", "d"].flatMap((session) =>
        CONDITIONS.map((condition) => ({ meeting: `${group}${session}`, condition })),
      ),
    ]),
  ),
};
writeFileSync(join(EVALUATION_DIR, "outcome.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
