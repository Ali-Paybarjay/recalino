import { describe, expect, it } from "vitest";
import { OpenRouterProvider } from "../../packages/core/src/aip";
import type { Database } from "../../packages/core/src/db";
import {
  correctVoiceCandidates,
  validateVoiceCorrections,
} from "../../packages/core/src/proc/voice-processing";
import { findRepeatedVoiceEvidence, hasRepeatableVoiceEvidence } from "../../packages/core/src/voc";
import {
  assertWithinHardBudget,
  blindOrder,
  classifySuggestion,
  evidenceDiagnostics,
  flattenSuggestions,
  geminiVoiceOverride,
  mergeSuggestionVerdicts,
  percentile,
  voiceEvalCandidates,
  voiceEvalSettings,
  voiceRequestReserveUsd,
  zdrMaximumRates,
} from "./voice-corrections-eval";
import {
  buildVoiceCase,
  occurrences,
  syntheticUuid,
  voiceCorrectionFixtures,
} from "./voice-corrections-fixtures";

const built = voiceCorrectionFixtures.map(buildVoiceCase);
const plain = (text: string) => text.replace(/\s+/g, " ").trim();
const wordBounded = (text: string, phrase: string) =>
  new RegExp(
    `(?<![A-Za-z0-9_])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`,
  ).test(text);

