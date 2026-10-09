// biome-ignore-all lint/style/noNonNullAssertion: These fixtures assert known populated positions.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProviderError, structuredTransportSchema } from "../aip";
import type { RunSource } from "./contracts";
import { buildKnowledgeRepairInput } from "./knowledge-repair";
import { buildKnowledgeTranslationInput } from "./knowledge-translation";

function claim(id: string, text: string, evidenceKey: string | null = "r0") {
  return { id, text, evidenceKey, uncertain: false };
}
function rawRepair() {
  return {
    schemaVersion: "1" as const,
    title: "Class topic",
    language: { learning: "en" as const, explanation: "fa" },
    summary: [claim("summary", "The form describes a past habit.")],
    topics: [
      {
        id: "topic",
        title: "Past habits",
        claims: [claim("topic-claim", 'Use "used to" for past habits.')],
      },
    ],
    learningItems: [
      {
        id: "item",
        kind: "expression" as const,
        front: "used to",
        back: "این عبارت عادت در گذشته را بیان می‌کند.",
        claim: claim("learning", "The phrase used to describes a past habit."),
      },
    ],
    homework: [claim("homework", "Practice the past-habit phrase.")],
    uncertainties: [claim("uncertainty", "This explanation remains uncertain.", null)],
    coverage: { complete: false, missingSourceIds: [randomUUID()] },
  };
}
function response(input: string) {
  const encoded = JSON.parse(input) as {
    language: string;
    targets: { key: string; protectedEnglish: string[] }[];
  };
  return {
    language: encoded.language,
    translations: encoded.targets.map((target) => ({
      key: target.key,
      text: `این توضیح فارسی است.${target.protectedEnglish.map((fragment) => ` «${fragment}»`).join("")}`,
    })),
  };
}

