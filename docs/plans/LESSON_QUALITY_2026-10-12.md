# کیفیت جزوه و عکس تخته — گزارش پیاده‌سازی (Workstream 3، 2026-10-12)

> **شاخه:** `feat/lesson-quality` · **مبنا:** `43f12a9` (`main` @ `b4aa3d5` + سند [علت پنج مشکل](FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)، بخش ۵).
> **تصمیم‌ها:** D62 و D63 (تصمیم مالک محصول 2026-10-12، ثبت مدیر کار در شاخهٔ `claude/gifted-franklin-7ecldm`)، D56، D49، D46، D58، D17.
> **وضعیت ارزیابی زنده:** اجرا شد (2026-10-12 و 2026-10-13، ۱٫۲۱۴۹ دلار از سقف ۱٫۵۰). نتیجه در بخش ۹.۳.

## ۱. خلاصه

| # | کار | نتیجه | پرچم و پیش‌فرض |
|---|---|---|---|
| 1 | بودجهٔ درس متناسب با محتوا (D62) | سقف آیتم از سقف واقعی خروجی مدل و حجم واقعی محتوا؛ حالت فشرده فقط وقتی مدل جا ندارد | `lessonQuality.budget = "lesson-budget-1"` در نسخهٔ تازهٔ تنظیمات `openrouter-2026-10-12-1` و prompt `recalino-knowledge-11`. production تا تغییر env رفتار قبلی را دارد |
| 2 | نقشهٔ درس و پوشش هر منبع | هر منبعِ دارای متن یا ارجاع می‌گیرد یا با کد دلیل «استفاده نشد» ثبت می‌شود؛ ذخیره در `coverage.sources`؛ نمایش در جزوه | `lessonQuality.sourceCoverage` |
| 3 | خواندن ساختاری عکس تخته | بلوک‌های نوع‌دار، ترتیب خواندن و نشان عدم قطعیت؛ ورودی تولید درس | `lessonQuality.structuredBoard`، و `boardVisionModel` اختیاری (خالی) |
| 4 | خواندن موازی عکس و صفحهٔ PDF | تا ۴ فراخوان هم‌زمان با `callFits`، checkpoint و idempotency | ثابت کد `VISION_CONCURRENCY = 4` (بدون تصمیم مالک؛ فاز ۰ سند علت) |
| 5 | کلاس بلند (D63) | تولید جدا برای هر بخش ≤ ۹۰ دقیقه و ادغام قطعی بدون آیتم تکراری؛ بدون کسر سهمیهٔ اضافه | `lessonQuality.classPartMinutes` (در نسخهٔ پیشنهادی خالی است؛ مقدار پیشنهادی ۹۰) |
| 6 | بن‌بست بازبینی درس | علت تأیید شد: `lesson_review_input_too_large`؛ قالب فشردهٔ جایگزین و پیام روشن بدون دکمهٔ بی‌نتیجه | همیشه فعال (رفع باگ) |
| 7 | ارزیابی | آفلاین با provider مصنوعی؛ ابزار زنده با سقف سخت ۱٫۵ دلار | — |
| 8 | حافظهٔ آموزشی | دست نخورد: `TEACHING_MEMORY_IN_GENERATION=false` (D49) | — |

## ۲. بودجهٔ درس (D62)

- **علت تأییدشده در کد:** worker مقدار سطح بالای `maxOutputTokens: 6144` را به سازندهٔ prompt می‌داد و prompt از آن «حداکثر ۴ آیتم تولیدی و ۲ تشخیصی» و حالت فشرده می‌ساخت؛ override مدل Gemini (۳۲۰۰۰) فقط برای درخواست API به کار می‌رفت.
- **اصلاح:** [`lesson-budget.ts`](../../packages/core/src/proc/lesson-budget.ts) (`lesson-budget-1`):
  - اندازهٔ واقعی محتوا: دقیقه‌های گفتار رونویسی‌شده (نه مدت اعلام‌شده)، صفحه‌های PDF دارای متن، عکس‌های دارای متن، و متن تایپی به معادل صفحه.
  - آیتم تولیدی = `min(18, 4 + ⌊دقیقهٔ گفتار/8⌋ + 2 × (عکس + صفحه + صفحهٔ متن))`، و محدود به ظرفیت مدل `⌊سقف خروجی مدل/1280⌋`.
  - آیتم تشخیصی = `min(6, ⌊سقف/3072⌋, ⌈تولیدی/3⌉)`؛ ادعای تکمیلی تا ۸.
  - حالت فشرده فقط وقتی ظرفیت مدل کمتر از نیاز محتواست. نمونه‌ها: یک عکس ← ۶+۲؛ ۲۵٫۵ دقیقه + ۵ عکس ← ۱۷+۶؛ ۱۲۸ دقیقه ← ۱۸+۶.
