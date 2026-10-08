import { describe, expect, it } from "vitest";
import { errors } from "../plt";
import type { RunSource } from "./contracts";
import {
  alignVoiceUtterances,
  buildTranscriptVoiceAnalysis,
  buildVoiceAnalysis,
  scopedVoiceSpeakerId,
  type VoiceDiarization,
  validateVoiceCorrections,
  voiceCorrectionFailure,
  voicePreparationFailure,
} from "./voice-processing";

const sourceId = "a971b7b0-ae80-47aa-80a3-ec6bd66782e2";
const sourceVersionId = "9c46d515-608a-4264-a1af-6f1c01cfa567";
const base = {
  sessionId: "ca9385c3-c7ef-4086-a0ea-bbf52946cfac",
  sourceId,
  sourceVersionId,
  runId: "321ee97c-5d48-4c89-a982-bad0c1d1b593",
  profileVersion: 1,
};
function source(
  turns = [{ start: 1000, end: 8000, text: "I am agree with you.", speaker: "0" }],
): RunSource {
  return {
    sourceId,
    contentVersionId: sourceVersionId,
    kind: "audio",
    sha256: "a".repeat(64),
    mimeType: "audio/mpeg",
    durationMs: 60000,
    pageCount: null,
    objectId: null,
    captureAnchor: null,
    ranges: [],
    units: turns.map((turn, i) => ({
      id: `u${i}`,
      kind: "time",
      start: turn.start,
      end: turn.end,
      status: "extracted",
    })),
    blocks: turns.map((turn, i) => ({
      id: `b${i}`,
      unitId: `u${i}`,
      kind: "transcript",
      text: turn.text,
      speakerId: turn.speaker,
    })),
  };
}
const segment = (speakerId = "0", startMs = 0, endMs = 10000) => ({
  speakerId,
  startMs,
  endMs,
  overlap: false,
  boundaryUnsafe: false,
});
const diarization = (segments = [segment()]): VoiceDiarization => ({
  modelRevision: "fixture",
  segments,
  speakers: [
    {
      speakerId: "0",
      embedding: Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : 0)),
      cleanSpeechMs: 21000,
    },
  ],
});

