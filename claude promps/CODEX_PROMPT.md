# Brief: make Class Notes and flashcards match my reference output

## What this is

This app turns the material from one English lesson (photos of the board and slides, the handout, a transcript of the class audio) into study material for a Persian-speaking learner. I want two of its outputs changed:

- **Class Notes**: the HTML sheet for a lesson, shown inside the app and downloadable.
- **Flashcards**: the cards generated from the same lesson.

For several weeks I have been producing both by hand with another tool after each of my own classes, and that hand-made output is what I actually study from. It has settled into a fixed shape. I want the app to produce that same output: the same sections in the same order, the same components and features, the same look, and cards written and laid out the same way.

One section is new. «اشتباهات تو» collects the learner's own mistakes from the lesson, taken from their voice in the class recording and from their handwriting. In my hand-made sheets these were scattered across other sections, and I was often unsure whether a spoken mistake was mine or a classmate's. Part 6 deals with that: how to work out which voice is the learner's, and what to show when that is not certain.

Part 1 is the output, as a reference document. Parts 2 to 5 are the rules behind it, and Part 6 is the voice question. This brief was written without sight of the codebase, so it names none of your files, components or schema. Treat it as the contract for what comes out, and fit it into the architecture and design you already have.

## What "match" means

- **The Class Notes document is reproduced exactly.** Its stylesheet as given, its markup structure, its Persian labels, its behaviour. It is a self-contained document with its own look and does not take on the app's styling.
- **The app around it stays yours.** Routing, upload, the screens the notes and cards sit in, the flashcard chrome (deck view, flip, rating buttons, progress). None of that needs redesigning. The one exception is Part 6, which needs a place to record a voice sample and a prompt to confirm a voice.
- **The content is generated per lesson** by the rules in Part 5. The reference shows the shape, not the words.

## How to go about it

1. **Read first.** Find where the notes HTML is produced and how it is shown and downloaded; where cards are generated, displayed and exported; the model prompt(s) and output schema behind both; how a lesson is stored.
2. **One lesson, one set of items.** In the reference, the numbered cards in the `core` section of the notes are the production flashcards, the `oral` and `extra` sections are the supplementary set, and the pronunciation appendix is derived from both. If notes and cards come from separate model calls today, they will disagree with each other (different items, different IPA for the same word). Make them renderings of the same stored items.
3. **The model writes content; a template writes HTML.** The model returns structured data (Part 3), and deterministic code turns it into the notes document and the card fields. When I let a model write the HTML itself, the look drifted from lesson to lesson, which is exactly what this brief is meant to end. If the model writes HTML today, change that.
4. **Extend, don't fork.** Add to your lesson schema rather than keeping a second one beside it. Lessons already stored must still open: render what they have and leave out what they lack.
5. **Two stages.** Parts 1 to 5 can ship without Part 6. Until the voice work exists, «اشتباهات تو» shows written mistakes only, with the note that spoken ones are withheld.
6. **Say what you couldn't do.** If something here can't be done without removing an existing feature, or needs a far larger rewrite than it sounds, do the rest and tell me what you left and why. Don't approximate quietly.

## Part 1. The Class Notes reference document

This is the target. Its content is a cut-down real lesson (3 of the 18 cards, a few rows per table), chosen so that every component and every variant appears at least once. The `mistakes` section is assembled from that lesson's corrections, and the times in it are placeholders. The HTML comments are notes for you and are not part of the output. Take the `<style>` block as it is: the tokens, sizes and selectors are the design.