- **worker** ([`worker.ts`](../../packages/core/src/proc/worker.ts)، بخش lesson stage): وقتی snapshot دارای `lessonQuality` است، سقف مؤثر مدل (`effectiveStructuredMaxOutputTokens`) و بودجهٔ محاسبه‌شده به [`knowledge-generation.ts`](../../packages/core/src/proc/knowledge-generation.ts) می‌رسد. بازیابی فشرده پس از truncation همان بودجهٔ ثابت ۲۰۴۸ را دارد.
- **snapshotهای قدیمی:** بدون `lessonQuality` دقیقاً prompt و wire قبلی را دارند (آزمون: `lesson-quality.test.ts`، «keeps the legacy 6144 planning limits»).
- **تنظیمات:** [`config/openrouter-defaults.json`](../../config/openrouter-defaults.json) نسخهٔ `openrouter-2026-10-12-1` و prompt `recalino-knowledge-11` را با بلوک `lessonQuality` دارد. env در production تغییر نکرده است.

## ۳. نقشهٔ درس و پوشش منبع

- هر منبع در ورودی مدل یک `sourceKey` (مثل `s2`) می‌گیرد. wire یک فیلد اختیاری `unusedSources: [{source, reason}]` دارد با کدهای `unreadable`، `duplicate`، `off_topic`، `outside_selection`، `no_teaching_content`.
- سرور بررسی می‌کند هر منبعِ دارای ردیف قابل ارجاع، در `lessonPlan`، ادعا، تخته یا اشتباه نوشتاری ارجاع گرفته یا در `unusedSources` آمده باشد. در غیر این صورت پاسخ اول با `source_coverage_missing` رد می‌شود و همان **یک** تولید دوبارهٔ موجود با راهنمای ثابت انجام می‌شود. در تولید دوباره، منبع گزارش‌نشده با دلیل سروری `not_reported` ثبت می‌شود تا درس به‌خاطر فراموشی فهرست شکست نخورد.
- ذخیره: `coverage.sources` در [`lkm/schema.ts`](../../packages/core/src/lkm/schema.ts)، اختیاری و سازگار با نسخه‌های قبلی. wireهای قدیمی (`legacyKnowledgeWireSchema` و repair قدیمی) همان `coverageBaseSchema` قبلی را دارند.
- نمایش: [`NoteView.tsx`](../../apps/web/src/ui/workspace/NoteView.tsx) فهرست «Material not used in these notes» را با نام فایل و دلیل نشان می‌دهد (متن‌ها در انتظار تأیید؛ بخش ۸).
- محدودیت: پوشش منبع فقط روی قرارداد content (مسیر Gemini در production) اعمال می‌شود، نه مسیر قدیمی Haiku.

## ۴. خواندن ساختاری عکس تخته

- با `structuredBoard`، مدل بینایی برای عکس و صفحهٔ اسکن‌شده بلوک‌هایی با `type` (heading، list_item، table، relation، example، correction، text) و `uncertain` برمی‌گرداند. ترتیب آرایه همان ترتیب خواندن است.
- در `src.content_version` فیلد اختیاری `layout: {type, order, uncertain?}` روی هر بلوک ذخیره می‌شود ([`src/service.ts`](../../packages/core/src/src/service.ts)). متن بلوک همان خوانش دقیق است؛ ردیف‌های قدیمی بدون `layout` معتبرند. migration لازم نیست، چون `blocks` از نوع jsonb است و اعتبارسنجی در کد انجام می‌شود.
- ساختار به‌عنوان metadata ردیف به مدل درس می‌رسد و prompt می‌گوید ترتیب، رابطه و جدول را با هم نگه دارد، تصحیح را تصحیح آموزش دهد و هیچ کارتی را فقط روی خوانش نامطمئن نسازد.
- `boardVisionModel` اختیاری فقط برای عکس‌ها به کار می‌رود (نه صفحهٔ PDF)، به‌جز عکسی که نقشش `user_notes` است. چون نوع عکس فقط پس از خود فراخوان بینایی معلوم می‌شود، «فقط عکس تخته» بدون فراخوان دوم ممکن نیست (پرسش ۳).
- قواعد داده‌ی نامطمئن: متن تصویر همچنان داده است، نه دستور؛ هیچ HTML یا کدی اجرا نمی‌شود.

## ۵. خواندن موازی

- عکس‌ها: وقتی worker به اولین عکس خوانده‌نشده می‌رسد، همهٔ عکس‌های بعدی خوانده‌نشده را با حداکثر ۴ فراخوان هم‌زمان می‌خواند. هر فراخوان فقط وقتی شروع می‌شود که `callFits` اجازه دهد، step جدا (`vision:<id>`) و checkpoint (`source:<id>`) خودش را دارد و پس از خطا فراخوان تازه‌ای شروع نمی‌شود. سپس job ادامه را به job بعد می‌سپارد.
- صفحه‌های PDF: صفحه‌های رندرشده به همین شکل موازی خوانده می‌شوند.
- آزمون موجود «OCRs only selected PDF pages with the batch renderer» یک تماس در هر job را فرض می‌کرد. انتظارش به رفتار تازه تغییر کرد (۳ صفحهٔ رندرشده در job اول، صفحهٔ ۵ در job بعد)؛ مجموع فراخوان‌ها، batchها، حذف تصویرها و کسر سهمیه همان قبلی است.

