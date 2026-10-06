import { expect, it } from "vitest";
import { renderMixedPersian } from "./mixed-text";

const examples = [
  [
    "خیلی طبیعی در گفتار؛ to ضعیف است. «I was about to say that!» = از دهانم گرفتی.",
    "خیلی طبیعی در گفتار؛ <bdi>to</bdi> ضعیف است. «<bdi>I was about to say that!</bdi>» = از دهانم گرفتی.",
  ],
  ["معلم: You can't fault the teaching.", "معلم: <bdi>You can't fault the teaching.</bdi>"],
  ["اسمش kit.", "اسمش <bdi>kit</bdi>."],
  [
    "-ing برای چیزی که ناامید می‌کند؛ -ed برای آدمی که ناامید شده.",
    "<bdi>-ing</bdi> برای چیزی که ناامید می‌کند؛ <bdi>-ed</bdi> برای آدمی که ناامید شده.",
  ],
  ["worth + -ing.", "<bdi>worth + -ing.</bdi>"],
  ["Listening — ۳ بخش، ۶ سؤال", "<bdi>Listening</bdi> — ۳ بخش، ۶ سؤال"],
  [
    "تکیه روی هجای اول: /ˈmænɪdʒə/ «مَنیجِ» — معلم سر کلاس اصلاح کرد.",
    'تکیه روی هجای اول: <bdi class="ipa">/ˈmænɪdʒə/</bdi> «مَنیجِ» — معلم سر کلاس اصلاح کرد.',
  ],
  [
    "hope → hopes؛ pressed by → pressed for؛ چون پروژه هنوز ادامه دارد، I've got high hopes بهتر است (had = نشد).",
    "<bdi>hope → hopes</bdi>؛ <bdi>pressed by → pressed for</bdi>؛ چون پروژه هنوز ادامه دارد، <bdi>I've got high hopes</bdi> بهتر است (<bdi>had</bdi> = نشد).",
  ],
  [
    "با اسم هر دو ترتیب درست است (kit out the kitchen / kit the kitchen out)، ولی با ضمیر فقط وسط: kit it out — هرگز «kit out it».",
    "با اسم هر دو ترتیب درست است (<bdi>kit out the kitchen / kit the kitchen out</bdi>)، ولی با ضمیر فقط وسط: <bdi>kit it out</bdi> — هرگز «<bdi>kit out it</bdi>».",
  ],
  [
    "با دوستان نگو I was deceived (formal)، بگو I got conned.",
    "با دوستان نگو <bdi>I was deceived (formal)</bdi>، بگو <bdi>I got conned.</bdi>",
  ],
  [
    "آنچه در صوت واضح بود: **Q1 = A، Q2 = A** (کنسرت راک).",
    "آنچه در صوت واضح بود: <b><bdi>Q1 = A</bdi>، <bdi>Q2 = A</bdi></b> (کنسرت راک).",
  ],
  ["go back and forth to/between + مکان", "<bdi>go back and forth to/between</bdi> + مکان"],
  ["یک کاسب متقلب £3,000 cash خواست.", "یک کاسب متقلب <bdi>£3,000 cash</bdi> خواست."],
  [
    "جمله را نیمه‌کاره گذاشت: It's been yonks since... و بعد خندید.",
    "جمله را نیمه‌کاره گذاشت: <bdi>It's been yonks since...</bdi> و بعد خندید.",
  ],
  ["Binomials + Hype & Scams", "<bdi>Binomials + Hype &amp; Scams</bdi>"],
] as const;

it.each(examples)("matches the brief's exact mixed-text output: %s", (input, output) => {
  expect(renderMixedPersian(input)).toBe(output);
});

it("leaves bare numbers and Persian punctuation alone and balances bracketed runs", () => {
  expect(renderMixedPersian("۱۲۳ 456 — £20")).toBe("۱۲۳ 456 — £20");
  expect(renderMixedPersian("واژه [good (formal)]؛ α /θ/")).toBe(
    "واژه [<bdi>good (formal)</bdi>]؛ <bdi>α /θ/</bdi>",
  );
});

it("escapes untrusted tags and entities, including inside bold markers", () => {
  const output = renderMixedPersian('**<script>alert("x")</script>** &lt;img src=x&gt;');
  expect(output).not.toContain("<script>");
  expect(output).not.toContain("<img");
  expect(output).toContain("&lt;");
  expect(output).toContain("&amp;");
  expect(output).toContain("<b>");
});