describe("bounded canonical explanation translation", () => {
  it("AC-D46-05 forwards declared context without regenerating personalised examples or metadata", () => {
    const raw = rawRepair();
    const learnerContext = {
      version: 1 as const,
      declaredLevel: "C1" as const,
      goal: "ielts" as const,
    };
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000, learnerContext);
    expect(JSON.parse(prepared.input).learnerContext).toEqual(learnerContext);
    expect(prepared.system).toContain("Preserve the existing personalised teaching intent");
    expect(prepared.system).toContain("never regenerate, simplify or expand");
    const translated = prepared.apply(response(prepared.input));
    expect(translated.learningItems[0]?.front).toBe(raw.learningItems[0]?.front);
    expect(translated.learningItems[0]?.back).toBe(raw.learningItems[0]?.back);
    expect(translated.coverage).toEqual(raw.coverage);
    expect(translated).not.toHaveProperty("learnerContext");
  });
  it("translates only the exact selected texts and preserves every ID, key, front and other metadata byte-for-byte", () => {
    const raw = rawRepair();
    const before = JSON.stringify(raw);
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000);
    const encoded = JSON.parse(prepared.input);
    expect(encoded.targets.map((target: { section: string }) => target.section)).toEqual([
      "summary",
      "topic",
      "learningClaim",
      "homework",
      "uncertainty",
    ]);
    expect(encoded.targets.map((target: { text: string }) => target.text)).toEqual([
      raw.summary[0]!.text,
      raw.topics[0]!.claims[0]!.text,
      raw.learningItems[0]!.claim.text,
      raw.homework[0]!.text,
      raw.uncertainties[0]!.text,
    ]);
    const translated = response(prepared.input);
    translated.translations.reverse();
    const result = prepared.apply(translated);
    expect(result).not.toBe(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(result.learningItems[0]!.front).toBe(raw.learningItems[0]!.front);
    expect(result.learningItems[0]!.back).toBe(raw.learningItems[0]!.back);
    const expected = structuredClone(raw);
    const values = new Map(translated.translations.map((item) => [item.key, item.text]));
    expected.summary[0]!.text = values.get("t0")!;
    expected.topics[0]!.claims[0]!.text = values.get("t1")!;
    expected.learningItems[0]!.claim.text = values.get("t2")!;
    expected.homework[0]!.text = values.get("t4")!;
    expected.uncertainties[0]!.text = values.get("t5")!;
    expect(JSON.stringify(result)).toBe(JSON.stringify(expected));
    expect(result.topics[0]!.claims[0]!.text).toContain("used to");
    expect(result.learningItems[0]!.claim.text).toContain("used to");
  });

  it("AC-D46-04 never translates the English words that a grammar IPA transcribes", () => {
    const raw = rawRepair();
    const persian = "این ساختار برای پرسیدن دربارهٔ عادت است.";
    const study = {
      set: "production" as const,
      kind: "grammar" as const,
      en: "present simple questions",
      faMeaning: persian,
      topic: "questions",
      ipa: "/dʌz ʃi wɔːk/",
      ipaText: "Does she walk",
      faApprox: "داز شی واک",
      fullSentence: "Does she walk to school every day?",
      collocations: [],
      noteFa: "The auxiliary comes before the subject.",
      imageFa: persian,
      sourceFa: persian,
      taskFa: persian,
      prompt: "She walks to school every day.",
    };
    const withStudy = { ...raw, learningItems: [{ ...raw.learningItems[0]!, study }] };
    const prepared = buildKnowledgeTranslationInput(withStudy, "fa", 120000);
    const targets = JSON.parse(prepared.input).targets as { section: string; text: string }[];
    expect(targets.filter((target) => target.section === "study")).toEqual([
      expect.objectContaining({ text: study.noteFa }),
    ]);
    const result = prepared.apply(response(prepared.input));
    expect(result.learningItems[0]?.study).toMatchObject({
      ipa: study.ipa,
      ipaText: study.ipaText,
      noteFa: "این توضیح فارسی است.",
    });
  });

  it("targets a Latin-only back while retaining already Persian claims and English quoted examples", () => {
    const raw = rawRepair();
    raw.summary[0]!.text = "این توضیح فارسی است و واژهٔ English را نگه می‌دارد.";
    raw.learningItems[0]!.claim.text = "عبارت used to کاربرد آموزشی دارد.";
    raw.learningItems[0]!.front = "I used to walk. 😀";
    raw.learningItems[0]!.back = "The example “I used to walk. 😀” describes a habit.";
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000);
    const targets = JSON.parse(prepared.input).targets;
    expect(targets.some((target: { key: string }) => target.key === "t0")).toBe(false);
    expect(targets.some((target: { key: string }) => target.key === "t2")).toBe(false);
    expect(targets.find((target: { key: string }) => target.key === "t3")).toMatchObject({
      section: "learningBack",
      englishFront: "I used to walk. 😀",
      protectedEnglish: ["I used to walk. 😀"],
    });
    const result = prepared.apply(response(prepared.input));
    expect(result.summary[0]!.text).toBe(raw.summary[0]!.text);
    expect(result.learningItems[0]!.claim.text).toBe(raw.learningItems[0]!.claim.text);
    expect(result.learningItems[0]!.front).toBe(raw.learningItems[0]!.front);
    expect(result.learningItems[0]!.back).toContain(raw.learningItems[0]!.front);
  });

  it("rejects missing, extra, invented, duplicate or case-changed keys and wrong literal language", () => {
    const prepared = buildKnowledgeTranslationInput(rawRepair(), "fa", 120000);
    const valid = response(prepared.input);
    expect(() => prepared.apply({ ...valid, translations: valid.translations.slice(1) })).toThrow();
    expect(() =>
      prepared.apply({ ...valid, translations: [...valid.translations, valid.translations[0]] }),
    ).toThrow();
    const invented = structuredClone(valid);
    invented.translations[0]!.key = "t999";
    expect(() => prepared.apply(invented)).toThrow();
    const duplicate = structuredClone(valid);
    duplicate.translations[1]!.key = duplicate.translations[0]!.key;
    expect(() => prepared.apply(duplicate)).toThrow();
    const casing = structuredClone(valid);
    casing.translations[0]!.key = "T0";
    expect(() => prepared.apply(casing)).toThrow();
    expect(() => prepared.apply({ ...valid, language: "فارسی" })).toThrow();
    expect(() => prepared.apply({ ...valid, title: "New notes" })).toThrow();
    const metadata = structuredClone(valid);
    expect(() =>
      prepared.apply({
        ...metadata,
        translations: metadata.translations.map((item) => ({ ...item, evidenceKey: "r5" })),
      }),
    ).toThrow();
  });

  it("rejects Latin-only translations and omitted protected English, preserving the original on every failure", () => {
    const raw = rawRepair();
    const before = JSON.stringify(raw);
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000);
    const english = response(prepared.input);
    english.translations[0]!.text = "Still in English";
    expect(() => prepared.apply(english)).toThrow();
    const missingQuote = response(prepared.input);
    missingQuote.translations[1]!.text = "این توضیح فارسی است.";
    expect(() => prepared.apply(missingQuote)).toThrow();
    const missingFront = response(prepared.input);
    missingFront.translations[2]!.text = "این توضیح فارسی است.";
    expect(() => prepared.apply(missingFront)).toThrow();
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("recognizes exact English quotations without treating contraction apostrophes as quoted fragments", () => {
    const raw = rawRepair();
    raw.summary[0]!.text =
      `Don't change 'used to', “would often”, ‘past habit’, \`I used to walk\`, or "didn't".`;
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000);
    const first = JSON.parse(prepared.input).targets[0];
    expect(first.protectedEnglish).toEqual([
      "used to",
      "would often",
      "past habit",
      "I used to walk",
      "didn't",
    ]);
    expect(prepared.apply(response(prepared.input)).summary[0]!.text).toContain("didn't");
  });

  it("takes an immutable snapshot and cannot redirect a translation by later caller mutations", () => {
    const raw = rawRepair();
    const expected = structuredClone(raw);
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000);
    raw.summary[0]!.evidenceKey = "invented";
    raw.learningItems[0]!.front = "Changed front";
    const result = prepared.apply(response(prepared.input));
    expect(result.summary[0]!.evidenceKey).toBe(expected.summary[0]!.evidenceKey);
    expect(result.learningItems[0]!.front).toBe(expected.learningItems[0]!.front);
  });

  it("retains already Persian content completely unchanged without manufacturing translation targets", () => {
    const raw = rawRepair();
    raw.summary[0]!.text = "این خلاصه فارسی است.";
    raw.topics[0]!.claims[0]!.text = "این توضیح موضوع فارسی است.";
    raw.learningItems[0]!.claim.text = "این توضیح کارت فارسی است.";
    raw.homework[0]!.text = "این تکلیف فارسی است.";
    raw.uncertainties[0]!.text = "این بخش نامطمئن فارسی است.";
    const before = JSON.stringify(raw);
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000);
    expect(JSON.parse(prepared.input).targets).toEqual([]);
    expect(JSON.stringify(prepared.apply({ language: "fa", translations: [] }))).toBe(before);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("counts complete Unicode input against the unchanged bound before a request and never truncates", () => {
    const raw = rawRepair();
    raw.summary[0]!.text += " 😀".repeat(500);
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000);
    const bound = Array.from(prepared.input).length;
    expect(prepared.input.length).toBeGreaterThan(bound);
    expect(buildKnowledgeTranslationInput(raw, "fa", bound).input).toBe(prepared.input);
    const before = JSON.stringify(raw);
    expect(() => buildKnowledgeTranslationInput(raw, "fa", bound - 1)).toThrow(ProviderError);
    raw.summary[0]!.text = "Complete selected explanatory words ".repeat(5000);
    expect(() => buildKnowledgeTranslationInput(raw, "fa", 120000)).toThrow(ProviderError);
    expect(before).toContain("😀");
    expect(raw.summary[0]!.text.endsWith("words ")).toBe(true);
  });

  it("returns canonical repair transport that passes exact evidence and final language validation", () => {
    const selected: RunSource = {
      sourceId: randomUUID(),
      contentVersionId: randomUUID(),
      objectId: randomUUID(),
      sha256: "a".repeat(64),
      kind: "audio",
      mimeType: "audio/mp4",
      role: "class_audio",
      durationMs: 10000,
      pageCount: null,
      ranges: [],
      captureAnchor: null,
      units: [{ id: "native", kind: "time", start: 1234, end: 5678, status: "extracted" }],
      blocks: [
        {
          id: "native-text",
          unitId: "native",
          kind: "transcript",
          text: "A complete original utterance.",
        },
      ],
    };
    const repair = buildKnowledgeRepairInput(
      {
        sources: [selected],
        explanationLanguage: "fa",
        teachingPreferences: { shorterExamples: false },
        missingSourceIds: [],
      },
      120000,
    );
    const raw = rawRepair();
    raw.coverage = { complete: true, missingSourceIds: [] };
    expect(() => repair.decode(raw)).toThrow();
    const prepared = buildKnowledgeTranslationInput(raw, "fa", 120000);
    const final = repair.decode(prepared.apply(response(prepared.input)));
    expect(final.summary[0]!.sourceRefs[0]!.locator).toEqual({
      kind: "time",
      startMs: 1234,
      endMs: 5678,
    });
    expect(final.summary[0]!.creation).toBe("ai_generation");
    expect(final.summary[0]!.speakerRole).toBe("unknown");
    expect(final.learningItems[0]!.front).toBe(raw.learningItems[0]!.front);
    expect(final.uncertainties[0]!.origin).toBe("ai_expansion");
    const transport = structuredTransportSchema(prepared.schema, "anthropic/claude-haiku-4.5");
    expect(JSON.stringify(transport).length).toBeLessThan(3000);
    expect(prepared.system).toContain("not class-note generation");
    // The tag alone does not tell every model which language it is.
    expect(prepared.system).toContain('into the requested language "fa" (Persian)');
    expect(prepared.system).toContain('language exactly "fa"');
    expect(prepared.system).toContain("untrusted DATA");
  });

  it("refuses translated language labels, mismatched selected language and a changed canonical learning language", () => {
    expect(() => buildKnowledgeTranslationInput(rawRepair(), "en", 120000)).toThrow();
    const wrong = rawRepair();
    wrong.language.explanation = "فارسی";
    expect(() => buildKnowledgeTranslationInput(wrong, "fa", 120000)).toThrow();
    const wrongLearning = { ...rawRepair(), language: { learning: "fa", explanation: "fa" } };
    expect(() => buildKnowledgeTranslationInput(wrongLearning, "fa", 120000)).toThrow();
    const locale = rawRepair();
    locale.language.explanation = "fa-IR";
    const prepared = buildKnowledgeTranslationInput(locale, "fa-IR", 120000);
    expect(prepared.apply(response(prepared.input)).language.explanation).toBe("fa-IR");
  });
});