```html
<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Binomials + Hype &amp; Scams · 2026-10-05</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&amp;family=Vazirmatn:wght@400;600;800&amp;display=swap" rel="stylesheet">
<style>
/* tokens: light by default, dark from the OS setting, or forced by <html data-theme="light|dark"> */
:root{color-scheme:light dark;--bg:#faf7f2;--card:#fff;--ink:#1f2328;--mute:#6b6f76;--line:#e8e1d6;--acc:#8a3b12;--on-acc:#fff;--acc2:#1f5f5b;--bad:#a1271b;--good:#1f6b3a;--hl:#fff3d6;
  --fa:Vazirmatn,Tahoma,sans-serif;
  --en:Lora,Georgia,Vazirmatn,Tahoma,serif;
  --ipa:"Noto Serif","Charis SIL","Gentium Plus","Times New Roman","DejaVu Serif",serif}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#16181b;--card:#1f2226;--ink:#e9e6e1;--mute:#9a9ea5;--line:#30343a;--acc:#e7955d;--on-acc:#1f2226;--acc2:#6fc2bb;--bad:#ef8a7e;--good:#7fd09a;--hl:#3a321f}}
:root[data-theme=dark]{color-scheme:dark;--bg:#16181b;--card:#1f2226;--ink:#e9e6e1;--mute:#9a9ea5;--line:#30343a;--acc:#e7955d;--on-acc:#1f2226;--acc2:#6fc2bb;--bad:#ef8a7e;--good:#7fd09a;--hl:#3a321f}
:root[data-theme=light]{color-scheme:light}

/* page */
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--fa);line-height:1.9;font-size:16px}
[dir=ltr],.en,.ex,.col{font-family:var(--en)}
.ipa{font-family:var(--ipa)}
main{max-width:880px;margin:auto;padding:1rem 16px 4rem}
header h1{font-size:1.7rem;margin:.5rem 0 0}
header p{color:var(--mute);margin:.2rem 0}
.date{white-space:nowrap}

/* sticky section nav */
nav{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);display:flex;gap:.3rem;overflow-x:auto;padding:.5rem 1rem;white-space:nowrap}
nav a{color:var(--acc2);text-decoration:none;font-size:.85rem;padding:.2rem .6rem;border-radius:99px;border:1px solid var(--line)}

/* sections */
section{margin-top:2.5rem}
section,.entry{scroll-margin-top:3.5rem}
h2{color:var(--acc);border-bottom:2px solid var(--acc);padding-bottom:.3rem}
.note{background:var(--hl);border-radius:8px;padding:.6rem 1rem}
.top{display:block;text-align:left;font-size:.8rem;margin-top:.6rem;color:var(--mute)}

/* entry card */
.entry{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.9rem 1.1rem;margin:1rem 0}
.entry h3{margin:0;display:flex;gap:.6rem;align-items:center}
.entry h3 .en{font-size:1.25rem}
.entry p{margin:.35rem 0}
.n{background:var(--acc);color:var(--on-acc);border-radius:50%;width:1.8rem;height:1.8rem;display:inline-grid;place-items:center;font-size:.85rem;flex:none}
.pron{font-size:.85rem;color:var(--mute)}
.trap{color:var(--bad)}
.mean{font-weight:600}
.ex{background:var(--hl);padding:.3rem .6rem;border-radius:6px;font-style:italic}
.img,.src{color:var(--mute);font-size:.9rem}

/* tables */
.tw{overflow-x:auto}
table{width:100%;border-collapse:collapse;background:var(--card);font-size:.92rem}
td,th{border:1px solid var(--line);padding:.4rem .6rem;vertical-align:top}
th{background:var(--hl)}
.bad{color:var(--bad);text-decoration:line-through}
.good{color:var(--good);font-weight:600}

/* task items */
.sc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.6rem 1rem;margin:.7rem 0}
.sc p{margin:.2rem 0}
.yours{color:var(--bad)}
.model{color:var(--good)}
.why{font-size:.9rem;color:var(--mute)}
.sc a{color:var(--acc2)}

/* gap-fill */
ol.gaps li{margin:.6rem 0}
details{display:inline-block;margin-inline-start:.6rem}
details[open]{vertical-align:top}
summary{cursor:pointer;color:var(--acc2);font-size:.85rem}
.key{display:none}

/* print: always the light palette, no nav, answers as a key under the drill */
@media print{
  :root:root{color-scheme:light;--bg:#fff;--card:#fff;--ink:#000;--mute:#555;--line:#ccc;--acc:#8a3b12;--on-acc:#fff;--acc2:#1f5f5b;--bad:#a1271b;--good:#1f6b3a;--hl:#fff3d6}
  nav,.top,ol.gaps details{display:none}
  .entry,.sc,tr{break-inside:avoid}
  .key{display:block}
}
</style>
</head>
<body id="top">
<!-- one pill per section that exists, in page order -->
<nav><a href="#core">۳ کارت اصلی</a><a href="#oral">نکته‌های شفاهی معلم</a><a href="#chunks">چانک‌های خط‌کشیده</a><a href="#tasks">جواب تمرین‌ها</a><a href="#mistakes">اشتباهات تو</a><a href="#extra">بقیه‌ی عبارت‌ها</a><a href="#register">این را بگو/آن را نه</a><a href="#gap">جای خالی</a><a href="#pron">تلفظ</a></nav>
<main>
<header>
<h1><bdi>Binomials + Hype &amp; Scams</bdi></h1>
<p><bdi>Coleg Cambria · Advanced ESOL</bdi> · دوشنبه <bdi dir="ltr" class="date">2026-10-05</bdi></p>
<p><bdi>Lesson 2: Binomials · Listening (concert / football manager / sculpture) · Sentence completion</bdi></p>
</header>

<section id="core">
<h2>۱. کارت‌های اصلی (<bdi>production</bdi>)</h2>
<p class="note"><bdi>Binomial</bdi> یعنی دو کلمه که با <bdi>and/or</bdi> و با <b>ترتیب ثابت</b> می‌آیند. <bdi>and</bdi> تقریباً همیشه ضعیف تلفظ می‌شود: <bdi class="ipa">/ən/</bdi> — «سیکِن تایِد».</p>
<!-- one .entry per core card, numbered in deck order; these are the same items as the production flashcards -->
<article class="entry" id="wear-tear">
<h3><span class="n">1</span><span dir="ltr" class="en">wear and tear</span></h3>
<p class="pron">🔊 <bdi dir="ltr" class="ipa">/ˌweər ən ˈteə/</bdi> · وِئِر اِن تِئِ · <span dir="rtl" class="trap">⚠️ تله‌ی بزرگ: <bdi>tear</bdi> اینجا با <bdi>wear</bdi> هم‌قافیه است <bdi class="ipa">/teə/</bdi> (پاره شدن) — نه <bdi class="ipa">/tɪə/</bdi> (اشک).</span></p>
<p class="mean">استهلاک؛ ساییدگی و فرسودگی ناشی از استفاده</p>
<p class="ex" dir="ltr">My paragliding kit is showing a bit of wear and tear after three seasons.</p>
<p class="col" dir="ltr"><b>Collocations:</b> normal/general wear and tear · show signs of wear and tear · the warranty doesn't cover wear and tear</p>
<p>📝 غیرقابل‌شمارش: «<bdi>a wear and tear</bdi>» غلط است. در قرارداد اجاره و گارانتی زیاد می‌بینی.</p>
<p class="img">🖼️ بالِ پاراگلایدرت که لبه‌اش ساییده و کمی «پاره» (<bdi>tear</bdi>) شده.</p>
<p class="src">منبع: اسلاید</p>
</article>
<article class="entry" id="kit-out">
<h3><span class="n">2</span><span dir="ltr" class="en">kit sth out / kit sth out with</span></h3>
<p class="pron">🔊 <bdi dir="ltr" class="ipa">/ˌkɪt ... ˈaʊt/</bdi> · کیت ... آوت</p>
<p class="mean">تجهیز کردنِ جایی یا کسی با همه‌ی وسایل لازم</p>
<p class="ex" dir="ltr">We've just moved into a new office, so we need to kit it out.</p>
<p class="col" dir="ltr"><b>Collocations:</b> kit out the kitchen / kit the kitchen out · be kitted out with/in · (n) football kit, kit bag, paragliding kit</p>
<p>📝 جداشدنی است: با اسم هر دو ترتیب درست است (<bdi>kit out the kitchen / kit the kitchen out</bdi>)، ولی با ضمیر فقط وسط: <bdi>kit it out</bdi> — هرگز «<bdi>kit out it</bdi>». اسمش <bdi>kit</bdi> = تجهیزات/لباس ورزشی.</p>
<p class="img">🖼️ یک <bdi>kit bag</bdi> بزرگ که آن را خالی می‌کنی و یک آشپزخانه‌ی خالی پر از وسیله می‌شود.</p>
<p class="src">منبع: تخته + توضیح شفاهی معلم</p>
</article>
<article class="entry" id="pressed-time">
<h3><span class="n">3</span><span dir="ltr" class="en">be pressed for time</span></h3>
<p class="pron">🔊 <bdi dir="ltr" class="ipa">/prest fə taɪm/</bdi> · پرِست فِ تایم · <span dir="rtl" class="trap">⚠️ <bdi>pressed</bdi> یک‌هجایی است: «پرِست» — نه «پرِسِد».</span></p>
<p class="mean">وقت تنگ داشتن؛ در مضیقه‌ی وقت بودن</p>
<p class="ex" dir="ltr">Unfortunately I've been pressed for time, so I haven't finished it yet.</p>
<p class="col" dir="ltr"><b>Collocations:</b> be pressed for time/money · = be short of time</p>
<p>📝 حرف اضافه <bdi>for</bdi> است، نه <bdi>by</bdi> (معلم با قرمز اصلاح کرد). <bdi>by</bdi> معنی را به «تحت فشار کسی» عوض می‌کند.</p>
<p class="img">🖼️ یک ساعت شنی که شنش را با فشار (<bdi>press</bdi>) زیر پرس گذاشته‌اند.</p>
<p class="src">منبع: جمله‌ی خودت (اصلاح معلم)</p>
</article>
<a class="top" href="#top">↑ بالا</a>
</section>

<section id="oral">
<h2>۲. چیزهایی که معلم شفاهی توضیح داد</h2>
<p class="note">از متن صوت کلاس استخراج شده (کیفیت صوت متوسط بود؛ این‌ها جاهایی است که واضح بود).</p>
<!-- same card, no number badge; the 📝 line is optional -->
<article class="entry">
<h3><span dir="ltr" class="en">I was about to + verb (… when)</span></h3>
<p class="pron">🔊 <bdi dir="ltr" class="ipa">/aɪ wəz əˈbaʊt tə/</bdi></p>
<p class="mean">داشتم (همین الان) می‌رفتم که…؛ می‌خواستم همین الان…</p>
<p class="ex" dir="ltr">I was about to email IT when the Classroom came back.</p>
<p>📝 خیلی طبیعی در گفتار؛ <bdi>to</bdi> ضعیف است. «<bdi>I was about to say that!</bdi>» = از دهانم گرفتی.</p>
</article>
<article class="entry">
<h3><span dir="ltr" class="en">you can't fault sb/sth</span></h3>
<p class="pron">🔊 <bdi dir="ltr" class="ipa">/fɔːlt/</bdi></p>
<p class="mean">هیچ ایرادی نمی‌شود به … گرفت</p>
<p class="ex" dir="ltr">You can't fault the museum — every exhibition is worth going to.</p>
<p>📝 معلم: <bdi>You can't fault the teaching.</bdi></p>
</article>
<article class="entry">
<h3><span dir="ltr" class="en">manager (pronunciation)</span></h3>
<p class="pron">🔊 <bdi dir="ltr" class="ipa">/ˈmænɪdʒə/</bdi></p>
<p class="mean">مدیر/مربی</p>
<p class="ex" dir="ltr">How much time should a manager be given?</p>
<p>📝 تکیه روی هجای اول: «مَنیجِ» — معلم سر کلاس اصلاح کرد.</p>
</article>
<a class="top" href="#top">↑ بالا</a>
</section>

<section id="chunks">
<h2>۳. چانک‌های خط‌کشیده + الگوی استفاده</h2>
<div class="tw"><table>
<tr><th>الگو</th><th>جمله‌ی کلاس</th><th>نکته</th></tr>
<tr><td dir="ltr"><b>sick and tired of + -ing</b></td><td dir="ltr"><i>I'm sick and tired of going back and forth to the surgery…</i></td><td><bdi>be sick and tired of + V-ing/noun</bdi> — احساسِ کلافگی از تکرار</td></tr>
<tr><td dir="ltr"><b>back and forth to + place</b></td><td dir="ltr"><i>…going back and forth to the surgery…</i></td><td><bdi>go back and forth to/between</bdi> + مکان</td></tr>
<tr><td dir="ltr"><b>Sooner or later + will</b></td><td dir="ltr"><i>Sooner or later I'll get one, I'm sure.</i></td><td>اول جمله + کاما + آینده با <bdi>will</bdi></td></tr>
</table></div>
<p>روی تخته همچنین:</p>
<ul dir="ltr">
<li><b>to be taken in by sb = tricked (neutral) = deceived (formal) = conned (sl)</b></li>
<li><b>a rogue trader = a conman / a scammer / a trickster</b></li>
<li><b>a concert / a gig (sl)</b></li>
</ul>
<a class="top" href="#top">↑ بالا</a>
</section>

<section id="tasks">
<h2>۴. جواب تمرین‌ها</h2>
<!-- this section is a free sequence of blocks, one group per exercise: h3 title, then a table, Persian text, an English quote, or .sc items -->
<h3><bdi>Wordwall — Vocabulary Booster</bdi> (تو ۱۰ از ۱۰ گرفتی ✓)</h3>
<div class="tw"><table>
<tr><th><bdi>binomial</bdi></th><th><bdi>meaning</bdi></th></tr>
<tr><td dir="ltr"><b>safe and sound</b></td><td dir="ltr">unharmed</td></tr>
<tr><td dir="ltr"><b>sooner or later</b></td><td dir="ltr">eventually</td></tr>
<tr><td dir="ltr"><b>by and large</b></td><td dir="ltr">generally</td></tr>
<tr><td dir="ltr"><b>wear and tear</b></td><td dir="ltr">gradual damage through use</td></tr>
</table></div>
<h3><bdi>Listening</bdi> — ۳ بخش، ۶ سؤال</h3>
<p>آنچه در صوت واضح بود: <b><bdi>Q1 = A</bdi>، <bdi>Q2 = A</bdi></b> (کنسرت راک)، <b><bdi>Q3 = C</bdi></b> (مربی فوتبال). جواب‌های ۴ تا ۶ در صوت قابل تشخیص نبود — اگر برگه‌ی سؤال‌ها را عکس بگیری، دقیقش می‌کنم.</p>
<p class="ex" dir="ltr">“I went with <b>high hopes of</b> seeing something really spectacular… I reckon I was <b>taken in by</b> all the hype… I should know better than to <b>take any notice of</b> it.”</p>
<h3><bdi>Sentence completion</bdi> — جواب‌های تو (۱–۲) و نمونه‌ی <bdi>C1</bdi> برای همه</h3>
<!-- .yours appears only where the learner gave an answer; .why is optional -->
<div class="sc">
<p class="q" dir="ltr"><b>1.</b> I had high hopes of ___.</p>
<p class="yours" dir="ltr">✗ I had high hope of creating an app to support my classmates, but unfortunately I have been pressed by time, so I haven't finished.</p>
<p class="model" dir="ltr">✓ I've got high hopes of creating an app to support my classmates, but unfortunately I've been pressed for time, so I haven't finished it yet.</p>
<p class="why"><bdi>hope → hopes</bdi>؛ <bdi>pressed by → pressed for</bdi>؛ چون پروژه هنوز ادامه دارد، <bdi>I've got high hopes</bdi> بهتر است (<bdi>had</bdi> = نشد)؛ <bdi>finish</bdi> مفعول می‌خواهد: <bdi>finished it yet.</bdi></p>
</div>
<div class="sc">
<p class="q" dir="ltr"><b>2.</b> I was taken in by the hype surrounding ___.</p>
<p class="yours" dir="ltr">✗ I was taken in by hype surrounding the film I watched last week.</p>
<p class="model" dir="ltr">✓ I was taken in by the hype surrounding the film I watched last week.</p>
<p class="why">فقط <bdi>the</bdi> جا افتاده: <bdi>the hype</bdi> (هایپِ مشخصِ آن فیلم).</p>
</div>
<div class="sc">
<p class="q" dir="ltr"><b>3.</b> I think it's worth investing in ___.</p>
<p class="model" dir="ltr">✓ I think it's worth investing in a professional website if you run a small business.</p>
<p class="why"><bdi>worth + -ing.</bdi></p>
</div>
<div class="sc">
<p class="q" dir="ltr"><b>4.</b> I came to the conclusion that ___.</p>
<p class="model" dir="ltr">✓ I came to the conclusion that I remember more when I review my cards every day.</p>
</div>
<a class="top" href="#top">↑ بالا</a>
</section>

<section id="mistakes">
<h2>۵. اشتباهات تو</h2>
<p class="note">بخش‌هایی از صوت این جلسه واضح نبود. در بخش گفتاری فقط چیزهایی آمده که واضح شنیده می‌شد یا معلم همان‌جا اصلاحشان کرد.</p>
<!-- patterns: only those that occurred at least twice in this lesson -->
<h3>الگوهای تکراری</h3>
<div class="sc">
<p class="mean">حرف اضافه‌ی ثابت · ۳ بار</p>
<p dir="ltr">pressed by time → pressed for time<br>at the first time → for the first time<br>responsible about → responsible for</p>
<p class="why">این ترکیب‌ها را با حرف اضافه‌شان یک‌جا حفظ کن؛ از فارسی ترجمه نمی‌شوند.</p>
</div>
<div class="sc">
<p class="mean">جمع و مفرد · ۲ بار</p>
<p dir="ltr">high hope → high hopes<br>our life → our lives</p>
<p class="why">بعضی عبارت‌ها همیشه جمع‌اند، و بعد از <bdi>our</bdi> چیزی که هر کس یکی دارد جمع می‌آید.</p>
</div>
<!-- spoken mistakes appear only when the learner's voice is verified (Part 6) -->
<h3>گفتاری (از صدای کلاس)</h3>
<div class="sc">
<p class="yours" dir="ltr">✗ The quality was really <b>disappointed</b>.</p>
<p class="model" dir="ltr">✓ The quality was really <b>disappointing</b>.</p>
<p class="why"><bdi>-ing</bdi> برای چیزی که ناامید می‌کند؛ <bdi>-ed</bdi> برای آدمی که ناامید شده.</p>
<p class="src">🎙️ گرامر · <bdi dir="ltr">1:31:20</bdi></p>
</div>
<div class="sc">
<p class="yours" dir="ltr">✗ responsible <b>about</b></p>
<p class="model" dir="ltr">✓ responsible <b>for</b></p>
<p class="why">حرف اضافه‌ی ثابت.</p>
<p class="src">🎙️ حرف اضافه · <bdi dir="ltr">1:12:05</bdi></p>
</div>
<div class="sc">
<p class="yours" dir="ltr">✗ manager</p>
<p class="model" dir="ltr">✓ <b>MAN</b>ager</p>
<p class="why">تکیه روی هجای اول است: <bdi class="ipa">/ˈmænɪdʒə/</bdi> «مَنیجِ».</p>
<p class="src">🎙️ تلفظ · اصلاح معلم · <bdi dir="ltr">0:58:30</bdi></p>
</div>
<h3>نوشتاری (از دست‌خط تو)</h3>
<div class="sc">
<p class="yours" dir="ltr">✗ …unfortunately I have been pressed <b>by</b> time…</p>
<p class="model" dir="ltr">✓ …unfortunately I've been pressed <b>for</b> time…</p>
<p class="why">حرف اضافه <bdi>for</bdi> است، نه <bdi>by</bdi>؛ با <bdi>by</bdi> معنی می‌شود «تحت فشار کسی».</p>
<p class="src">✍️ حرف اضافه · اصلاح معلم · <bdi>Sentence completion 1</bdi> · <a href="#pressed-time">کارت ۳</a></p>
</div>
<div class="sc">
<p class="yours" dir="ltr">✗ I had high <b>hope</b> of creating an app…</p>
<p class="model" dir="ltr">✓ I've got high <b>hopes</b> of creating an app…</p>
<p class="why"><bdi>high hopes</bdi> همیشه جمع است. <bdi>had</bdi> یعنی امیدی که برآورده نشد؛ برای کاری که هنوز ادامه دارد <bdi>I've got.</bdi></p>
<p class="src">✍️ گرامر · <bdi>Sentence completion 1</bdi></p>
</div>
<div class="sc">
<p class="yours" dir="ltr">✗ I usually take notice of the road <b>signe</b>.</p>
<p class="model" dir="ltr">✓ I usually take notice of road <b>signs</b>.</p>
<p class="why">املای <bdi>signs</bdi>. برای کلی‌گویی <bdi>the</bdi> هم نمی‌خواهد.</p>
<p class="src">✍️ املا · <bdi>Sentence completion 3</bdi></p>
</div>
<a class="top" href="#top">↑ بالا</a>
</section>

<section id="extra">
<h2>۶. بقیه‌ی عبارت‌ها (<bdi>recognition</bdi>)</h2>
<!-- the supplementary recognition cards that are not already shown in the oral section -->
<div class="tw"><table>
<tr><th><bdi>English</bdi></th><th>معنی</th><th>مثال</th></tr>
<tr><td dir="ltr"><b>call for sth</b></td><td>خواستار … شدن (علنی)</td><td dir="ltr"><i>Some fans are calling for his resignation.</i></td></tr>
<tr><td dir="ltr"><b>a gig (sl)</b></td><td>کنسرت (عامیانه)</td><td dir="ltr"><i>I haven't been to a gig in yonks.</i></td></tr>
<tr><td dir="ltr"><b>a hefty discount</b></td><td>تخفیف درست‌وحسابی</td><td dir="ltr"><i>It's just as well we got a hefty student discount.</i></td></tr>
<tr><td dir="ltr"><b>the results speak for themselves</b></td><td>نتایج خودشان گویا هستند</td><td dir="ltr"><i>The results speak for themselves.</i></td></tr>
</table></div>
<a class="top" href="#top">↑ بالا</a>
</section>

<section id="register">
<h2>۷. این را بگو — آن را نه</h2>
<div class="tw"><table>
<tr><th>✗ نه این</th><th>✓ این</th><th>چرا</th></tr>
<tr><td dir="ltr" class="bad">kit out it</td><td dir="ltr" class="good">kit it out</td><td>ضمیر همیشه وسطِ <bdi>phrasal verb</bdi> جداشدنی.</td></tr>
<tr><td dir="ltr" class="bad">forth and back / later or sooner</td><td dir="ltr" class="good">back and forth / sooner or later</td><td>ترتیب <bdi>binomial</bdi> ثابت است.</td></tr>
<tr><td dir="ltr" class="bad">I was deceived by him (با دوستان)</td><td dir="ltr" class="good">I was taken in by him / I got conned</td><td><bdi>deceived</bdi> رسمی و «<bdi>posh</bdi>» است؛ <bdi>conned</bdi> عامیانه.</td></tr>
<tr><td dir="ltr" class="bad">It's been donkey's years (در ایمیل رسمی)</td><td dir="ltr" class="good">I haven't … for a long time</td><td><bdi>donkey's years</bdi> و <bdi>yonks</bdi> فقط محاوره‌ای‌اند.</td></tr>
</table></div>
<a class="top" href="#top">↑ بالا</a>
</section>

<section id="gap">
<h2>۸. جای خالی (با جواب پنهان)</h2>
<ol class="gaps" dir="ltr">
<li>I'm <b>______</b> and tired of chasing clients for unpaid invoices.<details><summary>جواب</summary><b>sick</b></details></li>
<li>The landlord can't charge you for normal <b>______</b> and tear.<details><summary>جواب</summary><b>wear</b></details></li>
<li>We've decided to <b>______</b> the spare room out as an office.<details><summary>جواب</summary><b>kit</b></details></li>
<li>I've been pressed <b>______</b> time all week.<details><summary>جواب</summary><b>for</b> — <span class="why" dir="rtl">حرف اضافه‌ی ثابت؛ نه <bdi>by</bdi>.</span></details></li>
<li>It's been <b>______</b> since I went to a gig. (sl, one word)<details><summary>جواب</summary><b>yonks</b></details></li>
</ol>
<!-- printed sheets show this key instead of the per-item toggles -->
<p class="key">پاسخ‌ها: <bdi dir="ltr">1. sick · 2. wear · 3. kit · 4. for · 5. yonks</bdi></p>
<a class="top" href="#top">↑ بالا</a>
</section>

<section id="pron">
<h2>۹. پیوست تلفظ (<bdi>British IPA</bdi>)</h2>
<p class="note">تقریب فارسی فقط عصاست؛ ملاک <bdi>IPA</bdi> است، چون خط فارسی برای <bdi class="ipa">/æ/</bdi>، <bdi class="ipa">/ə/</bdi> و <bdi class="ipa">/ɜː/</bdi> حرفی ندارد.</p>
<!-- every item on the sheet that has an IPA: core cards first, then the rest -->
<div class="tw"><table>
<tr><th>عبارت</th><th><bdi>IPA</bdi></th><th>تقریب فارسی</th><th>تله</th></tr>
<tr><td dir="ltr"><b>wear and tear</b></td><td dir="ltr" class="ipa">/ˌweər ən ˈteə/</td><td>وِئِر اِن تِئِ</td><td>تله‌ی بزرگ: <bdi>tear</bdi> اینجا با <bdi>wear</bdi> هم‌قافیه است <bdi class="ipa">/teə/</bdi> (پاره شدن) — نه <bdi class="ipa">/tɪə/</bdi> (اشک).</td></tr>
<tr><td dir="ltr"><b>kit sth out / kit sth out with</b></td><td dir="ltr" class="ipa">/ˌkɪt ... ˈaʊt/</td><td>کیت ... آوت</td><td></td></tr>
<tr><td dir="ltr"><b>be pressed for time</b></td><td dir="ltr" class="ipa">/prest fə taɪm/</td><td>پرِست فِ تایم</td><td><bdi>pressed</bdi> یک‌هجایی است: «پرِست» — نه «پرِسِد».</td></tr>
<tr><td dir="ltr"><b>I was about to + verb (… when)</b></td><td dir="ltr" class="ipa">/aɪ wəz əˈbaʊt tə/</td><td></td><td></td></tr>
<tr><td dir="ltr"><b>you can't fault sb/sth</b></td><td dir="ltr" class="ipa">/fɔːlt/</td><td></td><td></td></tr>
<tr><td dir="ltr"><b>manager (pronunciation)</b></td><td dir="ltr" class="ipa">/ˈmænɪdʒə/</td><td></td><td>تکیه روی هجای اول: «مَنیجِ» — معلم سر کلاس اصلاح کرد.</td></tr>
<tr><td dir="ltr"><b>call for sth</b></td><td dir="ltr" class="ipa">/ˈkɔːl fə/</td><td></td><td></td></tr>
<tr><td dir="ltr"><b>a gig (sl)</b></td><td dir="ltr" class="ipa">/ɡɪɡ/</td><td></td><td></td></tr>
<tr><td dir="ltr"><b>a hefty discount</b></td><td dir="ltr" class="ipa">/ˈhefti/</td><td></td><td></td></tr>
</table></div>
<a class="top" href="#top">↑ بالا</a>
</section>
</main>
</body>
</html>
```

