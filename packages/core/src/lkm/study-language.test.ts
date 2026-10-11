import { describe, expect, it } from "vitest";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { FIRST_LANGUAGES } from "../acc";
import { isExplanationLanguage, matchesExplanationScript, validateKnowledgeModel } from "./schema";
import {
  explanationStudyFields,
  normalizeGeneratedStudyModel,
  visibleMistakePatterns,
} from "./study-policy";

const samples: Record<string, string> = {
  Latn: "A natural explanation",
  Cyrl: "Понятное объяснение",
  Arab: "توضیح روشن",
  Deva: "स्पष्ट व्याख्या",
  Beng: "স্পষ্ট ব্যাখ্যা",
  Grek: "Καθαρή εξήγηση",
  Armn: "Պարզ բացատրություն",
  Geor: "ნათელი ახსნა",
  Hebr: "הסבר ברור",
  Ethi: "ግልጽ ማብራሪያ",
  Tibt: "གསལ་བཤད",
  Gujr: "સ્પષ્ટ સમજૂતી",
  Thaa: "ވިސްނުން",
  Guru: "ਸਪੱਸ਼ਟ ਵਿਆਖਿਆ",
  Taml: "தெளிவான விளக்கம்",
  Telu: "స్పష్టమైన వివరణ",
  Knda: "ಸ್ಪಷ್ಟ ವಿವರಣೆ",
  Mlym: "വ്യക്തമായ വിശദീകരണം",
  Sinh: "පැහැදිලි විස්තරය",
  Thai: "คำอธิบายที่ชัดเจน",
  Laoo: "ຄໍາອະທິບາຍ",
  Mymr: "ရှင်းလင်းချက်",
  Khmr: "ការពន្យល់",
  Orya: "ସ୍ପଷ୍ଟ ବ୍ୟାଖ୍ୟା",
  Hans: "清晰的解释",
  Hant: "清楚的解釋",
  Jpan: "明確な説明です",
  Kore: "명확한 설명",
  Cans: "ᐃᓄᒃᑎᑐᑦ",
  Yiii: "ꆈꌠꉙ",
};
// Languages whose script sample would be another language's spelling (Persian for Arabic).
const languageSamples: Record<string, string> = { ar: "شرح واضح" };
function explanationFor(language: string) {
  const locale = new Intl.Locale(language);
  const script = locale.maximize().script ?? "";
  const value = languageSamples[locale.language] ?? samples[script];
  if (!value) throw new Error(`Missing writing-system fixture for ${language}: ${script}`);
  return value;
}
function rich(language: string) {
  const model = referenceStudyModel();
  model.language.explanation = language;
  model.learningItems = model.learningItems.slice(0, 1);
  const item = model.learningItems[0];
  if (!item) throw new Error("fixture");
  if (item.study?.set !== "production") throw new Error("fixture");
  const text = explanationFor(language);
  Object.assign(item.study, { faMeaning: text, noteFa: text, imageFa: text, sourceFa: text });
  delete item.study.trap;
  if (language !== "fa") delete item.study.faApprox;
  item.claim.text = text;
  model.classNotes = {
    date: "2026-10-07",
    coverage: "Class lesson",
    sourceNote: text,
    coreIntro: text,
    chunks: [{ pattern: "wear and tear", classSentence: item.study.fullSentence, noteFa: text }],
    board: [],
    tasks: [
      {
        title: "Practice",
        blocks: [
          { type: "text", textFa: text },
          {
            type: "items",
            items: [{ prompt: "Try this", model: "A British example", whyFa: text }],
          },
        ],
      },
    ],
    register: [],
    gapfill: [],
    mistakes: { speechStatus: "no_audio", patterns: [], items: [] },
  };
  return model;
}

