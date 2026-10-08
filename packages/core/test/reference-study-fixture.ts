import type { KnowledgeModel, LearningItem } from "../src/lkm/schema";
import type { StudyContent } from "../src/lkm/study-schema";

function item(id: string, study: StudyContent): LearningItem {
  return {
    id,
    kind: "expression",
    front: study.faMeaning,
    back: study.en,
    study,
    claim: {
      id: `claim-${id}`,
      text: study.faMeaning,
      origin: "ai_expansion",
      creation: "ai_generation",
      evidence: "ai",
      sourceRefs: [],
      speakerRole: "unknown",
      uncertain: false,
    },
  };
}

/** Hand-authored reference content for renderer and browser tests; no provider or DB dependency. */
export function referenceStudyModel(): KnowledgeModel {
  return {
    schemaVersion: "1",
    title: "Binomials + Hype & Scams",
    language: { learning: "en", explanation: "fa" },
    summary: [],
    topics: [],
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
    learningItems: [
      item("wear-tear", {
        set: "production",
        en: "wear and tear",
        ipa: "/ˌweər ən ˈteə/",
        faApprox: "وِئِر اِن تِئِ",
        trap: "تله‌ی بزرگ: tear اینجا با wear هم‌قافیه است /teə/ (پاره شدن) — نه /tɪə/ (اشک).",
        faMeaning: "استهلاک؛ ساییدگی و فرسودگی ناشی از استفاده",
        gapSentence: "My paragliding kit is showing a bit of ______ after three seasons.",
        fullSentence: "My paragliding kit is showing a bit of wear and tear after three seasons.",
        collocations: [
          "normal/general wear and tear",
          "show signs of wear and tear",
          "the warranty doesn't cover wear and tear",
        ],
        noteFa: "غیرقابل‌شمارش: «a wear and tear» غلط است. در قرارداد اجاره و گارانتی زیاد می‌بینی.",
        imageFa: "بالِ پاراگلایدرت که لبه‌اش ساییده و کمی «پاره» (tear) شده.",
        sourceFa: "اسلاید",
        topic: "binomials",
      }),
      item("kit-out", {
        set: "production",
        en: "kit sth out / kit sth out with",
        ipa: "/ˌkɪt ... ˈaʊt/",
        faApprox: "کیت ... آوت",
        faMeaning: "تجهیز کردنِ جایی یا کسی با همه‌ی وسایل لازم",
        gapSentence: "We've just moved into a new office, so we need to ______ it ______.",
        fullSentence: "We've just moved into a new office, so we need to kit it out.",
        collocations: [
          "kit out the kitchen / kit the kitchen out",
          "be kitted out with/in",
          "(n) football kit, kit bag, paragliding kit",
        ],
        noteFa:
          "جداشدنی است: با اسم هر دو ترتیب درست است (kit out the kitchen / kit the kitchen out)، ولی با ضمیر فقط وسط: kit it out — هرگز «kit out it». اسمش kit = تجهیزات/لباس ورزشی.",
        imageFa: "یک kit bag بزرگ که آن را خالی می‌کنی و یک آشپزخانه‌ی خالی پر از وسیله می‌شود.",
        sourceFa: "تخته + توضیح شفاهی معلم",
        topic: "phrasal-verbs",
      }),
      item("pressed-time", {
        set: "production",
        en: "be pressed for time",
        ipa: "/prest fə taɪm/",
        faApprox: "پرِست فِ تایم",
        trap: "pressed یک‌هجایی است: «پرِست» — نه «پرِسِد».",
        faMeaning: "وقت تنگ داشتن؛ در مضیقه‌ی وقت بودن",
        gapSentence: "Unfortunately I've ______, so I haven't finished it yet.",
        fullSentence: "Unfortunately I've been pressed for time, so I haven't finished it yet.",
        collocations: ["be pressed for time/money", "= be short of time"],
        noteFa:
          "حرف اضافه for است، نه by (معلم با قرمز اصلاح کرد). by معنی را به «تحت فشار کسی» عوض می‌کند.",
        imageFa: "یک ساعت شنی که شنش را با فشار (press) زیر پرس گذاشته‌اند.",
        sourceFa: "جمله‌ی خودت (اصلاح معلم)",
        topic: "collocations",
      }),
      item("about-to", {
        set: "recognition",
        en: "I was about to + verb (… when)",
        ipa: "/aɪ wəz əˈbaʊt tə/",
        faMeaning: "داشتم (همین الان) می‌رفتم که…؛ می‌خواستم همین الان…",
        example: "I was about to email IT when the Classroom came back.",
        noteFa: "خیلی طبیعی در گفتار؛ to ضعیف است. «I was about to say that!» = از دهانم گرفتی.",
        topic: "grammar",
        spoken: true,
      }),
      item("cant-fault", {
        set: "recognition",
        en: "you can't fault sb/sth",
        ipa: "/fɔːlt/",
        faMeaning: "هیچ ایرادی نمی‌شود به … گرفت",
        example: "You can't fault the museum — every exhibition is worth going to.",
        noteFa: "معلم: You can't fault the teaching.",
        topic: "collocations",
        spoken: true,
      }),
      item("manager", {
        set: "recognition",
        en: "manager (pronunciation)",
        ipa: "/ˈmænɪdʒə/",
        faMeaning: "مدیر/مربی",
        example: "How much time should a manager be given?",
        noteFa: "تکیه روی هجای اول: «مَنیجِ» — معلم سر کلاس اصلاح کرد.",
        trap: "تکیه روی هجای اول: «مَنیجِ» — معلم سر کلاس اصلاح کرد.",
        topic: "pronunciation",
        spoken: true,
      }),
      item("call-for", {
        set: "recognition",
        en: "call for sth",
        ipa: "/ˈkɔːl fə/",
        faMeaning: "خواستار … شدن (علنی)",
        example: "Some fans are calling for his resignation.",
        topic: "collocations",
        spoken: false,
      }),
      item("gig", {
        set: "recognition",
        en: "a gig (sl)",
        ipa: "/ɡɪɡ/",
        faMeaning: "کنسرت (عامیانه)",
        example: "I haven't been to a gig in yonks.",
        topic: "british",
        spoken: false,
      }),
      item("hefty-discount", {
        set: "recognition",
        en: "a hefty discount",
        ipa: "/ˈhefti/",
        faMeaning: "تخفیف درست‌وحسابی",
        example: "It's just as well we got a hefty student discount.",
        topic: "collocations",
        spoken: false,
      }),
      item("speak-themselves", {
        set: "recognition",
        en: "the results speak for themselves",
        faMeaning: "نتایج خودشان گویا هستند",
        example: "The results speak for themselves.",
        topic: "collocations",
        spoken: false,
      }),
    ],
    classNotes: {
      date: "2026-10-05",
      institution: "Coleg Cambria",
      course: "Advanced ESOL",
      coverage:
        "Lesson 2: Binomials · Listening (concert / football manager / sculpture) · Sentence completion",
      coreIntro:
        "Binomial یعنی دو کلمه که با and/or و با **ترتیب ثابت** می‌آیند. and تقریباً همیشه ضعیف تلفظ می‌شود: /ən/ — «سیکِن تایِد».",
      oralIntro: "از متن صوت کلاس استخراج شده (کیفیت صوت متوسط بود؛ این‌ها جاهایی است که واضح بود).",
      chunks: [
        {
          pattern: "sick and tired of + -ing",
          classSentence: "I'm sick and tired of going back and forth to the surgery…",
          noteFa: "be sick and tired of + V-ing/noun — احساسِ کلافگی از تکرار",
        },
        {
          pattern: "back and forth to + place",
          classSentence: "…going back and forth to the surgery…",
          noteFa: "go back and forth to/between + مکان",
        },
        {
          pattern: "Sooner or later + will",
          classSentence: "Sooner or later I'll get one, I'm sure.",
          noteFa: "اول جمله + کاما + آینده با will",
        },
      ],
      board: [
        "to be taken in by sb = tricked (neutral) = deceived (formal) = conned (sl)",
        "a rogue trader = a conman / a scammer / a trickster",
        "a concert / a gig (sl)",
      ],
      tasks: [
        {
          title: "Wordwall — Vocabulary Booster (تو ۱۰ از ۱۰ گرفتی ✓)",
          blocks: [
            {
              type: "table",
              headers: ["binomial", "meaning"],
              rows: [
                ["**safe and sound**", "unharmed"],
                ["**sooner or later**", "eventually"],
                ["**by and large**", "generally"],
                ["**wear and tear**", "gradual damage through use"],
              ],
            },
          ],
        },
        {
          title: "Listening — ۳ بخش، ۶ سؤال",
          blocks: [
            {
              type: "text",
              textFa:
                "آنچه در صوت واضح بود: **Q1 = A، Q2 = A** (کنسرت راک)، **Q3 = C** (مربی فوتبال). جواب‌های ۴ تا ۶ در صوت قابل تشخیص نبود — اگر برگه‌ی سؤال‌ها را عکس بگیری، دقیقش می‌کنم.",
            },
            {
              type: "quote",
              quoteEn:
                "“I went with **high hopes of** seeing something really spectacular… I reckon I was **taken in by** all the hype… I should know better than to **take any notice of** it.”",
            },
          ],
        },
        {
          title: "Sentence completion — جواب‌های تو (۱–۲) و نمونه‌ی C1 برای همه",
          blocks: [
            {
              type: "items",
              items: [
                {
                  prompt: "I had high hopes of ___.",
                  learnerAnswer:
                    "I had high hope of creating an app to support my classmates, but unfortunately I have been pressed by time, so I haven't finished.",
                  model:
                    "I've got high hopes of creating an app to support my classmates, but unfortunately I've been pressed for time, so I haven't finished it yet.",
                  whyFa:
                    "hope → hopes؛ pressed by → pressed for؛ چون پروژه هنوز ادامه دارد، I've got high hopes بهتر است (had = نشد)؛ finish مفعول می‌خواهد: finished it yet.",
                },
                {
                  prompt: "I was taken in by the hype surrounding ___.",
                  learnerAnswer: "I was taken in by hype surrounding the film I watched last week.",
                  model: "I was taken in by the hype surrounding the film I watched last week.",
                  whyFa: "فقط the جا افتاده: the hype (هایپِ مشخصِ آن فیلم).",
                },
                {
                  prompt: "I think it's worth investing in ___.",
                  model:
                    "I think it's worth investing in a professional website if you run a small business.",
                  whyFa: "worth + -ing.",
                },
                {
                  prompt: "I came to the conclusion that ___.",
                  model:
                    "I came to the conclusion that I remember more when I review my cards every day.",
                },
              ],
            },
          ],
        },
      ],
      mistakes: {
        speechStatus: "unverified",
        patterns: [],
        items: [
          {
            source: "speech",
            said: "The quality was really **disappointed**.",
            correct: "The quality was really **disappointing**.",
            whyFa: "-ing برای چیزی که ناامید می‌کند؛ -ed برای آدمی که ناامید شده.",
            kind: "grammar",
            teacherCorrected: false,
            where: "1:31:20",
          },
          {
            source: "handwriting",
            said: "…unfortunately I have been pressed **by** time…",
            correct: "…unfortunately I've been pressed **for** time…",
            whyFa: "حرف اضافه for است، نه by؛ با by معنی می‌شود «تحت فشار کسی».",
            kind: "preposition",
            teacherCorrected: true,
            where: "Sentence completion 1",
            itemId: "pressed-time",
          },
          {
            source: "handwriting",
            said: "I had high **hope** of creating an app…",
            correct: "I've got high **hopes** of creating an app…",
            whyFa:
              "high hopes همیشه جمع است. had یعنی امیدی که برآورده نشد؛ برای کاری که هنوز ادامه دارد I've got.",
            kind: "grammar",
            teacherCorrected: false,
            where: "Sentence completion 1",
          },
          {
            source: "handwriting",
            said: "I usually take notice of the road **signe**.",
            correct: "I usually take notice of road **signs**.",
            whyFa: "املای signs. برای کلی‌گویی the هم نمی‌خواهد.",
            kind: "spelling",
            teacherCorrected: false,
            where: "Sentence completion 3",
          },
        ],
      },
      register: [
        {
          notThis: "kit out it",
          sayThis: "kit it out",
          whyFa: "ضمیر همیشه وسطِ phrasal verb جداشدنی.",
        },
        {
          notThis: "forth and back / later or sooner",
          sayThis: "back and forth / sooner or later",
          whyFa: "ترتیب binomial ثابت است.",
        },
        {
          notThis: "I was deceived by him (با دوستان)",
          sayThis: "I was taken in by him / I got conned",
          whyFa: "deceived رسمی و «posh» است؛ conned عامیانه.",
        },
        {
          notThis: "It's been donkey's years (در ایمیل رسمی)",
          sayThis: "I haven't … for a long time",
          whyFa: "donkey's years و yonks فقط محاوره‌ای‌اند.",
        },
      ],
      gapfill: [
        {
          sentence: "I'm ______ and tired of chasing clients for unpaid invoices.",
          answer: "sick",
        },
        { sentence: "The landlord can't charge you for normal ______ and tear.", answer: "wear" },
        { sentence: "We've decided to ______ the spare room out as an office.", answer: "kit" },
        {
          sentence: "I've been pressed ______ time all week.",
          answer: "for",
          whyFa: "حرف اضافه‌ی ثابت؛ نه by.",
        },
        { sentence: "It's been ______ since I went to a gig. (sl, one word)", answer: "yonks" },
      ],
    },
  };
}