## ۶. کلاس بلند (D63)

- [`knowledge-parts.ts`](../../packages/core/src/proc/knowledge-parts.ts): صوت‌های کلاس پشت سر هم یک خط زمانی می‌سازند و به بخش‌های مساوی حداکثر `classPartMinutes` تقسیم می‌شوند (۱۲۸ دقیقه ← دو بخش ۶۴ دقیقه‌ای). عکسِ دارای captureAnchor به بخش همان لحظه می‌رود؛ بقیهٔ منبع‌های غیرصوتی به بخش اول.
- هر بخش بودجهٔ خودش را دارد، یک تولید پولی و حداکثر یک تولید دوباره (`knowledge:part:<n>` و `knowledge:part:<n>:repair`، هر دو `singleResponse`)، و هر پاسخ پیش از فراخوان بعد checkpoint می‌شود.
- ادغام با کد: هر هدف یک بار، آیتم‌ها به نوبت از بخش‌ها تا سقف ۱۸+۶، ادعاها و فعالیت‌ها بدون تکرار، و پوشش منبع «استفاده‌شده در هر بخش». سپس اعتبارسنجی کامل روی همهٔ منبع‌ها.
- سهمیه یک بار هنگام انتشار کسر می‌شود (آزمون integration: ۷۶۸۰ ثانیه برای ۱۲۸ دقیقه).
- **تعارض D17:** D63 آن را حل کرده است؛ این شاخه `docs/PRODUCT_DECISIONS_LOG.md` را تغییر نمی‌دهد.

## ۷. بازبینی درس (رفع بن‌بست 400)

- **علت از کد:** `scheduleLessonReview` پیش از رزرو، `buildLessonReviewInput` را اجرا می‌کند. اگر ورودی + system prompt از `maxInputCharacters` (۱۲۰۰۰۰) بیشتر باشد، `validation_failed` با `review: ["lesson_review_input_too_large"]` و HTTP 400 برمی‌گردد. قالب قدیمی برای هر بلوک شواهد شناسهٔ منبع، نسخه و شیء locator را تکرار می‌کرد (حدود ۲۵۰ نویسه سربار برای هر بخش رونویسی) و کل متن درس را یک بار دیگر به‌عنوان target می‌فرستاد. برای کلاس ۲۵ دقیقه + ۵ عکس، فقط سربار از سقف می‌گذشت. UI این خطا را «request could not be confirmed» نشان می‌داد و دکمهٔ Retry می‌گذاشت: بن‌بست.
- **اصلاح:** [`eval/lesson-review.ts`](../../packages/core/src/eval/lesson-review.ts) وقتی قالب قدیمی جا می‌شود همان را می‌فرستد (prompt ارزیابی‌شده). در غیر این صورت قالب `lesson_review_compact_v1` با کلیدهای شواهد و شناسه‌های target یکسان می‌فرستد، پس گزارش‌های ذخیره‌شده همچنان معتبرند. اگر حتی قالب فشرده جا نشود، [`LessonReview.tsx`](../../apps/web/src/ui/workspace/LessonReview.tsx) پیام روشن `lessonQuality.review.tooLarge` را نشان می‌دهد و هیچ دکمهٔ درخواست یا Retry نمی‌گذارد.
- محدودیت: کلاس ۱۲۸ دقیقه‌ای حدود ۹۰ هزار نویسه متن خالص دارد و ممکن است حتی در قالب فشرده جا نشود؛ آنجا پیام روشن نمایش داده می‌شود (پرسش ۵).

## ۸. متن‌های رابط (D65)

هشت متن تازه در [`lesson-quality-copy.ts`](../../apps/web/src/ui/workspace/lesson-quality-copy.ts) و بخش «Workstream 3» در [`UI_COPY_PENDING.md`](../design/UI_COPY_PENDING.md) ثبت شده‌اند و از `pending-copy.ts` می‌آیند. هیچ‌کدام تأییدشده علامت نخورده‌اند. فقط کامپوننت‌ها و کلاس‌های موجود (`styles.issues`، `QuietLink`، `Status`) به کار رفته‌اند. تصویرهای ۳۹۰ و ۱۴۴۰ پیکسلی در بخش ۱۱ فهرست شده‌اند.

## ۹. ارزیابی

### ۹.۱ آفلاین (provider مصنوعی، fixture مصنوعی)

