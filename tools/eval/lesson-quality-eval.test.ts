import { describe, expect, it } from "vitest";
import defaults from "../../config/openrouter-defaults.json";
import type {
  AiProvider,
  ProviderResult,
  ProviderSettings,
  StructuredInput,
  Transcript,
} from "../../packages/core/src/aip";
import {
  BudgetGuard,
  BudgetStop,
  generateArmLesson,
  lessonMetrics,
  lessonQualityArms,
  worstCaseMicros,
} from "./lesson-quality-eval";
import { lessonQualityCases } from "./lesson-quality-fixtures";

const words: [string, string][] = [
  ["neighbour", "/ˈneɪbə/"],
  ["kettle", "/ˈketl/"],
  ["umbrella", "/ʌmˈbrelə/"],
  ["ticket", "/ˈtɪkɪt/"],
  ["garden", "/ˈɡɑːdn/"],
  ["library", "/ˈlaɪbrəri/"],
  ["blanket", "/ˈblæŋkɪt/"],
  ["pencil", "/ˈpensl/"],
  ["window", "/ˈwɪndəʊ/"],
  ["bottle", "/ˈbɒtl/"],
  ["jacket", "/ˈdʒækɪt/"],
  ["carpet", "/ˈkɑːpɪt/"],
  ["mirror", "/ˈmɪrə/"],
  ["basket", "/ˈbɑːskɪt/"],
  ["pillow", "/ˈpɪləʊ/"],
  ["ladder", "/ˈlædə/"],
  ["candle", "/ˈkændl/"],
  ["wallet", "/ˈwɒlɪt/"],
];

/** Offline only: a deterministic lesson sized by the prompt's own limit; no network. */
class SyntheticLessonProvider implements AiProvider {
  readonly name = "synthetic";
  readonly mode = "mock";
  calls = 0;
  constructor(readonly settings: ProviderSettings) {}
  async structured<T>(input: StructuredInput<T>): Promise<ProviderResult<T>> {
    this.calls += 1;
    const limit = Number(input.system.match(/Select at most (\d+) complete production items/)?.[1]);
    const data = JSON.parse(input.input) as {
      sources: { sourceKey?: string; evidence: [string | null, ...unknown[]][] }[];
    };
    const sources = data.sources.map((source) => {
      const rows = source.evidence.filter(([key]) => key !== null);
      return {
        handle: source.sourceKey,
        keys: rows.map(([key]) => key as string),
        offTopic: JSON.stringify(rows[0]).includes("Canteen"),
      };
    });
    const teaching = sources.filter((source) => !source.offTopic && source.keys.length);
    const keys = teaching.flatMap((source) => source.keys);
    const count = Math.min(limit, words.length, keys.length);
    const item = (index: number) => {
      // Each request starts at another word, as two parts of a class teach different points.
      const [word, ipa] = words[(index + (this.calls - 1) * 9) % words.length] ?? [
        "neighbour",
        "/ˈneɪbə/",
      ];
      return {
        type: "lexical",
        kind: "vocabulary",
        claim: {
          text: "این واژه در کلاس آموزش داده شد.",
          evidenceKeys: [keys[Math.floor((index * keys.length) / count)] ?? "r0"],
          uncertain: false,
        },
        meaning: { en: word, faMeaning: "یک واژهٔ روزمره", topic: "everyday" },
        pronunciation: { ipa, faApprox: "واژه" },
        practice: {
          fullSentence: `I saw the ${word} yesterday.`,
          gapSentence: "I saw the ______ yesterday.",
        },
        teaching: { noteFa: "این واژه روزمره است.", imageFa: "تصویری ساده از این چیز." },
      };
    };
    const items = Array.from({ length: count }, (_, index) => item(index));
    const output = {
      lessonPlan: [
        ...items.map((entry, index) => ({
          concept: `item ${index}`,
          evidenceKeys: entry.claim.evidenceKeys,
          teachAs: "card",
        })),
        ...teaching.map((source, index) => ({
          concept: `source ${index}`,
          evidenceKeys: [source.keys[0]],
          teachAs: "notes",
        })),
      ],
      ...(input.system.includes("Account for EVERY source")
        ? {
            unusedSources: sources
              .filter((source) => source.offTopic)
              .map((source) => ({ source: source.handle, reason: "off_topic" })),
          }
        : {}),
      title: "Synthetic lesson",
      learningItems: items,
      classNotes: { coverage: "یک درس مصنوعی." },
    };
    return {
      output: input.schema.parse(output),
      requestId: `synthetic-${this.calls}`,
      model: input.model,
      provider: this.name,
      actualMicros: 20_000,
      usage: { inputTokens: 1000, outputTokens: 500 + 900 * count },
    };
  }
  async transcribe(): Promise<ProviderResult<Transcript>> {
    throw new Error("offline");
  }
  async speech(): Promise<ProviderResult<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>> {
    throw new Error("offline");
  }
}