## Part 2. The rules behind the document

### 2.1 Skeleton

- `<html lang="fa" dir="rtl">`. Persian is the language of explanation; English is the language of every example.
- `<head>`: charset, viewport, `<title>` = `{lesson title} · {YYYY-MM-DD}`, the fonts link, one inline `<style>`. No scripts and no other external files, so the file works when opened on its own.
- `<body id="top">`: the sticky `<nav>`, then `<main>` holding the `<header>` and the sections. Every section ends with the «↑ بالا» link.
- Header: `<h1>` is the lesson title as taught. First line: institution · course (from the user's settings; leave them out if the app has none), then the Persian weekday and the lesson's own date, Gregorian, in ISO form. Second line: what the lesson covered, in the lesson's own terms. Weekdays, Monday to Sunday: دوشنبه، سه‌شنبه، چهارشنبه، پنجشنبه، جمعه، شنبه، یکشنبه.
- `<p class="note">` is the one callout style. It carries either the key teaching point of a section or a plain statement about the sources ("the audio was only partly usable"). One may open any section; a caveat about the whole sheet goes at the end of the header.

### 2.2 Sections

Fixed order. A section with no content is left out together with its pill, and the sections that remain are numbered consecutively in Persian digits.

| id | pill | heading (after the number) | holds |
|---|---|---|---|
| `core` | `{n} کارت اصلی` | `کارت‌های اصلی (production)` | one numbered entry card per core item, in deck order |
| `oral` | `نکته‌های شفاهی معلم` | `چیزهایی که معلم شفاهی توضیح داد` | unnumbered entry cards for the supplementary items the teacher explained out loud |
| `chunks` | `چانک‌های خط‌کشیده` | `چانک‌های خط‌کشیده + الگوی استفاده` | table of pattern, sentence from the class, usage note; then the equivalences the teacher wrote on the board, as an LTR list |
| `tasks` | `جواب تمرین‌ها` | `جواب تمرین‌ها` | the lesson's exercises, one group each (see 2.3) |
| `mistakes` | `اشتباهات تو` | `اشتباهات تو` | the learner's own mistakes in this lesson: recurring patterns, then spoken mistakes, then written ones (see 2.3 and Part 6) |
| `extra` | `بقیه‌ی عبارت‌ها` | `بقیه‌ی عبارت‌ها (recognition)` | table of the remaining supplementary items: English, meaning, example |
| `register` | `این را بگو/آن را نه` | `این را بگو — آن را نه` | table: ✗ what not to say, ✓ what to say, why |
| `gap` | `جای خالی` | `جای خالی (با جواب پنهان)` | gap-fill drill with hidden answers |
| `culture` | `فرهنگ` | `فرهنگ و زندگی در بریتانیا` | not in the reference; present only when the lesson itself taught something about life in the UK, and built from the same blocks as `tasks` |
| `pron` | `تلفظ` | `پیوست تلفظ (British IPA)` | table of every item on the sheet that has an IPA |

`{n}` is the number of core cards, in Persian digits.

### 2.3 Components

**Entry card** (`article.entry`, in `core` and `oral`). Lines in this order, and a line whose field is empty is left out: heading (the number badge in `core` only, then the English item), pronunciation line, Persian meaning, example sentence, `Collocations:`, 📝 usage note, 🖼️ mental image, `منبع:` where in the lesson the item came from. `oral` cards stop after the 📝 line. The card's `id` is the item's own id.

**Pronunciation line** (`p.pron`): `🔊 {IPA} · {Persian approximation} · ⚠️ {trap}`, with ` · ` only between the parts that exist. Pronunciation appears twice on purpose: under every heading, so the learner never has to scroll away from a word to see how it is said, and collected again in the appendix.

**Tables** always sit inside `div.tw`, so a wide table scrolls within its own box on a phone instead of stretching the page.

**Exercise groups** (`tasks`): an `<h3>` naming the exercise (with the learner's score if known), followed by any of these: a table; Persian text; an English quotation from the lesson (`p.ex`); numbered items (`div.sc`). An item is the prompt, then `✗` the learner's own answer exactly as given (only when it is known), then `✓` a model answer, then an optional Persian line saying what was wrong.

**Gap-fill** (`gap`): the list is `dir="ltr"`. A blank is six underscores in `<b>`. Each answer sits in `<details>` under the summary «جواب», optionally followed by ` — ` and a short Persian reason. `p.key` repeats all the answers in one line; it is hidden on screen and takes the place of the toggles in print.

**Mistakes** (`mistakes`). Four parts, each left out when it has nothing to show:

- A note box: a caveat about the sources, or, when the learner's voice is not verified, this fixed text: «🎙️ اشتباهات گفتاری این جلسه نمایش داده نشده، چون هنوز تأیید نشده کدام صدا مال توست. در اپ صدایت را تأیید کن تا اضافه شود.»
- «الگوهای تکراری»: one `div.sc` per kind of mistake that occurred at least twice. The label and the count, the wrong → right pairs one per line in an LTR paragraph, and a one-line rule.
- «گفتاری (از صدای کلاس)»: spoken mistakes, present only when the voice is verified.
- «نوشتاری (از دست‌خط تو)»: written mistakes.

A mistake is a `div.sc`: `✗` what the learner said or wrote, word for word, with the wrong words in bold; `✓` the corrected version with the fix in bold; a Persian line saying why; and a source line (`p.src`) assembled from fixed parts joined by ` · `: 🎙️ or ✍️ with the kind, «اصلاح معلم» when the teacher corrected it, the time in the recording (`h:mm:ss`) or the name of the written exercise, and «کارت N» linking to the core card when the fix is one of the core items. Kinds and their labels: grammar گرامر, word-choice انتخاب واژه, collocation collocation, preposition حرف اضافه, word-order ترتیب کلمات, pronunciation تلفظ, spelling املا, register لحن.

**Appendix** (last section): core items first, then every other item that has an IPA. The approximation and trap columns are filled where an item has them. The reminder above the table is fixed text.

### 2.4 Direction and mixed text

This is the part that goes wrong most easily. Persian and English are mixed in almost every line, and left to the browser's defaults the punctuation and stress marks land on the wrong side: `ing-` for `-ing`, `.worth + -ing`, a stress mark after its word instead of before it, `۳ — Listening` for `Listening — ۳`. Three rules prevent all of it:

1. **English blocks are `dir="ltr"`**: the item in an entry heading, example sentences, collocations, model answers, quotations, table cells that hold English, the board list, the gap-fill list. `[dir=ltr]` gives them the English typeface and left alignment.
2. **English inside Persian prose is isolated.** Every Persian string (meanings, notes, traps, explanations, headings, Persian table cells, note boxes) goes through one helper that escapes it and wraps each English or IPA run in a bare `<bdi>`. Bare rather than `dir="ltr"`, so the run keeps the Persian typeface. A run that is an IPA token, `/…/`, also gets `class="ipa"`.
3. **The IPA in the pronunciation line and the date in the header** are `<bdi dir="ltr" class="ipa">` and `<bdi dir="ltr" class="date">`. The printed answer key is a `<bdi dir="ltr">` as well.

What the helper does:

- A run never crosses Arabic-script characters, Persian digits, `،` `؛` `؟`, or the guillemets `«` `»`.
- Within a Persian-free stretch, the run reaches from the first Latin letter, digit or currency sign to the last Latin letter or digit. Whatever lies between English words (`→ + = / — ·`) stays inside it. A stretch with no Latin letter in it (a bare number, a dash) is left alone.
- Marks attached to the run stay with it: in front `/`, stress marks, `-`, quotes, currency signs; behind `/`, quotes, `%`, `!`, `?`, `…`, the length mark. A full stop stays only after a phrase of two or more words, or as part of `...`.
- A bracket is taken into the run only when leaving it out would unbalance the run.
- Punctuation that belongs to the Persian sentence stays outside: a colon before the run, a dash after it, an `=` before a Persian gloss.
- `**text**` becomes `<b>text</b>`. Nothing else in a content string is markup; everything is escaped.

Reference implementation. Port it to your language and keep the behaviour:

```python
import html
import re


def E(s):
    """Escape text for an HTML text node."""
    return html.escape(s, quote=False)


# Arabic-script characters (Persian letters, Persian/Arabic digits and punctuation), ZWNJ/ZWJ
# and the Persian guillemets: anything here ends an English run.
_AR = "\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\u200C\u200D"
_BREAK = re.compile("([" + _AR + "\u00AB\u00BB]+)")
# Latin letters (incl. accented), IPA extensions, Greek (theta, beta, chi are used in IPA), phonetic extensions
_LAT = "A-Za-z\u00C0-\u024F\u0250-\u02AF\u0370-\u03FF\u1D00-\u1DBF\u1E00-\u1EFF"
_LATIN = re.compile("[" + _LAT + "]")
_CORE_START = re.compile("[" + _LAT + "0-9\u00A3$\u20AC#@]")   # a run may open with a digit or a currency sign
_CORE_END = re.compile("[" + _LAT + "0-9%]")
# marks that stay attached in front of a run:  /  stress marks  -  ' " opening quotes  currency  # @ ~
_LEAD = set("/\u02C8\u02CC-'\"\u201C\u2018\u00A3$\u20AC#@~")
# marks that stay attached behind a run:  /  ' " closing quotes  %  !  ?  ellipsis  length mark
_TRAIL = set("/'\"\u201D\u2019%!?\u2026\u02D0")
_PAIRS = {"(": ")", "[": "]"}
_IPA = re.compile(r"^/[^/]+/$")


def _isolate_segment(seg):
    """Wrap the English/IPA run of one Persian-free segment in <bdi>, leaving Persian-flow
    punctuation (leading ':' or '(' , trailing ' — ', '=' ...) outside it."""
    if not _LATIN.search(seg):
        return E(seg)
    a = _CORE_START.search(seg).start()
    b = max(m.start() for m in _CORE_END.finditer(seg))
    while a > 0 and seg[a - 1] in _LEAD:
        a -= 1
    changed = True
    while changed:
        changed = False
        while b + 1 < len(seg) and seg[b + 1] in _TRAIL:
            b += 1
            changed = True
        run = seg[a:b + 1]
        # a full stop belongs to the English only when the run is a phrase, not a single word
        dots = re.match(r"\.+", seg[b + 1:])
        if dots and (len(dots.group()) > 1 or re.search(r"\s", run)):
            b += len(dots.group())
            changed = True
            run = seg[a:b + 1]
        for op, cl in _PAIRS.items():
            if run.count(op) > run.count(cl) and seg[b + 1:b + 2] == cl:
                b += 1
                changed = True
            elif run.count(cl) > run.count(op) and a > 0 and seg[a - 1] == op:
                a -= 1
                changed = True
            run = seg[a:b + 1]
    run = seg[a:b + 1]
    cls = ' class="ipa"' if _IPA.match(run) else ""
    return E(seg[:a]) + "<bdi" + cls + ">" + E(run) + "</bdi>" + E(seg[b + 1:])


def fa(text):
    """Persian prose -> safe HTML. Escapes everything, isolates each English/IPA run so that
    punctuation and stress marks stay where they belong, and turns **x** into <b>x</b>."""
    out = []
    for i, part in enumerate(text.split("**")):
        pieces = _BREAK.split(part)
        s = "".join(E(p) if k % 2 else _isolate_segment(p) for k, p in enumerate(pieces))
        out.append("<b>" + s + "</b>" if i % 2 else s)
    return "".join(out)
```

Inputs and the output they must give. Use them as unit tests:

```text
IN   خیلی طبیعی در گفتار؛ to ضعیف است. «I was about to say that!» = از دهانم گرفتی.
OUT  خیلی طبیعی در گفتار؛ <bdi>to</bdi> ضعیف است. «<bdi>I was about to say that!</bdi>» = از دهانم گرفتی.

IN   معلم: You can't fault the teaching.
OUT  معلم: <bdi>You can't fault the teaching.</bdi>

IN   اسمش kit.
OUT  اسمش <bdi>kit</bdi>.

IN   -ing برای چیزی که ناامید می‌کند؛ -ed برای آدمی که ناامید شده.
OUT  <bdi>-ing</bdi> برای چیزی که ناامید می‌کند؛ <bdi>-ed</bdi> برای آدمی که ناامید شده.

IN   worth + -ing.
OUT  <bdi>worth + -ing.</bdi>

IN   Listening — ۳ بخش، ۶ سؤال
OUT  <bdi>Listening</bdi> — ۳ بخش، ۶ سؤال

IN   تکیه روی هجای اول: /ˈmænɪdʒə/ «مَنیجِ» — معلم سر کلاس اصلاح کرد.
OUT  تکیه روی هجای اول: <bdi class="ipa">/ˈmænɪdʒə/</bdi> «مَنیجِ» — معلم سر کلاس اصلاح کرد.

IN   hope → hopes؛ pressed by → pressed for؛ چون پروژه هنوز ادامه دارد، I've got high hopes بهتر است (had = نشد).
OUT  <bdi>hope → hopes</bdi>؛ <bdi>pressed by → pressed for</bdi>؛ چون پروژه هنوز ادامه دارد، <bdi>I've got high hopes</bdi> بهتر است (<bdi>had</bdi> = نشد).

IN   با اسم هر دو ترتیب درست است (kit out the kitchen / kit the kitchen out)، ولی با ضمیر فقط وسط: kit it out — هرگز «kit out it».
OUT  با اسم هر دو ترتیب درست است (<bdi>kit out the kitchen / kit the kitchen out</bdi>)، ولی با ضمیر فقط وسط: <bdi>kit it out</bdi> — هرگز «<bdi>kit out it</bdi>».

IN   با دوستان نگو I was deceived (formal)، بگو I got conned.
OUT  با دوستان نگو <bdi>I was deceived (formal)</bdi>، بگو <bdi>I got conned.</bdi>

IN   آنچه در صوت واضح بود: **Q1 = A، Q2 = A** (کنسرت راک).
OUT  آنچه در صوت واضح بود: <b><bdi>Q1 = A</bdi>، <bdi>Q2 = A</bdi></b> (کنسرت راک).

IN   go back and forth to/between + مکان
OUT  <bdi>go back and forth to/between</bdi> + مکان

IN   یک کاسب متقلب £3,000 cash خواست.
OUT  یک کاسب متقلب <bdi>£3,000 cash</bdi> خواست.

IN   جمله را نیمه‌کاره گذاشت: It's been yonks since... و بعد خندید.
OUT  جمله را نیمه‌کاره گذاشت: <bdi>It's been yonks since...</bdi> و بعد خندید.

IN   Binomials + Hype & Scams
OUT  <bdi>Binomials + Hype &amp; Scams</bdi>
```

### 2.5 Type, colour, numbers, print

- Two typefaces: Vazirmatn for Persian (and for English words inside Persian prose), Lora for English blocks. IPA has its own stack because Lora lacks most IPA letters (ɪ ʊ ɒ ɔ ʃ θ ɡ ɜ ɑ ʌ and the stress marks). Without that stack a transcription is set half in Lora and half in a fallback.
- All colour comes from the tokens at the top of the stylesheet. Light is the default. Dark applies from the OS setting, or when `<html>` carries `data-theme="dark"`; `data-theme="light"` forces light.
- Persian digits for the section numbers and for the card count in the first pill. Latin digits everywhere else: badges, exercise numbers, dates, anything inside English.
- Print: the light palette whatever the theme, no pill bar, no «↑ بالا», cards and table rows not split across pages, the answer key shown.

### 2.6 Inside the app, and as a download

You already show this file in the app and let me download it, and that stays. These are the things that have to hold for the document to behave in the app as it does on its own:

- **One render.** The in-app view and the download come from the same template output. The framed copy may differ only by a `<base>` tag and a `data-theme` attribute (both below).
- **Isolated.** The stylesheet styles bare elements (`nav`, `main`, `h2`, `table`, `details`), sizes in `rem`, and relies on browser defaults for heading sizes, paragraph margins and list numbers. In a document of its own, such as an iframe, it looks exactly like the reference. Injected into the app's DOM, it and the app's CSS will change each other. If the notes are injected today, move them into a frame. If that really is not possible, scope every rule under a wrapper, replace `rem` with a fixed base, restore whatever your reset removes, and show with screenshots that the result equals the reference.
- **Its own scroll.** The pill bar is `position: sticky`, which only works when the notes document itself scrolls. Give the frame the height of the area it sits in. A frame auto-sized to its content never scrolls, so the bar would never stick.
- **Jump links stay inside the notes.** In an `<iframe srcdoc>`, a link such as `href="#tasks"` resolves against the host page and loads the app inside the frame (I checked this in Chromium). Loading the document from a Blob URL or from a route of its own works. So does adding `<base href="about:srcdoc">` to the head of the framed copy. Click every pill and every «↑ بالا» in the app to confirm.
- **Theme.** On its own the file follows the OS setting. If the app has its own light/dark switch, put `data-theme="light"` or `"dark"` on the framed document's `<html>` so the notes follow the app.
- **No scripts.** The document has none, so the frame can be sandboxed without `allow-scripts`. Every string that reaches the template comes from uploads and a model, and is escaped.
- **Download.** The standalone file, named `class-YYYY-MM-DD.html` unless you already have a naming scheme.

## Part 3. What a lesson contains

The pieces of content the document and the cards are built from. Map these onto your own schema and names; what matters is that each piece exists once and both outputs read from it. `?` marks an optional field.

```text
lesson
  date              the lesson's own date, YYYY-MM-DD
  title             the topic as taught: English, or «فارسی · English»
  institution?, course?   from the user's settings
  coverage          one line: what the lesson covered
  source_note?      Persian; a caveat about the inputs that applies to the whole sheet

core[]              10 to 18 items, in deck order  ->  `core` section, production cards, appendix
  id                stable slug
  en                the item with the grammar frame needed to use it: "sick and tired (of + -ing / noun)", "kit sth out"
  ipa               British IPA, with slashes and stress marks
  fa_approx         the pronunciation approximated in Persian script
  trap?             Persian, one line: why the spelling misleads
  fa_meaning        how a Persian speaker would say it
  gap_sentence      an English sentence with the item replaced by ______
  full_sentence     the same sentence, complete
  collocations[]    two or three
  note_fa           usage note
  image_fa          one vivid mental image, one line
  source_fa         where in the lesson it came from: «اسلاید», «تخته + توضیح شفاهی معلم», «جمله‌ی خودت (اصلاح معلم)»
  topic             one or two tag words
  kind?             grammar | collocation | register | pronunciation | british
  a grammar item carries task_fa and prompt in place of gap_sentence; its full_sentence is the corrected form and its note_fa the one-line rule

extra[]             supplementary items  ->  `oral` or `extra` section, recognition cards, appendix
  id, en, fa_meaning, example, topic
  ipa?, fa_approx?, trap?, note_fa?, kind?
  spoken            true when the teacher said it and it was not on the board or slides: `oral`. Otherwise `extra`.

section notes       core_intro?, oral_intro?   Persian text for the note box that opens `core` / `oral`
chunks[]            pattern, class_sentence, note_fa
board[]             equivalences as the teacher wrote them: "a rogue trader = a conman / a scammer / a trickster"
tasks[]             one per exercise: title, then blocks in order
                      table { headers[], rows[][] }  |  text_fa  |  quote_en  |  items[ { prompt, learner_answer?, model, why_fa? } ]
mistakes?           the learner's own mistakes  ->  `mistakes` section
  speech_status     verified | unverified | no_audio      set by Part 6; spoken items are rendered only when verified
  note_fa?          a caveat about the sources of this section
  patterns[]        label_fa, count, examples[] ("pressed by time → pressed for time"), rule_fa
  items[]
    source          speech | handwriting
    said            what the learner said or wrote, word for word, the wrong words marked **like this**
    correct         the corrected version, the fix marked **like this**
    why_fa          one line
    kind            grammar | word-choice | collocation | preposition | word-order | pronunciation | spelling | register
    teacher_corrected   true when the teacher corrected it, in class or in pen on the page
    where?          speech: time in the recording, h:mm:ss. handwriting: the name of the exercise or page
    item_id?        id of the core item whose card teaches the fix
register[]          not_this, say_this, why_fa
gapfill[]           sentence, answer, why_fa?
culture[]?          title, then blocks as in tasks
```

The appendix is not stored. It is computed from `core` and `extra`.

## Part 4. Flashcards

### 4.1 Two sets

- **Core set: production cards.** These are the point of the app. Each one makes the learner recall and produce the English, starting from the Persian meaning and a sentence with a gap. One card per core item, in the order of the `core` section. An item never gets a second card in the other direction.
- **Supplementary set: recognition cards.** English on the front, meaning on the back, for the items in `oral` and `extra`. They are kept apart from the core set (a separate group, toggle or file) and every one carries the tag `recognition`, so that they can all be hidden at once when the deck gets heavy. They are never mixed into the core set.

### 4.2 The two fields

A card is two HTML strings, front and back, built by template from the same items as the notes. Persian lines go through the helper from 2.4; English is escaped. `[ ]` marks a part that is left out when its field is empty.

```text
PRODUCTION
front  <div dir="rtl" style="font-size:1.1em">{fa_meaning}</div><br><div dir="ltr">{gap_sentence, each ______ in <b>}</div>
back   <div dir="ltr"><b style="font-size:1.25em">{en}</b><br><span class="ipa">{ipa}</span><br><br><i>{full_sentence}</i><br><br><b>Collocations:</b> {collocations joined with " · "}</div><br><div dir="rtl">🔊 {fa_approx}[ — ⚠️ {trap}]<br>📝 {note_fa}<br>🖼️ {image_fa}</div>

PRODUCTION, grammar item
front  <div dir="rtl" style="font-size:1.1em">{task_fa}</div><br><div dir="ltr">{prompt}</div>
back   <div dir="ltr"><b style="font-size:1.25em">{full_sentence}</b></div><br><div dir="rtl">📝 {note_fa}</div>

RECOGNITION
front  <div dir="ltr"><b>{en}</b><br><br><i>{example}</i></div>
back   <div dir="rtl" style="font-size:1.1em">{fa_meaning}</div>[<br><div dir="ltr"><span class="ipa">{ipa}</span></div>][<br><div dir="rtl">📝 {note_fa}</div>]
```

A production card from the reference lesson:

```html
<!-- front -->
<div dir="rtl" style="font-size:1.1em">استهلاک؛ ساییدگی و فرسودگی ناشی از استفاده</div><br><div dir="ltr">My paragliding kit is showing a bit of <b>______</b> after three seasons.</div>

<!-- back -->
<div dir="ltr"><b style="font-size:1.25em">wear and tear</b><br><span class="ipa">/ˌweər ən ˈteə/</span><br><br><i>My paragliding kit is showing a bit of wear and tear after three seasons.</i><br><br><b>Collocations:</b> normal/general wear and tear · show signs of wear and tear · the warranty doesn't cover wear and tear</div><br><div dir="rtl">🔊 وِئِر اِن تِئِ — ⚠️ تله‌ی بزرگ: <bdi>tear</bdi> اینجا با <bdi>wear</bdi> هم‌قافیه است <bdi class="ipa">/teə/</bdi> (پاره شدن) — نه <bdi class="ipa">/tɪə/</bdi> (اشک).<br>📝 غیرقابل‌شمارش: «<bdi>a wear and tear</bdi>» غلط است. در قرارداد اجاره و گارانتی زیاد می‌بینی.<br>🖼️ بالِ پاراگلایدرت که لبه‌اش ساییده و کمی «پاره» (<bdi>tear</bdi>) شده.</div>
```

A grammar item (front is a small task in Persian, back is the corrected form and the one-line rule):

```html
<!-- front -->
<div dir="rtl" style="font-size:1.1em">جمله را با ضمیر <bdi>it</bdi> بازنویسی کن:</div><br><div dir="ltr">We need to kit out the new office.</div>

<!-- back -->
<div dir="ltr"><b style="font-size:1.25em">We need to kit it out.</b></div><br><div dir="rtl">📝 با ضمیر، مفعول همیشه وسطِ <bdi>phrasal verb</bdi> جداشدنی می‌آید: <bdi>kit it out</bdi> — نه «<bdi>kit out it</bdi>».</div>
```

A recognition card:

```html
<!-- front -->
<div dir="ltr"><b>you can't fault sb/sth</b><br><br><i>You can't fault the museum — every exhibition is worth going to.</i></div>

<!-- back -->
<div dir="rtl" style="font-size:1.1em">هیچ ایرادی نمی‌شود به … گرفت</div><br><div dir="ltr"><span class="ipa">/fɔːlt/</span></div><br><div dir="rtl">📝 معلم: <bdi>You can't fault the teaching.</bdi></div>
```

### 4.3 The faces in the app

Your flashcard screen keeps its chrome. What has to match is the inside of a face:

- Render the two strings as they are, inside a container with these rules. Colours come from your own theme.

```css
.fc-face{font-family:Vazirmatn,Tahoma,sans-serif;font-size:20px;line-height:1.7;text-align:center}
.fc-face [dir=ltr]{font-family:Lora,Georgia,Vazirmatn,Tahoma,serif}
.fc-face .ipa{font-family:"Noto Serif","Charis SIL","Gentium Plus","Times New Roman","DejaVu Serif",serif}
.fc-face hr{border:0;border-top:1px solid currentColor;opacity:.15;margin:1em 0}
```

- The front shows only the front, and nothing on it gives the answer away: no first letter, no hint, no `title` or `alt` carrying the item.
- After reveal, show the front again, then a rule, then the back, as Anki's Basic note type does. The learner compares the gap sentence with the full one.
- The order on the back is fixed: the item in bold, its IPA, the full sentence in italics, the collocations, then the Persian block with 🔊 pronunciation, 📝 note and 🖼️ image.
- If you sanitise card HTML, the tags in use are `div br b i span bdi hr`, with `dir`, `class="ipa"` and `style="font-size:…"`.

### 4.4 Anki export

The same two strings are what goes to Anki. One UTF-8 text file per set, `class-YYYY-MM-DD.txt` for the core set and `class-YYYY-MM-DD-extra.txt` for the supplementary set, starting with exactly these five lines and then one line per card:

```text
#separator:tab
#html:true
#notetype:Basic
#deck:Claude ESOL class
#tags column:3
<div dir="rtl" style="font-size:1.1em">استهلاک؛ ساییدگی و فرسودگی ناشی از استفاده</div><br><div dir="ltr">My paragliding kit is showing a bit of <b>______</b> after three seasons.</div><TAB><div dir="ltr"><b style="font-size:1.25em">wear and tear</b><br><span class="ipa">/ˌweər ən ˈteə/</span><br><br><i>My paragliding kit is showing a bit of wear and tear after three seasons.</i><br><br><b>Collocations:</b> normal/general wear and tear · show signs of wear and tear · the warranty doesn't cover wear and tear</div><br><div dir="rtl">🔊 وِئِر اِن تِئِ — ⚠️ تله‌ی بزرگ: <bdi>tear</bdi> اینجا با <bdi>wear</bdi> هم‌قافیه است <bdi class="ipa">/teə/</bdi> (پاره شدن) — نه <bdi class="ipa">/tɪə/</bdi> (اشک).<br>📝 غیرقابل‌شمارش: «<bdi>a wear and tear</bdi>» غلط است. در قرارداد اجاره و گارانتی زیاد می‌بینی.<br>🖼️ بالِ پاراگلایدرت که لبه‌اش ساییده و کمی «پاره» (<bdi>tear</bdi>) شده.</div><TAB>2026-10-05 cambria binomials production
```

- Three columns per line, separated by a tab: front, back, tags. `<TAB>` above stands for a real tab character.
- A field never contains a tab or a line break. Line breaks inside a field are `<br>`. A stray tab shifts the columns, and the card is imported wrong or not at all.
- Tags are separated by spaces and contain none: the lesson date, the course tag, one or two topic words, an optional kind (`grammar`, `collocation`, `register`, `pronunciation`, `british`), and last `production` or `recognition`.
- The deck name and the course tag are per user. Mine are `Claude ESOL class` and `cambria`.
- If the app has no Anki export yet, add it next to the existing download only if that is a small step. Otherwise tell me and leave it.

## Part 5. How the content is written

These rules belong in the generation prompt and the schema descriptions, not in the renderer.

### 5.1 What gets selected

- Where items come from, most valuable first: what the teacher explained out loud and never wrote down; corrections of the learner's own sentences; the board and slides; what the learner underlined on the handout; the wording of quiz questions and task instructions.
- The core set holds at most 10 to 18 items, and fewer when the lesson offers fewer good ones. Prefer multi-word phrases and collocations to single words, language usable in everyday, work and social English, and grammar points with a pattern that can be tested. Leave out what an A2 learner already knows, proper nouns, one-off technical terms, and anything whose meaning is not clear from the sources.
- Everything else worth keeping goes to the supplementary set. A long lesson makes a long supplementary set, never a long core set. A deck that is too big to review does more harm than a short one.
- A word that cannot be read or heard is never guessed. Say what was unreadable.

### 5.2 A production card

- `fa_meaning`: how a Persian speaker would actually say it, not a dictionary gloss.
- The sentence: the teacher's or the class's own sentence whenever a source has one, because those are the ones the learner remembers. Otherwise a natural sentence set in the learner's own life, taken from whatever the app knows about them (for my account: Wrexham in North Wales, a web-design and AI-consulting business with clients, paragliding). If the app knows nothing about the learner, use ordinary daily life in the UK; this does not need a new profile feature. Between 8 and 15 words, British English, and the item is the only thing in it the learner might not know.
- `gap_sentence` is `full_sentence` with the whole item replaced by one `______`. A separable phrasal verb gets one blank per part: `we need to ______ it ______.`
- `en` carries the grammar frame needed to use the item: `(of + -ing / noun)`, `sb/sth`.
- Collocations: two or three, the frequent ones.
- `note_fa`: one to three sentences on register (formal, neutral, slang), nuance, the mistake a Persian speaker typically makes, and what the teacher said about it. When the item comes from the learner's own mistake, say what the mistake was.
- `image_fa`: one concrete picture in one line, from the learner's own world where possible. It is a memory hook, not a definition.

### 5.3 Pronunciation

- British (RP) IPA on every item: non-rhotic, with stress marks, and with weak forms where they are natural (`/ən/` for *and*).
- `fa_approx` on every core item, in Persian script with vowel marks.
- `trap` only where the spelling misleads: unexpected stress, a silent letter, an unexpected sound for g, c, th, ti or ci, a misleading homograph (the *tear* in *wear and tear*), a word the learner mispronounced in class.

### 5.4 The notes

- Persian explains, English exemplifies. An English example is never translated or transliterated.
- The learner is addressed as «تو», plainly and directly.
- `chunks` gives the usage pattern (preposition, verb form, word order, register) rather than the meaning.
- `tasks` answers the lesson's own exercises, with model answers at C1 level. Where the learner's own answer is known, it is shown word for word, then the corrected version, then the reason.
- `register` pairs what a learner is likely to say with what a native speaker would say, and includes register warnings, such as slang in a formal email. A mistake the learner actually made in this lesson belongs in `mistakes` and is not repeated here.
- `gap` has 8 to 12 new sentences that test the lesson's items. They are not copies of the card sentences. Answers are one word unless the sentence says otherwise.
- When the audio was unusable, a photo unreadable, or an answer could not be recovered, a note says so at the place where it matters. Nothing is invented to make a section look complete, and an empty section is left out.

### 5.5 The learner's mistakes

- Only the learner's own production counts: what they said in their own words, and what they wrote by hand. Not a classmate's sentence, not the teacher's, not printed text. A sentence the learner only read aloud from the handout can yield a pronunciation mistake and nothing else.
- Quote, don't tidy. `said` is the shortest stretch that shows the mistake in context, exactly as it was said or written. One entry per mistake; two unrelated mistakes in one sentence are two entries.
- Neither source is ground truth, so a mistake needs evidence. Speech recognition mishears accented speech in a noisy room, and it also quietly repairs grammar. Handwriting gets misread.
  - A spoken mistake is kept when at least one of these holds: the teacher corrects or rephrases it in the turns that follow; the same mistake occurs again elsewhere in the lesson; the same mistake is in the learner's handwriting; a second, independent listen to that clip (re-transcribing the 10 to 20 seconds on their own, or an audio-capable model asked "what exactly was said?") gives the same words.
  - A written mistake is kept when the reading of the words involved is certain. A mistake that hinges on one doubtful letter is dropped. A correction in the teacher's pen is the strongest evidence there is.
  - A pronunciation mistake is kept when the teacher corrected it, or when the recogniser heard a different word in the same place at least twice (*fill* for *feel*).
- Self-corrections in the same breath, hesitations, fillers and false starts are not mistakes.
- At most about 15 entries per lesson. When there are more, keep the ones the teacher corrected, the ones that recur, and the ones tied to this lesson's items.
- A pattern is listed when the same kind of mistake occurs at least twice in the lesson, counting speech and handwriting together.
- When the fix for a mistake is a phrase or pattern worth keeping, it should be a core item (5.1), and the mistake links to it through `item_id`.
- The tone is matter-of-fact. No scolding and no consolation.

## Part 6. Whose voice is it

A class recording has the teacher, the learner and several classmates on it. «اشتباهات تو» is only worth having if every spoken mistake in it really is the learner's; a classmate's mistake shown as mine is worse than an empty section. So one rule governs this whole part: **no verified voice, no spoken mistakes.** What follows is a proposed design. Fit it to the transcription setup you already have, and tell me where you departed from it.

### 6.1 The pipeline

1. **Who spoke when.** Transcription has to return time-stamped segments labelled by speaker for the whole recording (diarization). If the recording is processed in chunks, a label must mean the same person in every chunk. Most services number speakers afresh on each request, so either diarize the file in one job or re-link the chunks by voice (step 3).
2. **A sample of the learner's voice.** Once, in their profile, the learner records about 30 seconds of ordinary speech in English: a short passage to read, then two or three sentences of their own. Ask for it on the phone they record classes with. Keep the audio itself and not only the numbers derived from it, so that the voiceprint can be rebuilt if the model changes. The sample is optional; without it, step 4 does the job on the first lesson.
3. **Match.** For each speaker in the recording, pool their clean speech (skip overlapping speech and segments under about two seconds, and aim for 20 seconds or more per speaker), turn it into a speaker embedding, and compare it with the learner's. Rank the speakers. Accept the top one automatically only when its score is above an accept threshold and clearly ahead of the runner-up. Anything else is a candidate, not an answer. Thresholds depend on the embedding model, so don't take numbers from a paper: log the scores of the candidates the learner confirms and rejects in step 4, and set the thresholds from those.
4. **Ask.** Play the learner three short clips of the top candidate (6 to 10 seconds each, from different parts of the lesson, one voice only, with the words shown) and ask «این صدای توست؟». On «نه», offer the other speakers with one clip each, and a «هیچ‌کدام» choice. Always ask on the first lesson, and whenever step 3 did not accept automatically. Keep an «این صدای من نیست» action on the lesson afterwards, because an automatic accept will sometimes be wrong.
5. **Learn.** Every confirmed lesson adds that speaker's embedding to the learner's set; keep the most recent few. Class recordings are better enrolment material than the profile sample, since they come from the same room, the same phone and the same distance.
6. **Check each utterance.** Diarization slips at turn boundaries and when people talk over each other. Before an utterance is used as evidence of a mistake, it has to be labelled as the learner, be at least about two seconds long or sit between other learner segments, and not overlap another speaker. When in doubt, leave it out.

### 6.2 Supporting clues

These rank candidates and back up a match. None of them decides anything alone.

- The teacher says the learner's name just before the turn.
- The speaker says something only the learner would: their job, their town, something from their profile.
- The speaker says aloud a sentence that is in the learner's handwriting in the photos.
- The learner's phone made the recording, so the learner is usually the closest and loudest voice. Pair work puts a classmate just as close.
- The teacher is the speaker with the most talking time and the classroom language ("turn to page…", "well done"). Knowing who the teacher is also tells you when a correction came from the teacher.

### 6.3 What the document shows

- **verified**: the learner confirmed the voice for this lesson, or step 3 accepted automatically against a voiceprint the learner has confirmed before. Spoken mistakes are shown.
- **unverified**: there is a candidate and no confirmation. Work out the spoken mistakes for the candidate and store them, but keep them out of the document. The section carries the fixed note from 2.3, and the app asks the learner to confirm. Confirming reveals them without regenerating anything. «نه» discards them and they are worked out again for the right speaker.
- **no audio**, or a transcript without its audio: with a speaker-labelled transcript, show three or four lines from each speaker and let the learner pick. With no speaker labels, there are no spoken mistakes.

### 6.4 Handwriting

The same question on a smaller scale. A photo of a handout holds print, the learner's writing, and often the teacher's corrections in another pen. Read them as three separate things: print is never the learner's, the teacher's marks are evidence rather than mistakes, and only the learner's own writing is analysed. Transcribe it as written, mark what cannot be read as unreadable, and never fill a gap with a guess. Writing on the board is the teacher's.

### 6.5 Privacy

A voiceprint used to recognise a person is biometric data. Under UK GDPR that is special category data, and the regulator's guidance points to explicit consent as the usual basis. So:

- Ask before recording the sample, and say what it is for.
- Store the sample and the voiceprint per user. Delete both on request and with the account.
- The feature is optional. Everything else in the app works without it.
- For everyone else on the recording: no voiceprint outlives the processing of that lesson, nothing they said is shown as a mistake, and nothing about them is stored as a profile.

### 6.6 Tools

Use what your transcription provider already offers before adding anything. Two examples, checked against their documentation in October 2026; check again before relying on them:

- OpenAI `gpt-4o-transcribe-diarize` returns speaker-labelled segments (`response_format: "diarized_json"`; `chunking_strategy` is required above 30 seconds) and accepts up to four known speakers as reference clips of 2 to 10 seconds (`known_speaker_names[]`, `known_speaker_references[]`). Sending the learner's clip with every chunk is the obvious way to keep the learner's label stable across chunks; test that it does. Files are limited to 25 MB.
- pyannoteAI has `POST /v1/voiceprint` (a sample of at most 30 seconds, one voice only) and `POST /v1/identify`, which diarizes a recording and returns a 0 to 100 confidence for each speaker against each voiceprint. It deletes job outputs after 24 hours, so the voiceprint has to be stored on your side.

If you compute embeddings yourself, the usual open-source routes are SpeechBrain's ECAPA-TDNN speaker model and pyannote.audio; WhisperX combines Whisper with pyannote diarization and word-level timestamps.

## Done when

1. A fixture lesson carrying the reference content renders to a document with the reference stylesheet and the same elements, classes, attributes and order as Part 1 (comments and whitespace aside).
2. Removing a section's content removes the section and its pill, and renumbers the rest.
3. The helper passes the inputs and outputs in 2.4 as unit tests.
4. At 420px wide the page does not scroll sideways; the pill bar and each table scroll within themselves.
5. In the app the pill bar stays pinned while the notes scroll, every pill brings its heading into view just below the bar, «↑ بالا» returns to the top, and none of them navigates the app.
6. Light and dark both look right, and the notes follow the app's theme.
7. The downloaded file opens on its own, with nothing from the app, and looks the same as the in-app view. Its print preview is light, has no pill bar, and shows the answer key.
8. The `core` section of the notes and the production cards are the same items with the same field values. A card front never contains its item. A revealed card shows front, rule, back.
9. Each Anki file starts with the five header lines, every later line has exactly three tab-separated columns, and no field contains a tab or a line break.
10. Lessons created before this change still open.
11. With no verified voice, the document contains no spoken mistakes and shows the withheld note. Confirming a voice reveals them, and answering «نه» never leaves another speaker's sentences in the section.
12. On a recording where the learner is not the main speaker, the right voice is found or the app asks. Tell me how many lessons you tried it on and how often the first candidate was the right one.
13. Deleting the voice sample removes the sample and everything derived from it.

## Report back

- What you changed, by area.
- Anything in this brief you did not apply, and why.
- What you verified by running it, and what you could not verify.
- Screenshots: the notes in the app at phone width, light and dark, and a production card before and after reveal.
- For Part 6: which steps exist, which are stubbed, which provider or model does the diarization and the matching, and the match scores you observed.
- Any question that needs my decision.