describe("speaker evidence alignment", () => {
  it("scopes provider labels by source and chunk", () => {
    expect(scopedVoiceSpeakerId(sourceId, "chunk1", "0")).not.toBe(
      scopedVoiceSpeakerId(sourceId, "chunk2", "0"),
    );
    expect(scopedVoiceSpeakerId(sourceId, "chunk1", "0")).not.toBe(
      scopedVoiceSpeakerId("other-source", "chunk1", "0"),
    );
    expect(scopedVoiceSpeakerId(sourceId, "chunk1", "0")).toBe(
      scopedVoiceSpeakerId(sourceId, "chunk1", "0"),
    );
  });
  it("accepts only a fully covered clean utterance of at least two seconds", () => {
    const aligned = alignVoiceUtterances(source(), diarization());
    expect(aligned).toHaveLength(1);
    expect(aligned[0]).toMatchObject({ id: "b0", eligible: true, text: "I am agree with you." });
    expect(alignVoiceUtterances(source(), diarization([segment("0", 2000, 10000)]))).toEqual([]);
    const short = source([{ start: 1000, end: 2000, text: "Yes.", speaker: "0" }]);
    expect(alignVoiceUtterances(short, diarization())[0]?.eligible).toBe(false);
  });
  it("rejects overlapping speakers and marks uncertain boundaries ineligible", () => {
    expect(
      alignVoiceUtterances(source(), diarization([segment(), segment("1", 3000, 4000)])),
    ).toEqual([]);
    expect(
      alignVoiceUtterances(source(), diarization([{ ...segment(), boundaryUnsafe: true }]))[0]
        ?.eligible,
    ).toBe(false);
    expect(
      alignVoiceUtterances(source(), diarization([{ ...segment(), overlap: true }]))[0]?.eligible,
    ).toBe(false);
  });
  it("retains short-turn speakers as manual candidates without inventing embeddings", () => {
    const model = buildVoiceAnalysis(
      base,
      source(),
      diarization([segment(), segment("1", 12000, 13000)]),
    );
    expect(model.candidates).toHaveLength(2);
    expect(model.candidates[1]).toMatchObject({
      cleanSpeechMs: 0,
      score: null,
      lines: [],
      clips: [],
    });
    expect(model.embeddings).toHaveLength(1);
  });
  it("selects distant clips and refuses to enroll short pooled speech", () => {
    const turns = [1000, 16000, 31000, 46000].map((start) => ({
      start,
      end: start + 8000,
      text: "I am agree with you.",
      speaker: "0",
    }));
    const d = diarization(turns.map((turn) => segment("0", turn.start - 300, turn.end + 300)));
    for (const speaker of d.speakers) speaker.cleanSpeechMs = 19000;
    const result = buildVoiceAnalysis(base, source(turns), d);
    expect(result.candidates[0]?.clips.map((clip) => clip.startMs)).toEqual([1000, 16000, 46000]);
    expect(result.embeddings).toEqual([]);
  });
  it("does not join legacy numeric transcript labels after audio expiry", () => {
    expect(buildTranscriptVoiceAnalysis(base, source()).candidates).toEqual([]);
    const scoped = scopedVoiceSpeakerId(sourceId, "chunk1", "0");
    const result = buildTranscriptVoiceAnalysis(
      base,
      source([{ start: 0, end: 8000, text: "I am agree.", speaker: scoped }]),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.embeddings).toEqual([]);
    // No voiceprint, but the timed, unoverlapped turn can be played from the local original.
    expect(result.candidates[0]?.clips).toEqual([{ startMs: 0, endMs: 8000, text: "I am agree." }]);
  });
  it("withholds labelled fallback utterances outside the selected recording range or measured duration", () => {
    const scoped = scopedVoiceSpeakerId(sourceId, "chunk1", "0");
    const selected = source([{ start: 10000, end: 18000, text: "I am agree.", speaker: scoped }]);
    selected.ranges = [{ start: 20000, end: 30000 }];
    expect(buildTranscriptVoiceAnalysis(base, selected).candidates).toEqual([]);
    selected.ranges = [];
    selected.durationMs = 15000;
    expect(buildTranscriptVoiceAnalysis(base, selected).candidates).toEqual([]);
  });
  it("retains sampled acoustic coverage and original speaker timestamps without changing the embedding model", () => {
    const sampled = buildVoiceAnalysis(base, source(), { ...diarization(), sampled: true });
    expect(sampled.reason).toBe("sampled_audio");
    expect(buildVoiceAnalysis(base, source(), { ...diarization(), partial: true }).reason).toBe(
      "partial_audio",
    );
    expect(
      buildVoiceAnalysis(base, source(), { ...diarization(), sampled: true, partial: true }).reason,
    ).toBe("sampled_partial_audio");
    expect(buildVoiceAnalysis(base, source(), diarization()).reason).toBeUndefined();
    expect(sampled.modelVersion).toBe("fixture");
    expect(sampled.candidates[0]?.clips[0]).toMatchObject({ startMs: 1000, endMs: 8000 });
  });
});

describe("private correction evidence", () => {
  const analysis = buildVoiceAnalysis(
    base,
    source([
      { start: 1000, end: 8000, text: "I am agree with you.", speaker: "0" },
      { start: 30000, end: 38000, text: "I am agree with you.", speaker: "0" },
    ]),
    diarization([segment("0", 0, 40000)]),
  );
  const speakerId = analysis.candidates[0]?.id ?? "missing-fixture-candidate";
  const mistake = {
    utteranceId: "b0",
    said: "I **am agree** with you.",
    correct: "I agree with you.",
    whyFa: "فعل agree به am نیاز ندارد.",
    kind: "grammar" as const,
    teacherCorrected: false,
  };
  it("accepts only verbatim eligible speaker evidence and removes repeated suggestions", () => {
    expect(
      validateVoiceCorrections(analysis, {
        candidates: [{ speakerId, mistakes: [mistake, mistake] }],
      })[speakerId],
    ).toEqual([mistake]);
  });
  it("rejects invented text, speaker swaps, unsafe evidence and English-only explanations", () => {
    for (const change of [
      { said: "I went home." },
      { utteranceId: "invented" },
      { whyFa: "Use agree." },
    ])
      expect(() =>
        validateVoiceCorrections(analysis, {
          candidates: [{ speakerId, mistakes: [{ ...mistake, ...change }] }],
        }),
      ).toThrow();
    expect(() =>
      validateVoiceCorrections(analysis, {
        candidates: [{ speakerId: "other", mistakes: [mistake] }],
      }),
    ).toThrow();
    expect(() =>
      validateVoiceCorrections(
        {
          ...analysis,
          utterances: analysis.utterances.map((item) => ({ ...item, eligible: false })),
        },
        { candidates: [{ speakerId, mistakes: [mistake] }] },
      ),
    ).toThrow();
  });
  it("represents valid empty results for every candidate", () => {
    expect(validateVoiceCorrections(analysis, { candidates: [] })).toEqual({ [speakerId]: [] });
  });
  it("withholds repeated grammatical errors copied from reference materials", () => {
    expect(
      validateVoiceCorrections(analysis, { candidates: [{ speakerId, mistakes: [mistake] }] }, [
        "Exercise 1: I am agree with you.",
      ]),
    ).toEqual({ [speakerId]: [] });
  });
});