const arms = lessonQualityArms(defaults);
const withParts: ProviderSettings = {
  ...arms.candidate,
  lessonQuality: { ...(arms.candidate.lessonQuality ?? ({} as never)), classPartMinutes: 90 },
};
const cases = Object.fromEntries(lessonQualityCases().map((entry) => [entry.id, entry.data]));

describe("D62/D63 offline lesson-quality evaluation (synthetic provider and fixtures only)", () => {
  it("rebuilds the D56 production settings exactly beside the candidate", () => {
    expect(arms.production.version).toBe("openrouter-2026-10-10-1");
    expect(arms.production.promptVersion).toBe("recalino-knowledge-10");
    expect(arms.production.lessonQuality).toBeUndefined();
    expect(arms.candidate.promptVersion).toBe("recalino-knowledge-11");
  });

  it("scales a 128-minute class with board photos and teaches it in two parts", async () => {
    const data = cases["LQ-LONG-128"];
    if (!data) throw new Error("fixture");
    const guard = new BudgetGuard(10_000_000);
    const production = await generateArmLesson(
      new SyntheticLessonProvider(arms.production),
      data,
      guard,
      "offline:production",
    );
    const candidate = await generateArmLesson(
      new SyntheticLessonProvider(withParts),
      data,
      guard,
      "offline:candidate",
    );
    expect(production).toMatchObject({ valid: true, firstTry: true, parts: 1 });
    expect(candidate).toMatchObject({ valid: true, firstTry: true, parts: 2 });
    if (!production.model || !candidate.model) throw new Error("expected lessons");
    const before = lessonMetrics(production.model, data.sources);
    const after = lessonMetrics(candidate.model, data.sources);
    // The legacy 6144 plan allows 4 production items whatever the class length.
    expect(before.production).toBe(4);
    expect(after.production).toBe(18);
    expect(after.itemsPerSpeechHour).toBeGreaterThan(before.itemsPerSpeechHour ?? 0);
    expect(after.sourceCoveragePercent).toBe(100);
    expect(candidate.outputTokens).toBeGreaterThan(production.outputTokens);
    expect(guard.calls).toBe(3);
  });

  it("accounts for every board photo and sets an unrelated photo aside with its reason", async () => {
    const data = cases["LQ-BOARD-15"];
    if (!data) throw new Error("fixture");
    const result = await generateArmLesson(
      new SyntheticLessonProvider(arms.candidate),
      data,
      new BudgetGuard(10_000_000),
      "offline:board",
    );
    if (!result.model) throw new Error(result.error);
    expect(result.model.coverage.sources?.at(-1)).toMatchObject({
      status: "not_used",
      reason: "off_topic",
    });
    expect(lessonMetrics(result.model, data.sources).sourceCoveragePercent).toBe(75);
  });

  it("stops before a call that could pass the hard cap and counts unknown cost as worst case", async () => {
    const data = cases["LQ-BOARD-15"];
    if (!data) throw new Error("fixture");
    const provider = new SyntheticLessonProvider(arms.candidate);
    const guard = new BudgetGuard(1_500_000);
    guard.record(null, 1_400_000);
    await expect(generateArmLesson(provider, data, guard, "offline:cap")).rejects.toBeInstanceOf(
      BudgetStop,
    );
    expect(provider.calls).toBe(0);
    // 32,000 output tokens at the highest captured price dominate the worst case.
    expect(worstCaseMicros(arms.candidate, 0)).toBe(216_000);
  });
});
