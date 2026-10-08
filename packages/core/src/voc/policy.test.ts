import { describe, expect, it } from "vitest";
import type { VoiceEnrollment } from "./contracts";
import {
  decideVoiceMatch,
  type VoiceAcceptancePolicy,
  voiceAgreement,
  voiceReferenceConsistency,
  voiceReferenceOutcome,
  voiceReferences,
} from "./policy";
import { VOICE_ACCEPTANCE_POLICIES, voiceAcceptancePolicy } from "./policy-registry";

// Synthetic unit fixture: a hand-written policy, not the evaluated production numbers.
const policy: VoiceAcceptancePolicy = {
  id: "unit-test-policy",
  modelVersion: "v1",
  acceptScore: 0.7,
  minMargin: 0.1,
  referenceConsistency: 0.6,
  minCleanSpeechMs: 20000,
  autoAccept: true,
};
/** A unit vector at cosine `c` from the first axis (16 dimensions, like stored vectors). */
function at(c: number, axis = 1): number[] {
  const vector = Array(16).fill(0);
  vector[0] = c;
  vector[axis] = Math.sqrt(1 - c * c);
  return vector;
}
const own = at(1);
function enrollment(sample: number[] | null, lessons: number[][], model = "v1"): VoiceEnrollment {
  return {
    version: 1,
    enabled: true,
    modelVersion: model,
    embeddings: [
      ...lessons.map((vector, index) => ({
        vector,
        modelVersion: model,
        analysisId: `00000000-0000-4000-8000-00000000000${index}`,
        createdAt: "2026-10-08T00:00:00.000Z",
      })),
      ...(sample
        ? [
            {
              vector: sample,
              modelVersion: model,
              analysisId: null,
              createdAt: "2026-10-08T00:00:00Z",
            },
          ]
        : []),
    ],
  };
}
const voices = (cleanSpeechMs = 25000) => [
  { id: "learner", cleanSpeechMs, score: 0.9 },
  { id: "teacher", cleanSpeechMs: 300000, score: 0.2 },
];
const vectors = (learner = at(0.9), teacher = at(0.1, 2)) => [
  { speakerId: "learner", vector: learner },
  { speakerId: "teacher", vector: teacher },
];
function decide(overrides: Partial<Parameters<typeof decideVoiceMatch>[0]> = {}) {
  return decideVoiceMatch({
    candidates: voices(),
    vectors: vectors(),
    enrollment: enrollment(own, [own]),
    modelVersion: "v1",
    policy,
    ...overrides,
  });
}

describe("VOICE-AC-04 FR-VOC-003: one sample and one confirmed class can match later classes", () => {
  it("accepts a clear learner voice that agrees with both references", () => {
    expect(decide()).toEqual({ acceptedId: "learner", reason: null });
  });
  it("ranks agreement as the weaker of the two references, not their average", () => {
    const similarity = voiceAgreement(
      at(0.9),
      voiceReferences(enrollment(own, [at(0.3, 3)]), "v1"),
    );
    expect(similarity.agreement).toBeLessThan(0.4);
    expect(similarity.best).toBeCloseTo(0.9);
  });
});

describe("VOICE-AC-05: any doubt asks the learner", () => {
  it("asks without a sample or without a confirmed class reference", () => {
    expect(decide({ enrollment: enrollment(null, [own]) }).reason).toBe("no_sample");
    expect(decide({ enrollment: enrollment(own, []) }).reason).toBe("no_reference");
  });
  it("asks when the policy is missing, switched off or for another model revision", () => {
    expect(decide({ policy: null }).reason).toBe("policy_unavailable");
    expect(decide({ policy: { ...policy, autoAccept: false } }).reason).toBe("policy_unavailable");
    expect(decide({ modelVersion: "v2", enrollment: enrollment(own, [own], "v2") }).reason).toBe(
      "policy_unavailable",
    );
  });
  it("keeps the two-voice rule: a lone or short voice is never accepted", () => {
    expect(decide({ candidates: voices().slice(0, 1) }).reason).toBe("few_voices");
    // A voice with too little clean speech is never accepted, yet it still competes.
    expect(decide({ candidates: voices(19999) })).toEqual({
      acceptedId: null,
      reason: "no_clear_match",
    });
    expect(
      decide({
        candidates: [...voices(), { id: "brief", cleanSpeechMs: 8000, score: 0.85 }],
        vectors: [...vectors(), { speakerId: "brief", vector: at(0.88, 3) }],
      }).reason,
    ).toBe("similar_voices");
    expect(decide({ vectors: vectors().slice(0, 1) }).reason).toBe("few_voices");
  });
  it("asks when no voice is close enough to both references", () => {
    expect(decide({ vectors: vectors(at(0.65)) }).reason).toBe("no_clear_match");
    // Close to the class reference but not to the sample (e.g. a confirmed teacher).
    expect(decide({ enrollment: enrollment(at(0.2, 3), [own]) }).reason).toBe("no_clear_match");
  });
  it("asks when another voice resembles either reference", () => {
    expect(decide({ vectors: vectors(at(0.9), at(0.85, 2)) }).reason).toBe("similar_voices");
  });
  it("asks when a voice the learner rejected before scored like this one", () => {
    expect(decide({ rejectedScores: [0.85] }).reason).toBe("similar_voices");
    expect(decide({ rejectedScores: [0.4] }).acceptedId).toBe("learner");
  });
  it("ignores non-finite or incompatible vectors instead of matching them", () => {
    expect(decide({ vectors: vectors([...at(0.9).slice(0, 15), Number.NaN]) }).reason).toBe(
      "few_voices",
    );
    expect(decide({ vectors: vectors(at(0.9).slice(0, 8)) }).reason).toBe("few_voices");
  });
});

describe("VOICE-AC-03: a confirmation becomes a reference only with clear, consistent speech", () => {
  const references = voiceReferences(enrollment(own, []), "v1");
  const outcome = (input: Partial<Parameters<typeof voiceReferenceOutcome>[0]>) =>
    voiceReferenceOutcome({
      acoustic: true,
      vector: at(0.9),
      cleanSpeechMs: 25000,
      expired: false,
      references,
      policy,
      ...input,
    });
  it("adds a consistent voice and explains every other outcome", () => {
    expect(outcome({})).toBe("added");
    expect(outcome({ cleanSpeechMs: 12000 })).toBe("short");
    expect(outcome({ expired: true, vector: undefined })).toBe("expired");
    expect(outcome({ vector: undefined })).toBe("missing");
    expect(outcome({ acoustic: false })).toBe("missing");
    expect(outcome({ vector: at(0.3, 2) })).toBe("mismatch");
  });
  it("cannot check consistency without a sample or a policy, and then keeps the old behaviour", () => {
    expect(
      voiceReferenceConsistency(at(0.1), voiceReferences(enrollment(null, []), "v1"), policy),
    ).toBe("unchecked");
    expect(voiceReferenceConsistency(at(0.1), references, null)).toBe("unchecked");
    expect(outcome({ policy: null, vector: at(0.1, 2) })).toBe("added");
  });
});

it("ships automatic acceptance only for an evaluated model revision", () => {
  for (const entry of VOICE_ACCEPTANCE_POLICIES) {
    expect(entry.acceptScore).toBeGreaterThan(0);
    expect(entry.acceptScore).toBeLessThanOrEqual(1);
    expect(entry.minMargin).toBeGreaterThan(0);
    expect(entry.minCleanSpeechMs).toBeGreaterThanOrEqual(20000);
  }
  expect(voiceAcceptancePolicy("transcript-labels-v1")).toBeNull();
});
