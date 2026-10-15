# گزارش تحویل سشن مدیر (2026-10-14)

نویسنده: سشن مدیر قبلی (`session_01KAjwfwVK8Si7HigotkhTSA`، عنوان «بررسی پنج مشکل»، روی environment «Default»). مخاطب: سشن مدیر تازه که در environment «Recalino» باز می‌شود. همهٔ زمان‌ها UTC.

## ۱. پیش از شروع

1. بررسی کن در environment درست هستی: `which node; node -v; env | cut -d= -f1 | grep SUPABASE` باید `/root/.local/bin/node`، `v24.21.0` و هیچ متغیر Supabase بدهد ([docs/ops/CLOUD_ENVIRONMENT_FA.md](../ops/CLOUD_ENVIRONMENT_FA.md)).
2. بخوان: `CLAUDE.md`، این فایل، [RELEASE_REPORT_2026-10-13.md](RELEASE_REPORT_2026-10-13.md) (بخش‌های ۴ تا ۸)، D67 تا D73 در [PRODUCT_DECISIONS_LOG.md](../PRODUCT_DECISIONS_LOG.md)، [CI_LOW_COST_POLICY.md](../ops/CI_LOW_COST_POLICY.md).
3. با مالک محصول فارسی حرف بزن؛ پرسش‌ها را تا پایان کار نگه دار؛ کلید و مقدار env را هرگز چاپ نکن؛ در خروجی دستورها و خواندن فایل‌ها صرفه‌جو باش.

## ۲. وضعیت production

