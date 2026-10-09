/** Aggregates simulated journeys into the pre-registered metrics (PROTOCOL.md §7). */
import type { VoiceAcceptancePolicy } from "../../../packages/core/src/voc/policy.ts";
import { CONDITIONS } from "./ami.ts";
import {
  classFeature,
  clopperPearsonUpper,
  quantiles,
  referenceStatus,
  runTrial,
  type Target,
  type TrialOutcome,
  trialsFor,
} from "./simulate.ts";

function count<T extends string>(values: readonly T[]) {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function block(outcomes: readonly TrialOutcome[]) {
  const usable = outcomes.filter((item) => !item.failure);
  const opportunities = usable.filter((item) => item.opportunity);
  const correct = usable.filter((item) => item.accepted === "learner");
  const wrong = usable.filter((item) => item.accepted && item.accepted !== "learner");
  const ranked = usable.filter((item) => item.topIsLearner !== null);
  return {
    trials: outcomes.length,
    extractionFailures: count(outcomes.flatMap((item) => (item.failure ? [item.failure] : []))),
    learnerHasVector: usable.filter((item) => item.learnerVector).length,
    learnerHasClip: usable.filter((item) => item.learnerClip).length,
    opportunities: opportunities.length,
    acceptedCorrect: correct.length,
    falseAttributions: wrong.length,
    falseAttributionTypes: count(wrong.map((item) => `${item.kind}:${item.accepted}`)),
    askReasons: count(usable.flatMap((item) => (item.reason ? [item.reason] : []))),
    suggestionTopIsLearner: `${ranked.filter((item) => item.topIsLearner).length}/${ranked.length}`,
    acceptedAgreement: quantiles(
      correct.flatMap((item) => (item.agreement === null ? [] : [item.agreement])),
    ),
  };
}

export function summarize(all: readonly Target[], policy: VoiceAcceptancePolicy) {
  const modelVersion = policy.modelVersion;
  const references = all.map((target) => ({
    target,
    status: referenceStatus(target, target.confirmed, policy, modelVersion),
  }));
  const outcomes: TrialOutcome[] = [];
  for (const { target, status } of references) {
    if (status !== "added" || !target.sample || !target.confirmed?.vector) continue;
    for (const trial of trialsFor(target))
      outcomes.push(
        runTrial(
          target,
          trial,
          { sample: target.sample, lessons: [target.confirmed.vector] },
          policy,
        ),
      );
  }
  // A mistaken first confirmation that passes the sample check must not cause false matches.
  const poisoned: TrialOutcome[] = [];
  const mistakenStatus = all.map((target) => ({
    target,
    status: target.mistaken ? referenceStatus(target, target.mistaken, policy, modelVersion) : null,
  }));
  for (const { target, status } of mistakenStatus) {
    if (status !== "added" || !target.sample || !target.mistaken?.vector) continue;
    for (const trial of trialsFor(target))
      poisoned.push(
        runTrial(
          target,
          trial,
          { sample: target.sample, lessons: [target.mistaken.vector] },
          policy,
        ),
      );
  }
  const later = outcomes.filter((item) => item.kind === "later");
  const absent = outcomes.filter((item) => item.kind === "no_learner");
  const falseAttributions = outcomes.filter((item) => item.accepted && item.accepted !== "learner");
  const opportunities = outcomes.filter((item) => item.opportunity && !item.failure).length;
  const headsetEligible = later.filter(
    (item) => item.condition === "headset" && !item.failure && item.learnerVector,
  );
  const usefulness = headsetEligible.length
    ? headsetEligible.filter((item) => item.accepted === "learner").length / headsetEligible.length
    : null;
  const poisonedFalse = poisoned.filter((item) => item.accepted && item.accepted !== "learner");
  return {
    targets: all.length,
    enrolment: count(all.map((target) => target.enrolmentFailure ?? "ok")),
    firstClassReference: count(references.map((item) => item.status)),
    mistakenFirstClassReference: count(
      mistakenStatus.map((item) => (item.status === null ? "no_other_voice" : item.status)),
    ),
    laterByCondition: Object.fromEntries(
      CONDITIONS.map((condition) => [
        condition,
        block(later.filter((item) => item.condition === condition)),
      ]),
    ),
    noLearner: block(absent),
    poisonedProfile: {
      trials: poisoned.length,
      falseAttributions: poisonedFalse.length,
      acceptedCorrect: poisoned.filter((item) => item.accepted === "learner").length,
    },
    gates: {
      safetyFalseAttributions: {
        failures: falseAttributions.length,
        opportunities,
        upper95: clopperPearsonUpper(falseAttributions.length, opportunities),
        pass: falseAttributions.length === 0,
      },
      safetyPoisonedProfile: { failures: poisonedFalse.length, pass: poisonedFalse.length === 0 },
      evidence: { opportunities, required: 100, pass: opportunities >= 100 },
      usefulness: {
        headsetAutoAcceptRate: usefulness,
        eligibleTrials: headsetEligible.length,
        target: 0.5,
        pass: usefulness !== null && usefulness >= 0.5,
      },
    },
    trials: outcomes.map((item) => ({ ...item, agreement: item.agreement })),
  };
}

export function resourceSummary(
  meetings: readonly { meeting: string; condition: (typeof CONDITIONS)[number] }[],
) {
  const features = meetings.map(({ meeting, condition }) => classFeature(meeting, condition));
  const ok = features.filter((feature) => !feature.failure);
  return {
    recordings: features.length,
    failures: features.length - ok.length,
    recordingMinutes: quantiles(ok.map((feature) => feature.durationMs / 60000)),
    compositeSeconds: quantiles(
      ok.flatMap((feature) =>
        feature.timing.compositeMs === null ? [] : [feature.timing.compositeMs / 1000],
      ),
    ),
    wallSeconds: quantiles(ok.map((feature) => feature.timing.wallMs / 1000)),
    cpuSeconds: quantiles(
      ok.map((feature) => (feature.timing.cpuUserMs + feature.timing.cpuSystemMs) / 1000),
    ),
    peakRssMb: Math.max(...features.map((feature) => feature.timing.maxRssKb)) / 1024,
    sampled: ok.filter((feature) => feature.sampled).length,
    partial: ok.filter((feature) => feature.partial).length,
    paidCalls: 0,
  };
}
