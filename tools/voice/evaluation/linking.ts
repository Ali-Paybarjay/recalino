/**
 * Synthetic evaluation of workstream 4 (2026-10-12): speaker linking across recording parts,
 * fragment rate, and target-speaker turn detection. Only generated vectors are used; no person is
 * recorded and no licensed corpus is read. Every decision is made by the production functions in
 * packages/core/src/voc. The numbers describe the rules on this generator, not real classrooms;
 * they are no basis for an acceptance policy (D54).
 *
 *   node tools/voice/evaluation/linking.ts            # prints the report
 *   node tools/voice/evaluation/linking.ts --write    # also writes linking-report.json
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VoiceCandidate } from "../../../packages/core/src/voc/contracts.ts";
import {
  type LinkableVoice,
  linkClassVoices,
  VOICE_LINK_MARGIN,
  VOICE_LINK_THRESHOLD,
} from "../../../packages/core/src/voc/linking.ts";
import {
  rankVoiceCandidates,
  suggestedVoice,
  suggestibleVoice,
  voiceCosine,
} from "../../../packages/core/src/voc/matching.ts";

const DIMENSION = 64;

/** Deterministic PRNG (mulberry32) so every run of the report is identical. */
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(next: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12))) * Math.cos(2 * Math.PI * next());
}
function unit(values: number[]) {
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
}
/** `scale` is the noise's length relative to the unit voice vector. */
function noisy(base: number[], scale: number, next: () => number) {
  return unit(base.map((value) => value + (scale * gaussian(next)) / Math.sqrt(DIMENSION)));
}

export interface Scenario {
  seed: number;
  parts: number;
  classmates: number;
  /** Per-voice noise of a part's pooled voiceprint (recording conditions). */
  partNoise: number;
  /** Noise of a single short turn's voiceprint, larger than a pooled one. */
  turnNoise: number;
  /** Far-field channel shift between the class recording and the near-field sample. */
  channelShift: number;
  /** Fragments the diarizer splits off per part (voices with under 20 s of clean speech). */
  fragmentsPerPart: number;
  /** Short learner turns and other speakers' short turns per part. */
  learnerTurns: number;
  otherTurns: number;
  /** One classmate's voice mixed toward the learner's, 0 for none (a similar-sounding peer). */
  lookalike?: number;
}

export const SCENARIOS: Scenario[] = [
  {
    // Shaped like the 2026-10-12 class: far-field phone, six parts, a similar-sounding peer.
    seed: 4,
    parts: 6,
    classmates: 5,
    partNoise: 0.9,
    turnNoise: 1.4,
    channelShift: 1.2,
    fragmentsPerPart: 3,
    learnerTurns: 5,
    otherTurns: 40,
    lookalike: 0.6,
  },
  {
    seed: 1,
    parts: 6,
    classmates: 4,
    partNoise: 0.25,
    turnNoise: 0.6,
    channelShift: 0.5,
    fragmentsPerPart: 3,
    learnerTurns: 6,
    otherTurns: 30,
  },
  {
    seed: 2,
    parts: 6,
    classmates: 6,
    partNoise: 0.35,
    turnNoise: 0.8,
    channelShift: 0.8,
    fragmentsPerPart: 4,
    learnerTurns: 4,
    otherTurns: 40,
  },
  {
    seed: 3,
    parts: 3,
    classmates: 2,
    partNoise: 0.2,
    turnNoise: 0.5,
    channelShift: 0.3,
    fragmentsPerPart: 2,
    learnerTurns: 8,
    otherTurns: 20,
  },
];