describe("D31 rich study explanation languages", () => {
  it.each(["en", ...FIRST_LANGUAGES])(
    "retains shared rich notes/cards and validates native script for %s",
    (language) => {
      const model = rich(language);
      const normalized = normalizeGeneratedStudyModel(model, false, { date: "2026-10-07" });
      const result = validateKnowledgeModel(normalized, [], language);
      expect(result.classNotes).toBeDefined();
      expect(result.learningItems[0]?.study?.set).toBe("production");
      expect(result.learningItems[0]?.back).toBe(explanationFor(language));
      expect(result.learningItems[0]?.front).toBe("wear and tear");
      expect(result.learningItems[0]?.study?.faApprox).toBe(
        language === "fa" ? "وِئِر اِن تِئِ" : undefined,
      );
    },
  );
  it("rejects wrong prose in individual rich notes and claims without mixing other valid prose", () => {
    const model = normalizeGeneratedStudyModel(rich("ar"), false);
    const first = model.learningItems[0];
    if (!first) throw new Error("fixture");
    if (first.study?.set !== "production") throw new Error("fixture");
    first.study.noteFa = "An English-only explanation";
    expect(() => validateKnowledgeModel(model, [], "ar")).toThrow();
    first.study.noteFa = "شرح واضح";
    first.claim.text = "Wrong language";
    expect(() => validateKnowledgeModel(model, [], "ar")).toThrow();
    first.claim.text = "شرح واضح";
    expect(() => validateKnowledgeModel(model, [], "ar")).not.toThrow();
  });
  it("FR-ACC-005 rejects Persian prose for an Arabic explanation while Arabic-script languages keep their spelling", () => {
    const persian = "luggage به معنای چمدان‌ها و کیف‌هایی است که در سفر همراه داریم.";
    for (const language of ["ar", "ar-EG"]) {
      expect(matchesExplanationScript(persian, language)).toBe(false);
      expect(matchesExplanationScript("توضیح روشن", language)).toBe(false);
    }
    expect(matchesExplanationScript(persian, "fa")).toBe(true);
    expect(matchesExplanationScript("یہ ایک واضح وضاحت ہے", "ur")).toBe(true);
    expect(matchesExplanationScript("دا یو روښانه تشریح ده", "ps")).toBe(true);
    expect(matchesExplanationScript("توضیح روشن", "fa")).toBe(true);
    for (const arabic of [
      "شرح واضح",
      "بنستخدم make لما نتكلم عن حاجة بنصنعها.",
      "تُنطق p مثل «پ» في الفارسية، وليس «ب».",
      "g في go تُنطق مثل «گ» أو الجيم المصرية.",
      "يُكتب صوت v في بعض الكلمات بالحرف ڤ مثل ڤيديو.",
      "الفرق بين ship /ʃɪp/ و sheep /ʃiːp/ في طول الصوت.",
    ])
      expect(matchesExplanationScript(arabic, "ar")).toBe(true);
    expect(matchesExplanationScript("بنستخدم make لما نتكلم عن حاجة بنصنعها.", "ar-EG")).toBe(true);
  });
  it("FR-ACC-005 accepts quoted Persian or Urdu loanwords inside Arabic prose", () => {
    for (const arabic of [
      "أصل كلمة kiosk فارسي: «کوشک» ومعناه القصر الصغير.",
      "كلمة khaki مأخوذة من الأردية «خاکی» أي بلون التراب.",
      "caravan كلمة إنجليزية أصلها فارسي «کاروان» أي قافلة.",
      'في المصدر كُتب معنى luggage بالفارسية "کیف و چمدان"، والمعنى بالعربية: الأمتعة.',
      "يحتفل الإيرانيون بـ“شب یلدا” في أطول ليلة من السنة.",
      "تعني book بالكردية (کتێب) وبالعربية كتاب.",
    ])
      expect(matchesExplanationScript(arabic, "ar")).toBe(true);
    // A field that is only a quoted Persian phrase is still judged as a whole.
    expect(matchesExplanationScript("«کیف و چمدان»", "ar")).toBe(false);
  });
  it("FR-ACC-005 rejects a Persian claim or meaning for an Arabic learner with language_script_mismatch", () => {
    const persian = "جمله شرطی نوع اول برای موقعیت‌های واقعی در آینده به کار می‌رود.";
    const claimModel = normalizeGeneratedStudyModel(rich("ar"), false);
    const claimItem = claimModel.learningItems[0];
    if (!claimItem) throw new Error("fixture");
    claimItem.claim.text = persian;
    const meaningModel = normalizeGeneratedStudyModel(rich("ar"), false);
    const meaningItem = meaningModel.learningItems[0];
    if (meaningItem?.study?.set !== "production") throw new Error("fixture");
    meaningItem.study.faMeaning = persian;
    for (const [model, language] of [
      [claimModel, "ar"],
      [meaningModel, "ar"],
    ] as const)
      expect(() => validateKnowledgeModel(model, [], language)).toThrow(
        expect.objectContaining({
          details: { fields: { output: ["language_script_mismatch"] } },
        }),
      );
  });
  it("does not accept Persian prose as Spanish because it contains a quoted English target", () => {
    expect(matchesExplanationScript('معنی فارسی با "wear and tear"', "es")).toBe(false);
    expect(matchesExplanationScript('Una explicación de "wear and tear"', "es")).toBe(true);
    expect(matchesExplanationScript("شرح صوت /θ/ و عبارت English", "ar")).toBe(true);
    expect(matchesExplanationScript("/θ/", "el")).toBe(false);
  });
  it("requires the selected code, rejects unknown codes, and keeps existing regional revisions valid", () => {
    expect(isExplanationLanguage("unknown")).toBe(false);
    expect(isExplanationLanguage("fa-IR")).toBe(true);
    expect(isExplanationLanguage("zh")).toBe(false);
    expect(() =>
      validateKnowledgeModel(normalizeGeneratedStudyModel(rich("es"), false), [], "fr"),
    ).toThrow();
  });
  it("requires Persian approximations only for Persian, preserving IPA and rejecting unsupported transliterations", () => {
    const fa = normalizeGeneratedStudyModel(rich("fa"), false);
    const faStudy = fa.learningItems[0]?.study;
    if (!faStudy) throw new Error("fixture");
    delete faStudy.faApprox;
    expect(() => validateKnowledgeModel(fa, [], "fa")).toThrow();
    const es = normalizeGeneratedStudyModel(rich("es"), false);
    const esStudy = es.learningItems[0]?.study;
    if (!esStudy) throw new Error("fixture");
    esStudy.faApprox = "وِئِر";
    expect(() => validateKnowledgeModel(es, [], "es")).toThrow();
    delete esStudy.faApprox;
    expect(validateKnowledgeModel(es, [], "es").learningItems[0]?.study?.ipa).toBe(
      "/ˌweər ən ˈteə/",
    );
  });
  it("keeps English grammar formulas and pronunciation out of the translation target list", () => {
    const model = rich("fa");
    model.classNotes?.register.push({
      notThis: "interested to swim",
      sayThis: "interested in swimming",
      whyFa: "interested in + -ing",
    });
    const fields = explanationStudyFields(model);
    expect(fields.some((field) => field.path.at(-1) === "faApprox")).toBe(false);
    expect(fields.some((field) => field.text === "interested in + -ing")).toBe(false);
    expect(fields.some((field) => field.path.at(-1) === "textFa")).toBe(true);
  });
  it("preserves strict evidence attribution for all languages", () => {
    const model = normalizeGeneratedStudyModel(rich("ja"), false);
    const item = model.learningItems[0];
    if (!item) throw new Error("fixture");
    item.claim.origin = "from_class";
    expect(() => validateKnowledgeModel(model, [], "ja")).toThrow();
  });
  it("uses explicit English fallback instead of leaking Persian pattern labels for an unlocalized language", () => {
    const pattern = visibleMistakePatterns(
      [
        {
          source: "handwriting",
          said: "He go",
          correct: "He goes",
          whyFa: "regel",
          kind: "grammar",
          teacherCorrected: false,
        },
        {
          source: "handwriting",
          said: "She walk",
          correct: "She walks",
          whyFa: "andere regel",
          kind: "grammar",
          teacherCorrected: false,
        },
      ],
      "aa",
    )[0];
    expect(pattern).toBeDefined();
    expect(pattern?.labelFa).not.toMatch(/\p{Script=Arabic}/u);
    expect(pattern?.ruleFa).not.toMatch(/\p{Script=Arabic}/u);
  });
});