- [`tools/eval/lesson-quality-eval.ts`](../../tools/eval/lesson-quality-eval.ts): مسیر content کارگر را تکرار می‌کند (یک تولید و حداکثر یک تولید دوباره، بازیابی فشرده، بخش‌ها و ادغام) و سنجه‌ها را حساب می‌کند: آیتم تولیدی و تشخیصی، **درصد پوشش منبع**، **آیتم در هر ساعت گفتار**، **توکن خروجی**، هزینه و زمان.
- [`lesson-quality-fixtures.ts`](../../tools/eval/lesson-quality-fixtures.ts): کلاس مصنوعی ۱۲۸ دقیقه‌ای با دو عکس تخته (یکی با anchor در دقیقهٔ ۱۱۰)، و کلاس ۱۵ دقیقه‌ای با سه عکس تختهٔ ساختاری و یک عکس نامرتبط.
- [`lesson-quality-eval.test.ts`](../../tools/eval/lesson-quality-eval.test.ts): production ۴ آیتم تولیدی برای ۱۲۸ دقیقه، نامزد ۱۸ در دو بخش؛ عکس نامرتبط با `off_topic`؛ توقف پیش از فراخوانی که از سقف بگذرد.

### ۹.۲ ارزیابی زندهٔ پولی (D62)

- دستور: `pnpm exec tsx tools/eval/lesson-quality-live.ts --run-live` (کلید از `OPENROUTER_API_KEY` محیط؛ چاپ یا ذخیره نمی‌شود).
- دامنه: ۱۴ درس holdout-5 (۱۲ درس، S03 و S10 دو بار)، سپس اگر سقف اجازه دهد کلاس ۱۲۸ دقیقه‌ای (D63) و درس عکس تخته.
- دو بازو: production (`openrouter-2026-10-10-1`، `recalino-knowledge-10`) و نامزد (`openrouter-2026-10-12-1`، `recalino-knowledge-11`؛ برای کلاس بلند با `classPartMinutes: 90`).
- **سقف سخت ۱٫۵۰ دلار در کد:** پیش از هر فراخوان، هزینهٔ واقعی تا آن لحظه به‌اضافهٔ بدترین هزینهٔ فراخوان بعد (نویسه‌های درخواست × ۱٫۳۵ دلار در میلیون + ۳۲۰۰۰ توکن × ۶٫۷۵ دلار در میلیون، گران‌ترین قیمت ZDR در D56) نباید از سقف بگذرد. هزینهٔ نامعلوم بدترین حالت حساب می‌شود.
- برآورد پیش از اجرا: D56 حدود ۰٫۰۲۴ دلار برای هر درس production؛ نامزد به نسبت خروجی بیشتر حدود ۰٫۰۴ تا ۰٫۰۸ دلار؛ مجموع ۱۴ درس دو بازو حدود ۰٫۹ تا ۱٫۲ دلار.

نتیجه: بخش ۹.۳.

### ۹.۳ نتیجهٔ اجرا

- **اجرا:** `pnpm exec tsx tools/eval/lesson-quality-live.ts --run-live`، کد `94254d4`، شروع 2026-10-12 ساعت 22:28 UTC. ۳۶ فراخوان، **۱٫۲۱۴۹ دلار** از سقف سخت ۱٫۵۰ دلار. هیچ فراخوانی با نتیجهٔ نامعلوم نبود. شواهد: `artifacts/verification/feat-lesson-quality/d62-eval/` (`results.json`، درس‌ها، بسته‌های کور، `key.json`).
- **جدول ۱۴ درس holdout-5** (مسیر content، Gemini 3.8 Flash، همان ابزار برای هر دو بازو):

  | سنجه | production (`openrouter-2026-10-10-1`) | نامزد (`openrouter-2026-10-12-1`) |
  |---|---:|---:|
  | خروجی معتبر | 14 از 14 | 14 از 14 |
  | معتبر در تلاش اول | 13 از 14 | 13 از 14 |
  | بررسی‌های خودکار gold | 75 از 76 | 75 از 76 |
  | آیتم تولیدی / تشخیصی (میانگین) | 3.29 / 0.07 | 3.50 / 0.00 |
  | درصد پوشش منبع (میانگین) | 96.4 | 100 |
  | توکن خروجی (میانگین) | 5688 | 6277 |
  | هزینهٔ هر درس | 0.0297 دلار | 0.0322 دلار |
  | latency p50 / p95 | 35.2 / 96.6 ثانیه | 40.9 / 107.1 ثانیه |

  درس‌های holdout کوتاه‌اند (۱ تا ۳ منبع کوچک). پس بودجهٔ تازه تعداد آیتم را تقریباً تغییر نمی‌دهد؛ این همان رفتار مورد انتظار است. تنها تفاوت پوشش: در S04 production فقط یکی از دو منبع را به کار برد و نامزد هر دو را.