- `main` = `963d99f` (#56، سند). آخرین کد منتشرشده `012305f` (#54) روی deployment `dpl_4E2zLYPGuwruz5KnbuSa1H6utrCi`، READY در 01:26 (2026-10-14)، alias `recalino.vercel.app`. smoke ۱۹ از ۱۹، بدون خطا در runtime logs.
- Vercel: پروژه `prj_sexBQckLtPOxFHgqV385Bx1JaxqF`، تیم `team_8WX5ZTQoGLK3XQim9CHcQ350`، ناحیه `lhr1`. استقرار خودکار نیست؛ هر انتشار با `create_deployment` (gitSource github، org `Ali-Paybarjay`، repo `recalino`، ref `main`، sha مشخص) ساخته می‌شود.
- تنظیمات: `OPENROUTER_SETTINGS_JSON` (env id `zHlJM0R7T4UVeWCW`) = نسخهٔ `openrouter-2026-10-13-1` (همان `openrouter-2026-10-12-1` + `lessonQuality.classPartMinutes: 90`، D63). comment همان env دستور rollback را دارد. تغییر env فقط با یک deployment دوم (`forceNew=1`) اثر می‌کند.
- Supabase: پروژه `twowhuzhvyuzjrpraikm` (فقط همین؛ `fitness-coach` در همان سازمان است و هرگز لمس نمی‌شود). ۴۹ migration، آخرین `20261013120000_nfr07_stage_times` (با کانکتور و اجازهٔ صریح مالک محصول اعمال شد، D68).
- انتشارهای 2026-10-13 و 14: #44 هات‌فیکس D59 (12:03)، #45 (12:26)، #46 (12:47)، #47 ممیزی‌ها (15:36)، #48 فقط آزمون، #49 سیاست CI، #50 متن‌های تأییدشده (22:51)، #51 سند D67–D72، #52 پیگیری‌ها + migration + D63 (23:33، deployment دوم 23:42)، #53 خوانایی عکس تخته (00:15)، #54 کاهش egress (01:26)، #55 سند D73، #56 سند environment.

## ۳. رخداد egress و D73

- 2026-10-13: egress پلن رایگان Supabase ۴۵٫۴۷ از ۵ گیگابایت؛ Auth با 402 (`exceed_egress_quota`) ورود و اعلان‌ها را قطع کرده است. SQL از طریق کانکتور کار می‌کند. تصمیم مالک محصول: بدون ارتقای پلن، صبر تا بازنشانی سهمیه پس از 2026-10-17 (D73).
- اصلاح در #54 منتشر شده است (خواندن وضعیت فقط ستون‌های لازم؛ یک خواندن وضعیت کلاس ≈۹۸۴ کیلوبایت ← ≈۱۲٫۶ کیلوبایت). جزئیات: `docs/implementation/egress-status-reads.md`.
- بعد از بازنشانی: ورود واقعی و مسیرهای واردشده را روی production آزمایش کن (smoke فقط مسیرهای عمومی را می‌سنجد)؛ یک هفته egress روزانه را در داشبورد Supabase ببین؛ اگر دوباره به سقف نزدیک شد، نخستین نامزد `readAllowanceShortage` است (در D73 ثبت شده).

## ۴. پرسش‌های باز برای مالک محصول (منتقل‌شده)

1. چهار متن pending در `apps/web/src/ui/pending-copy.ts` (`photoRemove.action/confirm/notUploaded/keep`: «Remove this photo» / «Remove this photo from this device?» / «It has not been uploaded.» / «Keep») و ثبت در `docs/design/UI_COPY_PENDING.md`؛ پس از تأیید به `recording-copy.ts` منتقل می‌شوند (روند D65).
2. ناوبری: متن مصوب «Topics covered» در جلسهٔ خالی می‌گوید «Add session material below…» ولی دکمه‌ها حالا در کارت بالای صفحه‌اند (SESSION_NAVIGATION_2026-10-12.md، انتهای سند). متن جایگزین از مالک محصول.
3. ضبط: ضبط‌های قدیمی بالای ۱۰ دقیقه با پرش ساعت، هنوز از مسیر کند voice-window می‌گذرند؛ آیا بازپردازش لازم است؟
4. عملیات (از RELEASE_REPORT بخش ۵-پ): timeout ۹۰ ثانیه‌ای TTS (۲۳-الف)؛ Routine روزانهٔ سلامت (۲۵، پیش‌نویس در runbook §9؛ باید از سشنی در environment «Recalino» ساخته شود)؛ `BLOB_READ_WRITE_TOKEN` به sensitive تبدیل شود (۲۶)؛ دو index تکراری `anki.export_artifact` (۲۸، migration پاک‌سازی)؛ Site URL ورود Google (۲۹)؛ دو بازتولید اختیاری `cf0c11ba` و `d038a661` و حذف کلاس‌های آزمایشی (۳۰، فقط با اجازه).
5. کلید OpenRouter محیط توسعه (سقف ۲ دلار) تمام شده است؛ production ظاهراً کلید دیگری دارد. اگر سشن‌ها به اجرای واقعی provider نیاز دارند، مالک محصول کلید تازه با سقف کوچک را در Environment variables همان environment می‌گذارد.
6. دروازه‌های باز قبلی بدون تغییر: بودجه/سهمیهٔ تجاری، قرارداد داده و متن حقوقی، مجوز انتقال کلید پشتیبان، consent screen گوگل در حالت Testing.

## ۵. اندازه‌گیری‌های موعددار

- D63: نخستین کلاس‌های بالای ۹۰ دقیقه پس از 2026-10-13 23:42 را از نظر کیفیت جزوه ببین (`tools/eval/lesson-quality-recheck.ts`).
- D72: دو هفته سنجش `photo_quality` در برابر عکس‌های ناخوانا؛ اگر پس از لایهٔ ۱ بیش از حدود ۱۰٪ ناخوانا ماند، لایهٔ ۳ (خواندن زودهنگام در پس‌زمینه) فعال می‌شود. زمان‌بندی واقعی روی گوشی و کالیبراسیون با عکس‌های خود مالک محصول هنوز انجام نشده است.
- NFR-07: p50/p95 مراحل با `ops-cli timings` (مرحلهٔ `device_hidden` وقتی گزارش نشده null است) و `capture_health`.

## ۶. روند انتشار (D66 و D67)

1. کار روی شاخهٔ `feat/*` یا شاخهٔ تعیین‌شدهٔ سشن؛ پیش از PR، `pnpm verify` محلی (و برای UI، `pnpm test:e2e`)؛ یک PR برای هر کار، با برچسب `e2e` اگر UI یا مسیر کاربر تغییر کرده است. push به شاخه‌های کاری CI ندارد.
2. CI سبز (verify حدود ۱۱ دقیقه، e2e ۱۲ تا ۱۵ دقیقه). بازبینی diff مدیر + lint/typecheck/boundaries/unit محلی روی همان سرشاخه.
3. بررسی بیکاری با SQL فقط‌خواندنی: `plt.job` فعال، `proc.processing_run` در حال اجرا، `org.class_session.capture_open_until > now()`، `src.audio_upload` تأییدنشدهٔ ۳۰ دقیقهٔ اخیر؛ همه باید صفر باشند.
4. ادغام (merge commit) → اگر migration دارد: `pnpm db:apply` (dry run) و بعد `pnpm db:apply --apply`؛ حذف داده فقط پس از اجازهٔ صریح مالک محصول برای همان migration (D77) → `create_deployment` → حدود ۵ دقیقه → `get_deployment` READY → گرم کردن `/`, `/preview` با curl → smoke: `cd apps/web && BASE_URL=https://recalino.vercel.app PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm run test:smoke` (۱۹ آزمون؛ cold start گاهی یک timeout می‌دهد، اجرای دوم باید ۱۹ از ۱۹ باشد) → runtime logs (error/warning) → گزارش فارسی به مالک محصول.
5. سند‌های فقط‌متنی (`docs/*.md`, `docs/ops/**`, `docs/plans/**`, `*.md`) CI ندارند و بدون هزینه ادغام می‌شوند.

## ۷. قواعد سشن‌های کارگری

- ساخت با `create_session` همراه `source_url` (`https://github.com/Ali-Paybarjay/recalino`) و `source_revision` (`main`)؛ بدون این دو، سشن مخزن ندارد. مدل `claude-opus-5-5`. شناسه‌ها به شکل `session_01` + ۲۲ نویسه‌اند.
- بریف مشترک: پرسش‌ها تا پایان نگه داشته می‌شوند؛ پایان کار با پیام `WORKER DONE — <نام>` به سشن مدیر (`send_message`)؛ کلید چاپ نمی‌شود؛ روی Supabase ابری فقط `select`؛ ادغام، migration و استقرار فقط به‌دست مدیر؛ شاخهٔ کارگر `feat/*` با push به همان شاخه.
- بریف کارگر را در یک فایل scratchpad بنویس و متن کامل را در پیام اولیه بده (کارگر به scratchpad مدیر دسترسی ندارد).

## ۸. سشن‌ها و شاخه‌ها

همهٔ کارگرها کارشان تمام و بیکارند و شاخه‌هایشان در `main` ادغام شده است؛ بایگانی‌شان با اجازهٔ مالک محصول: آپلود `session_01U5H2yyQxjHfGzDH5E6RYs8` (feat/upload-reliability)، ضبط `session_012LknVmYLMjibKDJLnPiYSB` (feat/recording-capture)، جزوه `session_01X9s8vr7o9v8pDis4tb866f` (feat/lesson-quality)، صدا `session_01DAKWYCLU6s4wT1N9TZZ716` (feat/voice-detection)، ناوبری `session_01R6rGbtBzTPQ4V6YqaAL6pc` (feat/session-navigation)، A هات‌فیکس `session_01S8B1KDPH4WUTUZHFSbYxSc`، B آماده‌سازی انتشار `session_018SEJFUYb5VBfGq2FwmEZVW`، C راهنمای OAuth `session_01Bwu6tMnT6UvyxrVv4uAPkp`، D بازیابی اجراها `session_01572u9V8oPk41At9tccYEXP`، عکس تخته `session_017mYanxQiDmYPWqHPRKdMqJ` (feat/photo-readability)، egress `session_01NPFe9cjBGteeNTanRmMAUL` (claude/determined-ramanujan-1mapef). همهٔ این سشن‌ها روی environment «Default» ساخته شده‌اند؛ برای کار تازه سشن تازه در «Recalino» بساز.

هیچ check-in یا Routine فعالی از مدیر قبلی نمانده است (`list_triggers` را یک بار بررسی کن). شاخه‌های `feat/*` ادغام‌شده قابل حذف‌اند (با اجازه). شاخهٔ تعیین‌شدهٔ مدیر قبلی `claude/gifted-franklin-7ecldm` دیگر استفاده نمی‌شود.
