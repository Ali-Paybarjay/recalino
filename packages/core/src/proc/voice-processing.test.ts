import { afterEach, describe, expect, it, vi } from "vitest";
import {
  effectiveVoiceCorrectionModel,
  maximumProviderCost,
  OpenRouterProvider,
  type ProviderSettings,
  providerSettingsSchema,
} from "../aip";
import { errors } from "../plt";
import type { PrivateVoiceAnalysis } from "../voc";
import type { RunSource } from "./contracts";
import {
  alignVoiceUtterances,
  buildTranscriptVoiceAnalysis,
  buildVoiceAnalysis,
  correctVoiceCandidates,
  scopedVoiceSpeakerId,
  type VoiceCorrectionExecutor,
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
    expect(result.candidates[0]?.clips).toEqual([]);
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
  it("FR-ACC-005 rejects the whole correction batch when an Arabic explanation is Persian prose", () => {
    const arabic = { ...mistake, whyFa: "الفعل agree لا يحتاج إلى am." };
    const persian = { ...mistake, whyFa: "فعل agree به am نیاز ندارد." };
    expect(() =>
      validateVoiceCorrections(
        prepared,
        { candidates: [{ speakerId, mistakes: [arabic, persian] }] },
        [],
        "ar",
      ),
    ).toThrow(
      expect.objectContaining({ details: { fields: { voice: ["mistake_evidence_invalid"] } } }),
    );
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

describe("FR-VOC-008 spoken corrections use their own provider model", () => {
  const gemini = "google/gemini-3.8-flash";
  const haiku = "anthropic/claude-haiku-4.5";
  // Synthetic settings shaped like the release config: a slower text model with its own
  // overrides and a separate correction model with none.
  const release: ProviderSettings = {
    version: "synthetic-voice-model",
    llmModel: gemini,
    voiceCorrectionModel: haiku,
    visionModel: haiku,
    sttModel: "synthetic/stt",
    ttsModel: "synthetic/tts",
    voice: "synthetic",
    promptVersion: "synthetic",
    structuredTemperature: 0,
    structuredModelOverrides: {
      [gemini]: {
        maxOutputTokens: 32000,
        reasoningEffort: "medium",
        maxRequestBytes: 400000,
        structuredOutputMode: "json_schema",
        omitTemperature: true,
        knowledgeContract: "content",
        timeoutMs: 180000,
      },
    },
    maxInputCharacters: 120000,
    maxOutputTokens: 6144,
    timeoutMs: 90000,
    maximumMicros: 760000,
    modelMaximumMicros: { [gemini]: 760000, [haiku]: 300000 },
    currency: "USD",
    priceVersion: "synthetic",
    charactersPerPage: 3000,
    audioUrlSupported: false,
    sttProviderOptions: {},
    dataContractApproved: true,
  };
  const prepared = buildVoiceAnalysis(
    base,
    source([
      { start: 1000, end: 8000, text: "I am agree with you.", speaker: "0" },
      { start: 30000, end: 38000, text: "I am agree with you.", speaker: "0" },
    ]),
    diarization([segment("0", 0, 40000)]),
  );
  const analysis: PrivateVoiceAnalysis = {
    id: "5b0b44f4-5d7e-4f39-9d55-2b8e0b9e1d0a",
    version: 1,
    sourceId,
    sourceVersionId,
    runId: base.runId,
    profileVersion: base.profileVersion,
    modelVersion: prepared.modelVersion,
    status: "unverified",
    candidateId: null,
    reason: null,
    candidates: prepared.candidates,
    utterances: prepared.utterances,
    mistakes: {},
  };
  async function correct(settings: ProviderSettings) {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: effectiveVoiceCorrectionModel(settings),
          choices: [{ finish_reason: "stop", message: { content: '{"candidates":[]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00001 },
        }),
      ),
    );
    const dispatched: Parameters<VoiceCorrectionExecutor>[0][] = [];
    const execute: VoiceCorrectionExecutor = async (input) => {
      dispatched.push(input);
      return (await input.effect(`${analysis.runId}:${input.step}:1`)).output;
    };
    const corrected = await correctVoiceCandidates({
      db: undefined as never,
      ctx: { userId: "0f7a1d2e-0c39-4a8e-9d7c-6a9b9f3c2e11", requestId: "synthetic" },
      analysis,
      provider: new OpenRouterProvider("synthetic-key", settings, request),
      execute,
      now: () => new Date("2026-10-10T00:00:00Z"),
    });
    return {
      corrected,
      dispatched,
      body: JSON.parse(String(request.mock.calls[0]?.[1]?.body)),
    };
  }
  afterEach(() => vi.restoreAllMocks());

  it("dispatches, holds and samples with the correction model's settings, not the text model's", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { corrected, dispatched, body } = await correct(release);
    expect(corrected).toBe(true);
    expect(dispatched).toHaveLength(1);
    // The executor records the attempt and the cost hold against this model.
    expect(dispatched[0]?.model).toBe(haiku);
    expect(dispatched[0]?.step).toBe(`voice:corrections:${analysis.id}`);
    expect(maximumProviderCost(release, dispatched[0]?.model ?? "")).toBe(300000);
    expect(body.model).toBe(haiku);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(6144);
    expect(body).not.toHaveProperty("reasoning");
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "spoken_mistake_candidates", strict: true },
    });
    expect(timeout).toHaveBeenLastCalledWith(90000);
  });

  it("keeps every snapshot without the field on llmModel exactly as before", async () => {
    const { voiceCorrectionModel: _voice, ...legacy } = release;
    expect(providerSettingsSchema.parse(legacy)).not.toHaveProperty("voiceCorrectionModel");
    expect(effectiveVoiceCorrectionModel(legacy)).toBe(gemini);
    const { dispatched, body } = await correct({ ...legacy, llmModel: haiku });
    expect(dispatched[0]?.model).toBe(haiku);
    expect(body.model).toBe(haiku);
    expect(body.temperature).toBe(0);
    expect(providerSettingsSchema.safeParse({ ...release, voiceCorrectionModel: "" }).success).toBe(
      false,
    );
  });
});