describe("correction explanation language", () => {
  const prepared = buildVoiceAnalysis(
    base,
    source([
      { start: 1000, end: 8000, text: "I am agree with you.", speaker: "0" },
      { start: 30000, end: 38000, text: "I am agree with you.", speaker: "0" },
    ]),
    diarization([segment("0", 0, 40000)]),
    "es",
  );
  const speakerId = prepared.candidates[0]?.id ?? "missing";
  const mistake = {
    utteranceId: "b0",
    said: "I am agree with you.",
    correct: "I agree with you.",
    whyFa: "El verbo agree no necesita am.",
    kind: "grammar" as const,
    teacherCorrected: false,
  };
  it("keeps English evidence and stamps the requested explanation locale", () => {
    expect(prepared.candidates[0]?.label).toBe("Voice 1");
    expect(
      validateVoiceCorrections(
        prepared,
        { candidates: [{ speakerId, mistakes: [mistake] }] },
        [],
        "es",
      )[speakerId],
    ).toEqual([{ ...mistake, explanationLanguage: "es" }]);
  });
  it.each([
    ["en", "The verb agree does not need am."],
    ["ar", "الفعل agree لا يحتاج إلى am."],
    ["he", "הפועל agree אינו צריך am."],
    ["zh-Hans", "动词 agree 不需要 am。"],
    ["hi", "क्रिया agree के साथ am की जरूरत नहीं है।"],
  ])("accepts the configured %s script without assuming Persian", (language, explanation) => {
    expect(
      validateVoiceCorrections(
        prepared,
        {
          candidates: [{ speakerId, mistakes: [{ ...mistake, whyFa: explanation }] }],
        },
        [],
        language,
      )[speakerId],
    ).toEqual([{ ...mistake, whyFa: explanation, explanationLanguage: language }]);
  });
  it("rejects Persian text for a Spanish explanation and provider-selected locale metadata", () => {
    expect(() =>
      validateVoiceCorrections(
        prepared,
        {
          candidates: [{ speakerId, mistakes: [{ ...mistake, whyFa: "توضیح فارسی" }] }],
        },
        [],
        "es",
      ),
    ).toThrow();
    expect(() =>
      validateVoiceCorrections(
        prepared,
        {
          candidates: [{ speakerId, mistakes: [{ ...mistake, explanationLanguage: "es" }] }],
        },
        [],
        "es",
      ),
    ).toThrow();
  });
});

// FR-VOC-002, FR-VOC-008
describe("acoustic check failure reasons", () => {
  const audio = { ...source(), objectId: "4b0f4d0e-24a8-4d0a-a3c1-bb33a1a7a3d1" };
  it("stores a precise failed reason for unusable audio and native worker outcomes", () => {
    expect(
      voicePreparationFailure(errors.validationFailed({ audio: ["voice_audio_unusable"] }), audio),
    ).toBe("voice_audio_unusable");
    expect(
      voicePreparationFailure(
        errors.validationFailed({ audio: ["voice_audio_windows_refused"] }),
        audio,
      ),
    ).toBe("voice_audio_unusable");
    for (const code of [
      "voice_inference_failed",
      "voice_worker_interrupted",
      "voice_diarization_output_invalid",
      "voice_speech_too_short",
    ])
      expect(voicePreparationFailure(new Error(code), audio)).toBe("voice_inference_failed");
  });
  it("keeps the existing reasons for expiry, integrity, timeouts and unknown failures", () => {
    expect(
      voicePreparationFailure(
        errors.validationFailed({ voice: ["original_audio_unavailable"] }),
        audio,
      ),
    ).toBe("original_audio_unavailable");
    expect(
      voicePreparationFailure(
        errors.validationFailed({ voice: ["source_integrity_mismatch"] }),
        audio,
      ),
    ).toBe("voice_source_integrity_mismatch");
    expect(voicePreparationFailure(new Error("voice_inference_timeout"), audio)).toBe(
      "voice_inference_timeout",
    );
    expect(voicePreparationFailure(new Error("voice_models_not_configured"), audio)).toBe(
      "voice_engine_unavailable",
    );
    expect(voicePreparationFailure(new Error("something native"), audio)).toBe(
      "voice_analysis_failed",
    );
    expect(voicePreparationFailure(new Error("voice_inference_failed"), source())).toBe(
      "original_audio_unavailable",
    );
  });
});