- **درس عکس تخته (LQ-BOARD-15، ۱۵ دقیقه + ۳ عکس تخته + ۱ عکس نامرتبط):** هر دو معتبر. نامزد ۸ آیتم تولیدی، production ۴. آیتم در هر ساعت گفتار: 34.3 در برابر 21.4. هزینه 0.075 در برابر 0.040 دلار.
- **کلاس ۱۲۸ دقیقه‌ای (LQ-LONG-128):** production معتبر بود ولی فقط **۴ آیتم** ساخت، یعنی ۲ آیتم در هر ساعت؛ همان مشکل گزارش‌شده. نامزد با `classPartMinutes: 90` (D63) **نامعتبر** شد (`provider_schema_invalid`): بخش اول در تلاش اول معتبر بود و بخش دوم (دقیقهٔ ۶۴ تا ۱۲۸ با دو عکس تخته) هم در پاسخ اول و هم در تنها تولید دوباره رد شد. هزینه 0.190 دلار.
  - ابزار در آن اجرا diagnostic کد را ذخیره نمی‌کرد. پس از آن ثبت diagnostic و پاسخ ردشده (فقط داده مصنوعی) اضافه شد (`c35d5e4`).
  - یک فراخوان تشخیصی با `tools/eval/lesson-quality-diagnose.ts` و همان سقف تجمعی امتحان شد؛ محافظ سقف آن را پیش از ارسال رد کرد، چون بدترین هزینهٔ آن (حدود ۰٫۳۵ دلار) از باقی‌ماندهٔ سقف (۰٫۲۸۵ دلار) بیشتر بود. پس علت دقیق رد شدن بخش دوم معلوم نیست و **D63 در ارزیابی زنده تأیید نشد**.
  - کلاس بلند در حالت تک‌فراخوان با بودجهٔ تازه (بدون `classPartMinutes`) هم زنده ارزیابی نشده است.

### ۹.۴ بازبینی کورِ کنارِ هم (D56)

- **روش:** چهار بازبین مستقل AI (معلم انسانی نیستند)، دو نفر برای گروه فارسی (S01–S05، S03-repeat و دو درس LQ) و دو نفر برای گروه عربی، اسپانیایی، ژاپنی و اوکراینی. برچسب A/B هر درس تصادفی بود و کلید (`key.json`) بیرون از پوشهٔ بازبینی ماند. بسته‌ها از نظر نام مدل، provider، نسخهٔ تنظیمات و نام بازو بررسی شدند و پاک بودند. معیار همان D56: نمره‌های ۰ تا ۴ در correctness، grounding، coverage، learnerFit، clarityCardUsability (و کیفیت زبان توضیح)، خطای مهم، مفهوم‌های الزامی، و ترجیح کنارِ هم. merge محافظه‌کارانه: اجتماع خطاهای مهم، مفهوم فقط با تأیید هر دو بازبین، نمرهٔ بازبینِ با میانگین کمتر؛ «قابل‌قبول» = معتبر + بدون خطای مهم + همهٔ مفهوم‌ها + میانگین ≥ ۳. ابزار: [`lesson-quality-review-merge.ts`](../../tools/eval/lesson-quality-review-merge.ts).
- **نتیجهٔ ۱۴ درس holdout-5:**

  | سنجه | production | نامزد D62 |
  |---|---:|---:|
  | درس قابل‌قبول | 12 از 14 | **13 از 14** |
  | میانگین نمره (از ۴) | 3.65 | **3.84** |
  | درس با خطای مهم | 0 | 0 |
  | رأی ترجیح کنارِ هم (۲۸ رأی) | 5 | **23** |

  - S05: production مفهوم so/not را کامل آموزش نداد؛ نامزد قابل‌قبول بود.
  - S07: هر دو بازو whoever، wherever و whenever را کافی آموزش ندادند؛ هیچ‌کدام قابل‌قبول نبود. هیچ‌کدام از دستور جاسازی‌شده در منبع پیروی نکرد.
  - ترجیح با production فقط در دو اجرای تکراری (S03-repeat و S10-repeat، هر دو با فاصلهٔ اندک) و یک رأی در S10.
- **دو درس LQ:** در LQ-BOARD-15 هر دو قابل‌قبول و هر دو بازبین نامزد را ترجیح دادند (۳.۸ در برابر ۳.۷). در LQ-LONG-128 فقط production درس داشت (۳.۲، با پوشش ۲ از ۴ چون بخش «حال کامل و گذشتهٔ ساده» را کامل جا انداخت).
- **حکم طبق معیار D56:** نسخهٔ تازه با تنظیمات `openrouter-2026-10-12-1` (بودجهٔ D62، پوشش منبع و خواندن ساختاری، **بدون** `classPartMinutes`) در همان بازبینی کورِ کنارِ هم **از production بهتر است**. D63 (`classPartMinutes`) تأیید نشد و نباید روشن شود.
- **ریسک باقی‌مانده:** کلاس طولانی در حالت تک‌فراخوان با بودجهٔ تازه (تا ۱۸ آیتم) زنده سنجیده نشده است. آزمون‌ها نشان داده‌اند پاسخ ردشده فقط یک تولید دوبارهٔ محدود دارد و در صورت شکست، Run با خطا متوقف می‌شود و کسری از سهمیه ندارد. پیشنهاد: پس از تغییر، اولین کلاس‌های بلند بررسی شوند؛ بازگشت فقط تغییر env به JSON قبلی است.

