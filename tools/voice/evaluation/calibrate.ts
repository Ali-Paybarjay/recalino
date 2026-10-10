/**
 * Chooses the acceptance numbers from the CALIBRATION split only (PROTOCOL.md §6).
 *
 *   pnpm exec tsx tools/voice/evaluation/calibrate.ts
 *
 * Reads no holdout feature. Writes calibration.json beside this file.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VoiceAcceptancePolicy } from "../../../packages/core/src/voc/policy.ts";
import { EVALUATION_DIR } from "./ami.ts";
import { assertFrozen } from "./freeze.ts";
import {
  classFeature,
  identityOf,
  impostorAgreements,
  majorityIsLearner,
  quantiles,
  referenceStatus,
  round,
  similarity,
  targets,
} from "./simulate.ts";
import { summarize } from "./summary.ts";

/** Pre-registered constants (PROTOCOL.md §6). */
export const CALIBRATION_RULE = {
  acceptBuffer: 0.05,
  consistencyBuffer: 0.05,
  minMargin: 0.1,
  minCleanSpeechMs: 20000,
  policyId: "voice-accept-v1",
} as const;

export function protocolHash() {
  return createHash("sha256")
    .update(readFileSync(join(EVALUATION_DIR, "PROTOCOL.md")))
    .digest("hex");
}

function main() {
  const freeze = assertFrozen();
  const all = targets("calibration");
  const modelVersion = classFeature(`${all[0]?.group}b`, "headset").modelRevision;
  const consistencyImpostor: number[] = [],
    consistencyGenuine: number[] = [];
  for (const target of all) {
    if (!target.sample) continue;
    const first = classFeature(`${target.group}b`, "headset");
    for (const candidate of first.candidates) {
      if (!candidate.vector) continue;
      const value = similarity(target.sample, candidate.vector);
      if (value === null) continue;
      if (!majorityIsLearner(candidate, target.participant)) consistencyImpostor.push(value);
      else if (candidate === target.confirmed) consistencyGenuine.push(value);
    }
  }
  if (!consistencyImpostor.length) throw new Error("no consistency impostors");
  const referenceConsistency =
    Math.max(...consistencyImpostor) + CALIBRATION_RULE.consistencyBuffer;
  const consistencyPolicy: VoiceAcceptancePolicy = {
    id: CALIBRATION_RULE.policyId,
    modelVersion,
    acceptScore: Number.POSITIVE_INFINITY,
    minMargin: CALIBRATION_RULE.minMargin,
    referenceConsistency,
    minCleanSpeechMs: CALIBRATION_RULE.minCleanSpeechMs,
    autoAccept: true,
  };
  const impostor: number[] = [],
    genuine: number[] = [];
  for (const target of all) {
    if (!target.sample || !target.confirmed?.vector) continue;
    if (referenceStatus(target, target.confirmed, consistencyPolicy, modelVersion) !== "added")
      continue;
    const scores = impostorAgreements(
      target,
      { sample: target.sample, lessons: [target.confirmed.vector] },
      CALIBRATION_RULE.minCleanSpeechMs,
    );
    impostor.push(...scores.impostor);
    genuine.push(...scores.genuine);
  }
  if (!impostor.length) throw new Error("no acceptance impostors");
  const policy: VoiceAcceptancePolicy = {
    ...consistencyPolicy,
    acceptScore: round(Math.max(...impostor) + CALIBRATION_RULE.acceptBuffer, 6) as number,
    referenceConsistency: round(referenceConsistency, 6) as number,
  };
  const inSample = summarize(all, policy);
  const output = {
    protocolSha256: protocolHash(),
    freeze: { sources: freeze.sources, manifestSha256: freeze.manifestSha256 },
    split: "calibration",
    targets: all.length,
    rule: CALIBRATION_RULE,
    policy,
    distributions: {
      consistencyImpostor: quantiles(consistencyImpostor),
      consistencyGenuine: quantiles(consistencyGenuine),
      acceptanceImpostor: quantiles(impostor),
      acceptanceGenuine: quantiles(genuine),
    },
    pureConfirmations: all.filter(
      (target) =>
        target.confirmed && identityOf(target.confirmed, target.participant) === "learner",
    ).length,
    inSampleNotEvidence: inSample,
  };
  writeFileSync(join(EVALUATION_DIR, "calibration.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ policy, distributions: output.distributions }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