describe("spoken correction failure reasons", () => {
  it("keeps a service spending block apart from a retryable correction failure", () => {
    for (const details of [
      { reason: "cost_limit", scope: "session" },
      { reason: "cost_limit", scope: "systemDay" },
      { reason: "cost_policy_missing" },
      { reason: "processing_paused" },
    ])
      expect(voiceCorrectionFailure(errors.quotaInsufficient(details))).toBe(
        "voice_correction_service_blocked",
      );
    // A learner-unit shortfall and every non-budget failure keep the existing reason.
    for (const error of [
      errors.quotaInsufficient({ required: 1, remaining: 0 }),
      errors.validationFailed({ voice: ["correction_input_too_large"] }),
      errors.conflict(),
      new Error("voice_correction_evidence_invalid"),
    ])
      expect(voiceCorrectionFailure(error)).toBe("voice_correction_unavailable");
  });
});

it("VOICE-AC-10: an over-split recording keeps the voices that matter instead of failing", () => {
  const segments = Array.from({ length: 60 }, (_, index) => ({
    speakerId: `speaker_${index}`,
    startMs: index * 1000,
    endMs: index * 1000 + (index === 59 ? 900 : 500),
    overlap: false,
    boundaryUnsafe: true,
  }));
  const vector = [1, ...Array<number>(15).fill(0)];
  const result = buildVoiceAnalysis(base, source([]), {
    modelRevision: "synthetic",
    segments,
    speakers: [{ speakerId: "speaker_0", embedding: vector, cleanSpeechMs: 25000 }],
  });
  expect(result.candidates).toHaveLength(50);
  // The voice with a voiceprint and the longest fragment are kept; order follows the recording.
  expect(result.embeddings).toHaveLength(1);
  const ids = result.candidates.map((candidate) => candidate.id);
  expect(ids[0]).toBe(scopedVoiceSpeakerId(sourceId, "whole-source", "speaker_0"));
  expect(ids).toContain(scopedVoiceSpeakerId(sourceId, "whole-source", "speaker_59"));
  expect(result.utterances.every((item) => ids.includes(item.speakerId))).toBe(true);
});

it("VOICE-AC-07: a voice with only shorter clean turns still gets timed excerpts", () => {
  const turns = [
    { start: 1000, end: 4500, text: "Short clean answer one.", speaker: "0" },
    { start: 10000, end: 13800, text: "Short clean answer two.", speaker: "0" },
    { start: 20000, end: 21800, text: "Too short.", speaker: "0" },
  ];
  const segments = turns.map((turn) => ({
    speakerId: "speaker_0",
    startMs: turn.start - 500,
    endMs: turn.end + 500,
    overlap: false,
    boundaryUnsafe: false,
  }));
  const result = buildVoiceAnalysis(base, source(turns), {
    modelRevision: "synthetic",
    segments,
    speakers: [],
  });
  expect(result.candidates[0]?.clips.map((clip) => [clip.startMs, clip.endMs])).toEqual([
    [1000, 4500],
    [10000, 13800],
  ]);
});

it("VOICE-AC-07: a voice without a clean transcribed turn is still heard from its own clean speech", () => {
  const result = buildVoiceAnalysis(base, source([]), {
    modelRevision: "synthetic",
    segments: [
      { speakerId: "speaker_0", startMs: 1000, endMs: 6000, overlap: false, boundaryUnsafe: false },
      { speakerId: "speaker_0", startMs: 7000, endMs: 9000, overlap: false, boundaryUnsafe: false },
      {
        speakerId: "speaker_0",
        startMs: 10000,
        endMs: 30000,
        overlap: true,
        boundaryUnsafe: false,
      },
      {
        speakerId: "speaker_1",
        startMs: 12000,
        endMs: 18000,
        overlap: true,
        boundaryUnsafe: false,
      },
      {
        speakerId: "speaker_2",
        startMs: 40000,
        endMs: 50000,
        overlap: false,
        boundaryUnsafe: true,
      },
    ],
    speakers: [],
  });
  // Clean parts of at least three seconds, away from the other voice, without text.
  expect(result.candidates[0]?.clips).toEqual([
    { startMs: 1200, endMs: 5800, text: "" },
    { startMs: 18200, endMs: 28200, text: "" },
  ]);
  // The other voice has no clean part long enough; an edge-clipped turn offers nothing.
  expect(result.candidates[1]?.clips).toEqual([]);
  expect(result.candidates[2]?.clips).toEqual([]);
  // Listening excerpts are not utterances and cannot carry spoken-mistake evidence.
  expect(result.utterances).toEqual([]);
});