### ۹.۵ JSON پیشنهادی برای انتشار (`OPENROUTER_SETTINGS_JSON`)

همان [`config/openrouter-defaults.json`](../../config/openrouter-defaults.json):

```json
{"version":"openrouter-2026-10-12-1","llmModel":"google/gemini-3.8-flash","voiceCorrectionModel":"anthropic/claude-haiku-4.5","visionModel":"anthropic/claude-haiku-4.5","sttModel":"openai/whisper-large-v3-turbo","ttsModel":"hexgrad/kokoro-82m","voice":"af_heart","promptVersion":"recalino-knowledge-11","structuredTemperature":0,"structuredModelOverrides":{"google/gemini-3.8-flash":{"maxOutputTokens":32000,"reasoningEffort":"medium","maxRequestBytes":400000,"structuredOutputMode":"json_schema","omitTemperature":true,"knowledgeContract":"content","timeoutMs":180000}},"lessonQuality":{"version":"lesson-quality-1","budget":"lesson-budget-1","sourceCoverage":true,"structuredBoard":true},"maxInputCharacters":120000,"maxOutputTokens":6144,"timeoutMs":90000,"maximumMicros":760000,"modelMaximumMicros":{"google/gemini-3.8-flash":760000,"anthropic/claude-haiku-4.5":300000,"openai/whisper-large-v3-turbo":5000,"hexgrad/kokoro-82m":5000},"currency":"USD","priceVersion":"openrouter-models-2026-10-09","charactersPerPage":3000,"audioUrlSupported":false,"sttProviderOptions":{},"dataContractApproved":true}
```

- اگر JSON فعلی production در فیلد دیگری با `openrouter-2026-10-10-1` فرق دارد (مثلاً `voiceCorrectionModel` پس از D57)، همان مقدار production نگه داشته شود و فقط `version`، `promptVersion` و بلوک `lessonQuality` عوض یا اضافه شوند.
- Runهای در جریان با قاعدهٔ `settings_changed` متوقف می‌شوند؛ تغییر وقتی انجام شود که پردازشی در جریان نیست (D66).
- بازگشت: JSON قبلی `openrouter-2026-10-10-1` (همان `43f12a9:config/openrouter-defaults.json`).
- `classPartMinutes` و `boardVisionModel` در این JSON نیستند.

### ۹.۶ تشخیص D63 و اصلاح (2026-10-13)

- **مجوز:** تصمیم مالک محصول 2026-10-13 (D71، تفویض به مدیر کار): یک اجرای تشخیصی پولی با سقف ۰٫۵۰ دلار، و روشن کردن `classPartMinutes=90` فقط اگر بخش‌ها درست ساخته و ادغام شوند. مالک برنامهٔ اجرا را در همین نشست تأیید کرد.
- **اجرا:** `pnpm exec tsx tools/eval/lesson-quality-diagnose.ts --run-live --parts 1,0` روی همان کلاس مصنوعی ۱۲۸ دقیقه‌ای، با تنظیمات نامزد. هر بخش دقیقاً یک بار ساخته شد و پاسخ هر بخش (فقط دادهٔ مصنوعی) ذخیره شد. شواهد: `artifacts/verification/feat-lesson-quality/d63-diagnostic/`.

  | بخش | بودجه | نتیجه | هزینه | توکن خروجی | زمان |
  |---|---|---|---:|---:|---:|
  | ۲ (دقیقهٔ ۶۴ تا ۱۲۸ + ۲ عکس تخته) | ۱۵ + ۵ | رد: `assembly:study_gap_overhidden` | 0.0398 دلار | 6834 | 46 ثانیه |
  | ۱ (دقیقهٔ ۰ تا ۶۴) | ۱۱ + ۴ | معتبر | 0.0419 دلار | 7546 | 51 ثانیه |