describe("voice correction fixtures", () => {
  it("cover four synthetic classes per explanation language", () => {
    const languages = voiceCorrectionFixtures.map((fixture) => fixture.language);
    for (const language of ["fa", "ar", "es", "ja", "uk"])
      expect(languages.filter((value) => value === language)).toHaveLength(4);
    expect(new Set(voiceCorrectionFixtures.map((fixture) => fixture.id)).size).toBe(20);
    expect(voiceCorrectionFixtures.flatMap((fixture) => fixture.errors)).toHaveLength(65);
    expect(voiceCorrectionFixtures.flatMap((fixture) => fixture.traps)).toHaveLength(65);
  });

  it("send every turn to the model and always make the paid request", () => {
    for (const item of built) {
      expect(item.analysis.utterances.every((utterance) => utterance.eligible)).toBe(true);
      expect(hasRepeatableVoiceEvidence(item.analysis.utterances)).toBe(true);
      const ids = item.analysis.utterances.map((utterance) => utterance.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("let production show every planted error and every false flag on a trap", () => {
    for (const item of built) {
      const marks = [
        ...item.fixture.errors.map((entry) => ({ entry, mark: { e: entry.id } })),
        ...item.fixture.traps.map((entry) => ({ entry, mark: { k: entry.id } })),
      ];
      for (const { entry, mark } of marks) {
        const found = occurrences(item, mark);
        expect(found.length, `${item.fixture.id} ${entry.id}`).toBeGreaterThanOrEqual(2);
        for (const utterance of found) {
          expect(utterance.speaker, `${item.fixture.id} ${entry.id}`).toBe(entry.speaker);
          expect(
            wordBounded(plain(utterance.text), entry.anchor),
            `${item.fixture.id} ${entry.id}`,
          ).toBe(true);
        }
        const first = found[0];
        if (!first) throw new Error("missing occurrence");
        const evidence = findRepeatedVoiceEvidence(
          item.analysis.utterances,
          { utteranceId: first.id, said: entry.anchor, correct: "x y z" },
          first.speakerId,
        );
        expect(evidence, `${item.fixture.id} ${entry.id} needs a repeat 10 s apart`).not.toBeNull();
        expect(
          item.fixture.referenceTexts.some((text) => plain(text).includes(plain(entry.anchor))),
          `${item.fixture.id} ${entry.id} must not be suppressed as read-aloud`,
        ).toBe(false);
      }
      for (const planted of item.fixture.errors)
        for (const key of planted.keys)
          expect(planted.anchor.toLowerCase().split(/\s+/)).toContain(key.toLowerCase());
    }
  });

  it("put read-aloud turns in a handout and keep marks exclusive", () => {
    for (const item of built) {
      for (const utterance of item.utterances) {
        const mark = utterance.mark;
        if (!mark) continue;
        expect(Object.keys(mark)).toHaveLength(1);
        if (mark.d === "read_aloud")
          expect(
            utterance.text
              .split(/(?<=\.)\s+/)
              .some((sentence) =>
                item.fixture.referenceTexts.some((text) => text.includes(sentence)),
              ),
          ).toBe(true);
      }
    }
    const kinds = built.flatMap((item) =>
      item.utterances.flatMap((utterance) => utterance.mark?.d ?? []),
    );
    for (const kind of [
      "read_aloud",
      "teacher_meta",
      "self_correction",
      "injection",
      "asr_homophone",
      "quoted",
      "drill",
      "filler",
    ])
      expect(kinds).toContain(kind);
  });

  it("derive stable production-shaped identifiers", () => {
    expect(syntheticUuid("a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const item = built[0];
    if (!item) throw new Error("missing fixture");
    expect(
      item.analysis.candidates.every((candidate) =>
        /^speaker:[0-9a-f-]{36}:[0-9a-f]{40}$/.test(candidate.id),
      ),
    ).toBe(true);
    expect(buildVoiceCase(item.fixture).analysis).toEqual(item.analysis);
  });
});

describe("voice correction scoring", () => {
  const item = built.find((entry) => entry.fixture.id === "V-FA1");
  if (!item) throw new Error("missing V-FA1");
  const at = (mark: { e?: string; k?: string }) => {
    const found = occurrences(item, mark)[0];
    if (!found) throw new Error("missing occurrence");
    return found;
  };

  it("classifies planted, trap, distractor and other suggestions", () => {
    expect(
      classifySuggestion(item, { utteranceId: at({ e: "E1" }).id, said: "I **am agree**" }),
    ).toEqual({
      type: "planted",
      errorId: "E1",
    });
    expect(
      classifySuggestion(item, { utteranceId: at({ e: "E1" }).id, said: "the trains" }),
    ).toEqual({ type: "other" });
    expect(
      classifySuggestion(item, { utteranceId: at({ k: "K1" }).id, said: "If I were you" }),
    ).toEqual({
      type: "trap",
      trapId: "K1",
    });
    const meta = item.utterances.find((utterance) => utterance.mark?.d === "teacher_meta");
    expect(classifySuggestion(item, { utteranceId: meta?.id ?? "", said: "I am agree" })).toEqual({
      type: "distractor",
      kind: "teacher_meta",
    });
    expect(classifySuggestion(item, { utteranceId: "nope", said: "x" })).toEqual({
      type: "unknown_utterance",
    });
  });

  it("reserves at the most expensive ZDR route and stops before the cap", () => {
    const endpoints = {
      data: [
        { model_id: "m", pricing: { prompt: "0.000001", completion: "0.000005" } },
        {
          model_id: "m",
          pricing: { prompt: "0.000002", completion: "0.000004", internal_reasoning: "0.000006" },
        },
      ],
    };
    const rates = zdrMaximumRates(endpoints, "m");
    expect(rates).toMatchObject({ prompt: 0.000002, output: 0.000006 });
    expect(voiceRequestReserveUsd(rates, "ab", 10)).toBeCloseTo(0.000064);
    expect(() => zdrMaximumRates(endpoints, "other")).toThrow("zdr_endpoint_missing");
    expect(() =>
      assertWithinHardBudget({
        spentUsd: 1,
        uncertainUsd: 0.2,
        inFlightUsd: 0.2,
        reserveUsd: 0.2,
        hardUsd: 1.5,
      }),
    ).toThrow("hard_budget_before_dispatch");
    expect(() =>
      assertWithinHardBudget({
        spentUsd: 1,
        uncertainUsd: 0,
        inFlightUsd: 0.2,
        reserveUsd: 0.2,
        hardUsd: 1.5,
      }),
    ).not.toThrow();
  });

  it("merges blind verdicts conservatively", () => {
    const base = {
      id: "X1",
      genuineLearnerError: true,
      correctionOk: true,
      explanationCorrect: true,
      explanationInRequestedLanguage: true,
      score: 4,
      critical: [] as never[],
      note: "",
    };
    expect(
      mergeSuggestionVerdicts([
        base,
        {
          ...base,
          explanationCorrect: false,
          score: 2,
          critical: ["wrong_explanation"] as never[],
        },
      ]),
    ).toEqual({
      genuineLearnerError: true,
      correctionOk: true,
      explanationCorrect: false,
      explanationInRequestedLanguage: true,
      score: 2,
      critical: ["wrong_explanation"],
      graders: 2,
    });
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(blindOrder("s", "V-FA1")).toEqual(blindOrder("s", "V-FA1"));
  });
});

describe("voice correction request path", () => {
  const item = built.find((entry) => entry.fixture.id === "V-FA1");
  if (!item) throw new Error("missing V-FA1");
  const planted = occurrences(item, { e: "E1" })[0];
  const trapTurn = occurrences(item, { k: "K1" })[0];
  if (!planted || !trapTurn) throw new Error("missing occurrences");
  const answer = {
    candidates: [
      {
        speakerId: planted.speakerId,
        mistakes: [
          {
            utteranceId: planted.id,
            said: "I am agree",
            correct: "I agree",
            whyFa: "agree فعل است و am لازم ندارد.",
            kind: "grammar",
            teacherCorrected: false,
          },
        ],
      },
      {
        speakerId: trapTurn.speakerId,
        mistakes: [
          {
            utteranceId: trapTurn.id,
            said: "If I were you",
            correct: "If I was you",
            whyFa: "این یک تصحیح نادرست آزمایشی است.",
            kind: "grammar",
            teacherCorrected: false,
          },
        ],
      },
    ],
  };
  const noDatabase = new Proxy(
    {},
    {
      get: () => {
        throw new Error("database_access_not_expected");
      },
    },
  ) as Database;

  const dispatch = async (model: string) => {
    const bodies: Record<string, unknown>[] = [];
    const provider = new OpenRouterProvider(
      "test-key",
      voiceEvalSettings(model),
      async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: "r",
            model,
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
          }),
          { status: 200 },
        );
      },
    );
    let output: unknown;
    const corrected = await correctVoiceCandidates({
      db: noDatabase,
      ctx: { userId: syntheticUuid("u"), requestId: syntheticUuid("r") },
      analysis: item.analysis,
      provider,
      now: () => new Date("2026-10-10T00:00:00Z"),
      referenceTexts: item.fixture.referenceTexts,
      explanationLanguage: "fa",
      execute: async (request) => {
        expect(request.model).toBe(model);
        const result = await request.effect("op");
        output = result.output;
        return request.schema.parse(result.output);
      },
    });
    return { bodies, corrected, output };
  };

  it("sends Haiku the production controls and Gemini its declared override", async () => {
    const haiku = await dispatch("anthropic/claude-haiku-4.5");
    expect(haiku.corrected).toBe(true);
    expect(haiku.bodies).toHaveLength(1);
    expect(haiku.bodies[0]).toMatchObject({
      model: "anthropic/claude-haiku-4.5",
      max_tokens: 6144,
      temperature: 0,
    });
    expect(haiku.bodies[0]).not.toHaveProperty("reasoning");

    const gemini = await dispatch("google/gemini-3.8-flash");
    expect(gemini.bodies).toHaveLength(1);
    const body = gemini.bodies[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "google/gemini-3.8-flash",
      max_tokens: geminiVoiceOverride.maxOutputTokens,
      reasoning: { effort: "medium" },
      provider: { zdr: true, data_collection: "deny", require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: { name: "spoken_mistake_candidates", strict: true },
      },
    });
    expect(body).not.toHaveProperty("temperature");
    const schema = JSON.stringify(
      (body.response_format as { json_schema: { schema: unknown } }).json_schema.schema,
    );
    for (const dropped of ["maxItems", "minLength", "maxLength", "pattern", "$schema", "const"])
      expect(schema).not.toContain(`"${dropped}"`);
    // Identical prompt and transcript input for both models.
    const messages = (value: Record<string, unknown> | undefined) =>
      JSON.stringify(value?.messages);
    expect(messages(gemini.bodies[0])).toBe(messages(haiku.bodies[0]));
  });

  it("scores the production-visible suggestions", () => {
    const shown = validateVoiceCorrections(
      item.analysis,
      answer,
      item.fixture.referenceTexts,
      "fa",
    );
    const visible = Object.values(shown).flat();
    expect(visible).toHaveLength(2);
    expect(
      flattenSuggestions(answer).map((suggestion) => classifySuggestion(item, suggestion).type),
    ).toEqual(["planted", "trap"]);
    const broken = structuredClone(answer);
    const first = broken.candidates[0]?.mistakes[0];
    if (!first) throw new Error("missing mistake");
    first.said = "I am  Agree";
    first.whyFa = "In English, agree is a verb.";
    expect(() => validateVoiceCorrections(item.analysis, broken, [], "fa")).toThrow();
    expect(evidenceDiagnostics(item, broken, "fa").sort()).toEqual([
      "explanation_script",
      "said_not_verbatim",
    ]);
  });

  it("evaluates exactly the two declared candidates", () => {
    expect(voiceEvalCandidates.map((candidate) => candidate.model)).toEqual([
      "anthropic/claude-haiku-4.5",
      "google/gemini-3.8-flash",
    ]);
    expect(voiceEvalSettings("x").voiceCorrectionModel).toBe("x");
  });
});
