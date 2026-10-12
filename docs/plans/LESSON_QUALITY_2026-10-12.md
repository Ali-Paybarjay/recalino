# کیفیت جزوه و عکس تخته — گزارش پیاده‌سازی (Workstream 3، 2026-10-12)

> **شاخه:** `feat/lesson-quality` · **مبنا:** `43f12a9` (`main` @ `b4aa3d5` + سند [علت پنج مشکل](FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)، بخش ۵).
> **تصمیم‌ها:** D62 و D63 (تصمیم مالک محصول 2026-10-12، ثبت مدیر کار در شاخهٔ `claude/gifted-franklin-7ecldm`)، D56، D49، D46، D58، D17.
> **وضعیت ارزیابی زنده:** بخش ۹ (پس از اجرا تکمیل می‌شود).

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

(پس از اجرا تکمیل می‌شود.)

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

## ۱۲. وضعیت نهایی

(پس از ارزیابی و CI تکمیل می‌شود.)

## ۱۳. تصمیم‌های پیشنهادی

- **P-LQ-1:** `VISION_CONCURRENCY = 4` برای عکس و صفحهٔ PDF، هم‌اندازهٔ رونویسی.
- **P-LQ-2:** پوشش منبع: پاسخ اول بدون حساب‌کردن همهٔ منبع‌ها رد می‌شود؛ در تنها تولید دوباره، منبع گزارش‌نشده با `not_reported` ثبت و درس منتشر می‌شود.
- **P-LQ-3:** منبع غیرصوتی بدون anchor در کلاس بلند به بخش اول می‌رود.

## ۱۴. پرسش‌ها برای مالک محصول

1. هشت متن رابط بخش ۸ (و تصویرهای D65).
2. آیا مقدار `classPartMinutes` در انتشار ۹۰ باشد (حداکثر D17) یا کمتر (مثلاً ۶۰)؟
3. مدل جدا برای عکس تخته: چون نوع عکس پس از فراخوان بینایی معلوم می‌شود، `boardVisionModel` برای همهٔ عکس‌ها به‌جز یادداشت شخصی اعمال می‌شود. آیا این تفسیر پذیرفته است، و پس از مقایسه روی عکس‌های تخته کدام مدل؟
4. P-LQ-2: انتشار درس با `not_reported` به‌جای شکست Run.
5. کلاس‌های بسیار بلند در بازبینی درس: پیام «not available» بماند یا بازبینی بخش‌به‌بخش (هر بخش یک فراخوان پولی جدا) ساخته شود؟