- **علت:** در بخش ۲، کارت هدف «do sb a favour» با جملهٔ «Could you please do me a favour and hold this door?» جای خالی را «Could you please ______ and hold this door?» نوشته بود. یعنی یک جای خالی، مفعول «me» را هم پنهان می‌کرد. prompt می‌گوید مفعول باید دیده شود («______ me ______»)، پس رد کردن درست بود. اما یک کارت نادرست کل بخش و در نتیجه کل جزوهٔ کلاس بلند را رد می‌کرد. ۸ کارت دیگر همان پاسخ سالم بودند.
- **اصلاح (`d32cb03`):** `keepSlotObjectVisible` در [`knowledge-generation.ts`](../../packages/core/src/proc/knowledge-generation.ts). وقتی فقط یک جای خالی، هدفِ جداشدنی را همراه مفعولِ ۱ تا ۳ کلمه‌ای بینِ دو بخشش پنهان کند، جای خالی به شکل «______ me ______» بازسازی می‌شود. نتیجه باید از همهٔ بررسی‌های جای خالی بگذرد؛ هر حالت دیگر (هدف یک‌تکه، شکل صرف‌شده مثل «did me a favour»، مفعول طولانی) همچنان رد می‌شود. آزمون‌ها اول قرمز و بعد سبز شدند (`lesson-quality.test.ts`). جملهٔ کامل، پاسخ و مفعول تغییر نمی‌کنند؛ فقط شکل جای خالی مطابق قاعدهٔ موجود ساخته می‌شود. این اصلاح برای همهٔ درس‌های قرارداد content، نه فقط کلاس‌های بلند، اعمال می‌شود.
- **بررسی آفلاین روی همان پاسخ واقعی** (`tools/eval/lesson-quality-recheck.ts`، بدون فراخوان):
  - بدون اصلاح: بخش ۲ رد (`study_gap_overhidden`).
  - با اصلاح: هر دو بخش معتبر؛ جزوهٔ ادغام‌شده معتبر با **۱۸ آیتم تولیدی و ۱ تشخیصی**، **پوشش ۱۰۰٪ منبع‌ها** و **۹٫۵ آیتم در هر ساعت گفتار**. همان کلاس در production فقط ۴ آیتم (۲ در ساعت) داشت. هر شش موضوع کلاس (used to، فعل‌های عبارتی take، حال کامل و گذشتهٔ ساده، درخواست مؤدبانه، make/do و unless) پوشش گرفتند.
- **فراخوان تأییدی:** یک فراخوان تازه برای بخش ۲ با کد اصلاح‌شده با **HTTP 403** رد شد. سقف خرج کلید این محیط (۲ دلار، بدون بازنشانی) تمام شده است (`limit_remaining = 0`، از endpoint رایگان `GET /api/v1/key`). مصرف امروز این کلید دقیقاً همان دو فراخوان تشخیص است (0.0817 دلار). پس production که امروز درس ساخت، از این کلید استفاده نمی‌کند. محافظ سقف، این فراخوان ردشده را محافظه‌کارانه با بدترین هزینه (0.316 دلار) ثبت کرد و برای همین `confirmation/report.json` عدد 0.398 را نشان می‌دهد. **هزینهٔ واقعی تشخیص 0.0817 دلار است.**
- **پیشنهاد:** `classPartMinutes: 90` **پس از استقرار `d32cb03`** روشن شود. بدون این اصلاح، همان کارت دوباره کل درس را رد می‌کند. تغییر پیشنهادی JSON نسبت به `openrouter-2026-10-12-1`:
  - `"version": "openrouter-2026-10-13-1"`
  - `"lessonQuality": {"version":"lesson-quality-1","budget":"lesson-budget-1","sourceCoverage":true,"structuredBoard":true,"classPartMinutes":90}`
  - بقیهٔ فیلدها و `promptVersion` (`recalino-knowledge-11`) بی‌تغییر.
  - بازگشت: حذف `classPartMinutes` و برگرداندن `version` به `openrouter-2026-10-12-1`.
- **محدودیت:** شاهد تأیید یک نمونهٔ واقعی است که پس از اصلاح بازبینی آفلاین شد، نه یک تولید تازه. یک بخش هنوز ممکن است به دلیل کارت نادرست دیگری رد شود؛ در آن صورت همان تولید دوبارهٔ محدود هر بخش اجرا می‌شود و اگر آن هم رد شود، Run با خطا متوقف می‌شود و سهمیه‌ای کسر نمی‌شود. پیشنهاد: اولین کلاس‌های بالای ۹۰ دقیقه پس از روشن شدن بررسی شوند.

## ۱۰. آزمون‌ها و شواهد

- واحد: `lesson-budget.test.ts`، `lesson-quality.test.ts`، `knowledge-parts.test.ts`، `lesson-review.test.ts` (۳ آزمون تازه)، `NoteView.test.ts` (۲ آزمون تازه)، `provider-defaults.test.ts`، `lesson-quality-eval.test.ts`.
- integration (Supabase محلی): `lesson-quality.int.test.ts` (۵ عکس، حداکثر ۴ هم‌زمان، `boardVisionModel`، بلوک‌های ساختاری و قرارداد قدیمی)، `knowledge-parts.int.test.ts` (کلاس ۱۲۸ دقیقه‌ای: دو بخش، یک نسخه، یک بار کسر)، و `processing.int.test.ts` (به‌روز برای خواندن موازی).
- اجرای محلی: `pnpm lint`، `pnpm typecheck`، `pnpm check:boundaries` موفق؛ نتیجهٔ `pnpm test` در بخش ۱۲.
- CI: بخش ۱۲.

## ۱۱. فایل‌های بیرون از مالکیت و تصویرها