export function simulate(scenario: Scenario, minScore = 0.6) {
  const next = random(scenario.seed);
  const people = [
    "teacher",
    "learner",
    ...Array.from({ length: scenario.classmates }, (_, i) => `c${i}`),
  ];
  // People share a common "voice space" direction, so different voices still correlate
  // (cosine about 0.3–0.5), as real speaker embeddings of one room do.
  const common = Array.from({ length: DIMENSION }, () => gaussian(next));
  const identity = new Map(
    people.map((person) => [person, unit(common.map((value) => 0.7 * value + gaussian(next)))]),
  );
  const learner = identity.get("learner") ?? [];
  const mix = scenario.lookalike ?? 0;
  if (mix && scenario.classmates)
    identity.set(
      "c0",
      unit(
        (identity.get("c0") ?? []).map((value, i) => (1 - mix) * value + mix * (learner[i] ?? 0)),
      ),
    );
  const channel = Array.from({ length: DIMENSION }, () => gaussian(next));
  const room = (vector: number[]) =>
    unit(
      vector.map(
        (value, index) =>
          value + (scenario.channelShift * (channel[index] ?? 0)) / Math.sqrt(DIMENSION),
      ),
    );
  const sample = noisy(identity.get("learner") ?? [], 0.1, next);

  const voices: (LinkableVoice & { person: string })[] = [];
  let fragments = 0,
    total = 0,
    fragmentSuggested = 0;
  // A short turn needs line-level detection only where its speaker has no voiceprint of their
  // own; it is scored against the sample and, when it sits inside a voice that has a
  // voiceprint, proposed only if it beats that voice's own score (scoreTargetTurns).
  const turns: { learner: boolean; score: number | null; own: number | null }[] = [];
  for (let part = 0; part < scenario.parts; part++) {
    const analysisId = `part-${part}`;
    // Not everyone talks in every part; the teacher and the learner always do.
    const present = people.filter(
      (person) => person === "teacher" || person === "learner" || next() < 0.7,
    );
    const candidates: VoiceCandidate[] = [];
    const vectors: { speakerId: string; vector: number[] }[] = [];
    for (const person of present) {
      const speakerId = `${analysisId}:${person}`;
      // The learner rarely reaches 20 s of clean speech in a part; others usually do.
      const cleanSpeechMs =
        person === "teacher"
          ? 120000
          : person === "learner"
            ? next() < 0.5
              ? 24000
              : 9000
            : 30000;
      candidates.push({
        id: speakerId,
        label: person,
        score: null,
        cleanSpeechMs,
        clips: [{ startMs: 0, endMs: 6000, text: "" }],
        lines: [],
      });
      if (cleanSpeechMs >= 20000) {
        const vector = room(noisy(identity.get(person) ?? [], scenario.partNoise, next));
        vectors.push({ speakerId, vector });
        voices.push({ analysisId, speakerId, modelVersion: "synthetic", vector, person });
      }
    }
    for (let index = 0; index < scenario.fragmentsPerPart; index++)
      candidates.push({
        id: `${analysisId}:fragment-${index}`,
        label: "fragment",
        score: null,
        cleanSpeechMs: Math.floor(next() * 3000),
        clips: [],
        lines: [],
      });
    const ranked = rankVoiceCandidates(
      candidates,
      vectors,
      {
        enabled: true,
        version: 1,
        modelVersion: "synthetic",
        embeddings: [
          { vector: sample, modelVersion: "synthetic", analysisId: null, createdAt: "x" },
        ],
      },
      "synthetic",
    );
    total += candidates.length;
    fragments += candidates.filter((item) => !suggestibleVoice(item, true)).length;
    const suggestion = suggestedVoice(ranked, true);
    if (suggestion && !suggestibleVoice(suggestion, true)) fragmentSuggested++;
    // Short turns: each scored on its own against the near-field sample. The learner's turns
    // count only in parts without a learner voiceprint (otherwise the class voice covers them);
    // half of them were merged into the teacher's voice, half form fragments.
    const teacherVector = vectors.find(
      (item) => item.speakerId === `${analysisId}:teacher`,
    )?.vector;
    const teacherOwn = teacherVector ? voiceCosine(teacherVector, sample) : null;
    const learnerHasPrint = vectors.some((item) => item.speakerId === `${analysisId}:learner`);
    if (!learnerHasPrint)
      for (let index = 0; index < scenario.learnerTurns; index++)
        turns.push({
          learner: true,
          score: voiceCosine(
            room(noisy(identity.get("learner") ?? [], scenario.turnNoise, next)),
            sample,
          ),
          own: index % 2 === 0 ? teacherOwn : null,
        });
    for (let index = 0; index < scenario.otherTurns; index++) {
      const person = present.filter((item) => item !== "learner")[
        Math.floor(next() * (present.length - 1))
      ];
      const ownVector = vectors.find(
        (item) => item.speakerId === `${analysisId}:${person}`,
      )?.vector;
      turns.push({
        learner: false,
        score: voiceCosine(
          room(noisy(identity.get(person ?? "teacher") ?? [], scenario.turnNoise, next)),
          sample,
        ),
        own: ownVector ? voiceCosine(ownVector, sample) : null,
      });
    }
  }

  // Linking: pairwise precision and recall over voices of different parts.
  const linked = linkClassVoices(voices);
  const group = new Map<string, string>();
  for (const voice of linked)
    for (const member of voice.members) group.set(member.speakerId, voice.id);
  let truePairs = 0,
    linkedPairs = 0,
    correctPairs = 0;
  for (let i = 0; i < voices.length; i++)
    for (let j = i + 1; j < voices.length; j++) {
      const a = voices[i],
        b = voices[j];
      if (!a || !b || a.analysisId === b.analysisId) continue;
      const same = a.person === b.person;
      const joined = group.get(a.speakerId) === group.get(b.speakerId);
      if (same) truePairs++;
      if (joined) linkedPairs++;
      if (same && joined) correctPairs++;
    }
  const proposed = turns.filter(
    (turn) =>
      turn.score !== null && turn.score >= minScore && (turn.own === null || turn.score > turn.own),
  );
  const learnerTurns = turns.filter((turn) => turn.learner).length;
  const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
  return {
    seed: scenario.seed,
    linking: {
      voices: voices.length,
      classVoices: linked.length,
      people: new Set(voices.map((voice) => voice.person)).size,
      precision: ratio(correctPairs, linkedPairs),
      recall: ratio(correctPairs, truePairs),
      ambiguousRate: ratio(linked.filter((voice) => voice.ambiguous).length, linked.length),
    },
    fragments: {
      rate: ratio(fragments, total),
      suggestedRate: ratio(fragmentSuggested, scenario.parts),
    },
    targetSpeaker: {
      minScore,
      precision: ratio(proposed.filter((turn) => turn.learner).length, proposed.length),
      recall: ratio(proposed.filter((turn) => turn.learner).length, learnerTurns),
    },
  };
}

export function report() {
  return {
    generated: "synthetic vectors only; no recording, no licensed corpus",
    rules: { threshold: VOICE_LINK_THRESHOLD, margin: VOICE_LINK_MARGIN },
    scenarios: SCENARIOS.map((scenario) => ({
      scenario,
      result: simulate(scenario),
      // How the proposal floor (targetTurnMinScore) trades precision for recall here.
      targetSweep: [0.3, 0.4, 0.5, 0.6, 0.7].map(
        (minScore) => simulate(scenario, minScore).targetSpeaker,
      ),
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = report();
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--write"))
    writeFileSync(
      join(import.meta.dirname, "linking-report.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
}