it.each([
  ["es", "Una explicación clara"],
  ["ar", "شرح واضح"],
  ["he", "הסבר ברור"],
  ["ru", "Понятное объяснение"],
  ["hi", "स्पष्ट व्याख्या"],
  ["zh-Hans", "清晰的解释"],
  ["ja", "明確な説明です"],
  ["en", "A clear explanation"],
])(
  "repairs the exact %s explanation script without changing evidence or English examples",
  (language, prose) => {
    const raw = rawRepair();
    raw.language.explanation = language;
    const wrong = language === "en" || language === "es" ? "متن فارسی" : "An English explanation";
    raw.summary[0]!.text = wrong;
    raw.topics[0]!.claims[0]!.text = wrong;
    raw.learningItems[0]!.claim.text = `${wrong} "used to"`;
    raw.learningItems[0]!.back = wrong;
    raw.homework[0]!.text = wrong;
    raw.uncertainties[0]!.text = wrong;
    const prepared = buildKnowledgeTranslationInput(raw, language, 120000);
    const targets = JSON.parse(prepared.input).targets as {
      key: string;
      protectedEnglish: string[];
    }[];
    expect(targets).toHaveLength(6);
    const result = prepared.apply({
      language,
      translations: targets.map((target) => ({
        key: target.key,
        text: prose + target.protectedEnglish.map((text) => ` "${text}"`).join(""),
      })),
    });
    expect(result.language.explanation).toBe(language);
    expect(result.learningItems[0]!.front).toBe("used to");
    expect(result.learningItems[0]!.claim.text).toContain("used to");
    expect(result.summary[0]!.evidenceKey).toBe("r0");
    expect(raw.summary[0]!.text).toBe(wrong);
  },
);