- `packages/core/src/src/service.ts` و `src/index.ts`: فیلد اختیاری `layout` روی بلوک (تغییر کوچک و جدا).
- `packages/core/src/proc/processing.int.test.ts`: انتظار آزمون PDF برای خواندن موازی.
- `apps/web/src/ui/pending-copy.ts` و `docs/design/UI_COPY_PENDING.md`: یک خط import و یک بخش تازه. احتمال تعارض متنی با شاخه‌های دیگر که همین فایل‌ها را تغییر می‌دهند؛ حل: هر بخش جدا نگه داشته شود.
- `apps/web/src/app/dev/ui/study/page.tsx`: حالت `?view=coverage` برای تصویر و بازبینی.
- `apps/web/src/ui/workspace/LessonReview.tsx`: حالت «بسیار بزرگ» (مالکیت بازبینی درس).

تصویرها: بخش ۱۲.

## ۱۲. وضعیت نهایی و شواهد آزمون

- **CI:** GitHub Actions از حدود 22:16 UTC روز 2026-10-12 برای همهٔ شاخه‌ها job را شروع نمی‌کند (runner_id صفر، شکست در ۲ ثانیه، بدون لاگ). مشکل از حساب است، نه این شاخه؛ طبق دستور مدیر، تأیید کامل محلی جایگزین آن است.
- **`pnpm verify` روی `c35d5e4`** (Supabase محلی، بدون متغیرهای ابری محیط):
  - `Checked 1120 files in 2s. No fixes applied.`
  - `✔ no dependency violations found (1201 modules, 5479 dependencies cruised)`
  - `Test Files  320 passed | 1 skipped (321)` · `Tests  3900 passed | 1 skipped (3901)`
- **`pnpm build`** موفق. **`pnpm test:e2e`** (production build، `CI=1`): `259 passed`، `1 flaky` (`class-notes-pronunciation.spec.ts:96`، فاصلهٔ ۴۰٫۶ پیکسل در ۳۹۰، در تلاش دوم موفق)، و ۶ شکست محیطی در `learning-privacy.spec.ts` و `recording.spec.ts`. این دو فایل `launchOptions` خودشان را دارند و Chromium نسخهٔ 1243 را می‌خواستند که در این ماشین نیست. با نگاشت مسیر مرورگر در scratchpad دوباره اجرا شدند: `19 passed`.
  - نکتهٔ محیطی: این نشست متغیرهای `SUPABASE_SECRET_KEY` و `NEXT_PUBLIC_SUPABASE_*` یک پروژهٔ ابری را export می‌کند. `SUPABASE_SECRET_KEY` محیط بر `.env.local` غالب می‌شد و Auth محلی آن را رد می‌کرد (۵۰۰ در ورود آزمونی). آدرس همچنان محلی بود و هیچ درخواستی به پروژهٔ ابری نرفت. e2e و verify نهایی بدون این متغیرها اجرا شدند.
- **تصویرهای D65:** `artifacts/verification/feat-lesson-quality/` — `notes-coverage-{390,1440}.png`، `notes-coverage-page-{390,1440}.png`، `lesson-review-too-large-{390,1440}.png` (صفحهٔ `/dev/ui/study?view=coverage` با دادهٔ مصنوعی).
- **migration:** ندارد. `src.content_version.blocks` و `lkm` jsonb هستند و فیلدهای تازه اختیاری‌اند.

## ۱۳. تصمیم‌های پیشنهادی

- **P-LQ-1:** `VISION_CONCURRENCY = 4` برای عکس و صفحهٔ PDF، هم‌اندازهٔ رونویسی.
- **P-LQ-2:** پوشش منبع: پاسخ اول بدون حساب‌کردن همهٔ منبع‌ها رد می‌شود؛ در تنها تولید دوباره، منبع گزارش‌نشده با `not_reported` ثبت و درس منتشر می‌شود.
- **P-LQ-3:** منبع غیرصوتی بدون anchor در کلاس بلند به بخش اول می‌رود.
- **P-LQ-4:** انتشار D62 با JSON بخش ۹.۵ (بدون D63)، چون معیار D56 برقرار است.

## ۱۴. پرسش‌ها برای مالک محصول

1. هشت متن رابط بخش ۸ (و تصویرهای D65).
2. D63: پاسخ داده شد (D71، 2026-10-13). تشخیص انجام شد و نتیجه در بخش ۹.۶ است.
3. مدل جدا برای عکس تخته: چون نوع عکس پس از فراخوان بینایی معلوم می‌شود، `boardVisionModel` برای همهٔ عکس‌ها به‌جز یادداشت شخصی اعمال می‌شود. آیا این تفسیر پذیرفته است، و پس از مقایسه روی عکس‌های تخته کدام مدل؟
4. P-LQ-2: انتشار درس با `not_reported` به‌جای شکست Run.
5. کلاس‌های بسیار بلند در بازبینی درس: پیام «not available» بماند یا بازبینی بخش‌به‌بخش (هر بخش یک فراخوان پولی جدا) ساخته شود؟
