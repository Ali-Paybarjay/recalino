# پیگیری اصلاح‌های ممیزی — 2026-10-18

- گزارش: [2026-10-18-project-audit.md](2026-10-18-project-audit.md)
- پایه (`BASE`): `8a2a22d` روی `claude/optimistic-archimedes-xh9mr3` (شاخهٔ مبدأ)
- branch یکپارچه‌سازی: `audit-fixes/2026-10-18` در `.claude/worktrees/audit-integration` (commit نخست `efeae6b`: `.claude/worktrees/` در `.gitignore`)
- روش: workflow (ultracode) با worktree جدا برای هر دسته؛ هر دسته worker و بازبین، دستهٔ امنیتی دو بازبین؛ حداکثر دو دور اصلاح
- اجازه‌های از پیش: حذف فایل‌های spike (SEC-02)، override `source-map-js` (SEC-10)، واژه‌نامهٔ A و اجرای دستهٔ ۵، `.claude/worktrees` در `.gitignore`
- محدودیت محیط: بدون Docker؛ integration و e2e اجرا نمی‌شوند؛ migration تازه در این اجرا ساخته نمی‌شود (PRD-03 کامل، PERF-07، SEC-07 به اجرای بعد)
- push، PR، ادغام در شاخهٔ مبدأ و حذف worktree یا branch فقط با تأیید مالک محصول

| موج | دسته | یافته‌ها | worker | branch | وضعیت | بررسی‌ها | commit یا PR | یادداشت |
|---|---|---|---|---|---|---|---|---|
| ۱ | ۱. پشتیبان و بازیابی | OPS-01، PRD-02، OPS-07 | مدل session (Opus 5.5) | `fix/audit-1` | ادغام‌شده | lint، typecheck، boundaries، ۳٬۵۶۰ آزمون واحد سبز (پس از ادغام)؛ integration نوشته‌شده ولی اجرانشده | `9b4430a`، `e50cda9`؛ ادغام `53485d2` | بازبین تأیید کرد. نیاز به تصمیم: تعارض «نگهداری ۳۰ روزه» در متن حقوقی با کف ۳ نسخه؛ هشدار به‌صورت وظیفهٔ ادمین migration می‌خواهد؛ RPO پیشنهادی؛ نسخهٔ آفلاین کلید |
| ۱ | ۴. مسیر زبان‌آموز | UX-01، UX-02، UX-03، UX-07، UX-09..14، UI-05، A11Y-03، PRD-04 | sonnet | `fix/audit-4` | ادغام‌شده | پس از ادغام: lint، typecheck، boundaries، ۳٬۷۱۵ آزمون واحد و build سبز؛ e2e اجرانشده | `1b6ba76`، `cd05a15`؛ ادغام `07b5b47` | یک دور اصلاح (خطای sync حین ضبط، حذف ۷ متن تأییدنشده). UX-13 بخشی. نیاز به تصمیم: ۷ متن در UI_COPY_PENDING، /recordings بی‌ناوبری در حالت بیکار |
| ۱ | ۸. build و ابزار | OPS-06، OPS-08، OPS-12، QUA-02، QUA-03، OPS-09، OPS-11 | sonnet | `fix/audit-8` | ادغام‌شده | همان؛ نگهبان اندازه: بزرگ‌ترین Function ۱۷۱٫۱MB از ۲۲۵ | `d277041`، `80716f9`؛ ادغام `2052c19`؛ اصلاح یکپارچه‌سازی `478a861` | یک دور اصلاح (کامنت minimumReleaseAge). نیاز به تصمیم: cooldown سخت‌گیر pnpm؛ مقادیر ابری CLOUD_AUTH_CONFIG؛ setup script در environment؛ تعارض اسناد Google |
| ۲ | ۲. سخت‌سازی امنیتی | SEC-01، SEC-02، SEC-03، SEC-06، SEC-09، SEC-10 | Opus 5.5 | `fix/audit-2` | ادغام‌شده | دو بازبین (معمولی و تهاجمی) در دور اول تأیید کردند؛ پس از ادغام: lint، typecheck، boundaries، ۳٬۷۸۹ آزمون واحد، build، نگهبان اندازه، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری | ۶ commit؛ ادغام `355658d` | SEC-06: pdf.js 6.4.299 گزینهٔ eval ندارد، آزمون نگهبان جایش آمد. نیاز به تصمیم: base-uri 'self' about: برای فریم جزوه؛ حذف pg-boss بی‌مصرف؛ بررسی voice-runtime انتشار؛ حذف RECALINO_SPIKE و SPIKE_TOKEN از Vercel (کار مالک) |
| ۲ | ۶. token و دسترس‌پذیری | UI-01..04، UI-06، A11Y-02، A11Y-04، A11Y-05، UX-08 | sonnet | `fix/audit-6` | ادغام‌شده | دو دور اصلاح (نگاشت صفحه‌های بدون پوسته)؛ همان بررسی‌های پس از ادغام | ۶ commit؛ ادغام `e612b90` | بخشی: UI-02 (13/15/18px)، UI-04 (breakpointها)، A11Y-02 (جزوهٔ مستقل فارسی)، UX-08 (loading با پوسته، نه انتقال به layout). پیگیری در `docs/design/UI_TOKEN_FOLLOWUPS_2026-10-19.md` |
| ۳ | ۳. پایش و ایمنی انتشار | OPS-02، OPS-05، PERF-05، PRD-01 | Opus 5.5 | `fix/audit-3` | ادغام‌شده (بخشی) | بازبین در دور اول تأیید کرد؛ پس از ادغام موج ۳: lint، typecheck، boundaries، ۳٬۹۴۱ آزمون واحد، build (بزرگ‌ترین Function ۱۷۱٫۱MB)، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری؛ integration و e2e اجرانشده | `d549d13`؛ ادغام `221bdd1` | OPS-02: بک‌اند و `/api/health?deep=1` آماده، کارت «System health» منتظر متن در UI_COPY_PENDING. OPS-05: نگهبان نسخهٔ schema آماده ولی بدون grant روی `supabase_migrations` در production غیرفعال (migration لازم). PRD-01: گارد build حقوقی؛ پیش از ادغام در main یا `RECALINO_ALLOW_DRAFT_LEGAL=1` در Vercel production یا بستن G11 |
| ۳ | ۷. کارایی | PERF-01..04، PERF-06 | Opus 5.5 | `fix/audit-7` | ادغام‌شده (بخشی) | یک دور اصلاح (مهلت کل مرحلهٔ Auth)؛ دو بازبین تأیید کردند؛ پس از ادغام موج ۳: lint، typecheck، boundaries، ۳٬۹۴۱ آزمون واحد، build (بزرگ‌ترین Function ۱۷۱٫۱MB)، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری؛ integration و e2e اجرانشده | ۱۱ commit؛ ادغام `e43dd64` | PERF-01 و PERF-02 کامل. PERF-03: هر مرحلهٔ Auth حداکثر ۲٫۵ ثانیه؛ getUser ماند (FR-PLT-001). PERF-04 بخشی (Today هنوز بیش از ۸ کوئری). PERF-06: حدود ۴۲KB کاهش از هدف ۱۰۰KB. PERF-07 به اجرای بعد |
| ۳ | ۱۱. منوی صفحهٔ ضبط | UX-02 (تصمیم مالک 2026-10-19) | sonnet | `fix/audit-11` | ادغام‌شده | بازبین در دور اول تأیید کرد؛ پس از ادغام موج ۳: lint، typecheck، boundaries، ۳٬۹۴۱ آزمون واحد، build (بزرگ‌ترین Function ۱۷۱٫۱MB)، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری؛ integration و e2e اجرانشده | `eba15b9`؛ ادغام `4edc107` | بازگشت به «تمرکز کامل» با `RECORDING_FOCUS_MODE = "always"` در `apps/web/src/ui/recording/recording-focus.ts`؛ پیش‌نمایش ۳۷۵ و ۱۴۴۰ به مالک نشان داده شد، منتظر پاسخ |
| ۴ | ۱۰. بازآرایی | QUA-01، QUA-04..09 | Opus 5.5 | `fix/audit-10` | ادغام‌شده (بخشی) | یک دور اصلاح (برگرداندن حساب pricing)؛ دو بازبین (معمولی و حفظ رفتار) تأیید کردند؛ پس از ادغام موج ۴: lint، typecheck، boundaries، ۴٬۰۷۰ آزمون واحد، build (بزرگ‌ترین Function ۱۷۱٫۲MB)، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری؛ integration و e2e اجرانشده | ۲۳ commit؛ ادغام `bf6a500` | QUA-01: `processingJob.run` orchestrator کوتاه با ۱۸ ماژول `proc/steps/*`؛ چند تابع هنوز بالای ۳۰۰ خط. QUA-08: تغییر نام کلاس‌های `preview-*` در پیگیری‌ها. QUA-09: گرد کردن integer نرخ‌ها اثر مالی دارد و منتظر تصمیم است. هشدار: `git rm --cached` فایل‌های `.build` را در هر checkout دیگری که این commit را بگیرد از دیسک پاک می‌کند |
| ۴ | ۵. متن و اصطلاحات | UX-04، UX-05، UX-06 + ۱۰ متن مصوب | sonnet | `fix/audit-5` | ادغام‌شده | یک دور اصلاح (واژهٔ material در ضبط و صدا، specهای کهنه)؛ بازبین تأیید کرد؛ پس از ادغام موج ۴: lint، typecheck، boundaries، ۴٬۰۷۰ آزمون واحد، build (بزرگ‌ترین Function ۱۷۱٫۲MB)، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری؛ integration و e2e اجرانشده | `cbe6719`، `510750b`؛ ادغام `5e08a3d` (یک تعارض import در `ExportView.tsx` حل شد) | نیاز به تصمیم: تب «Courses» به «Sessions» (تعارض با D50)، برچسب مجموعهٔ کارت (تعارض با D79)، متن `provider_outcome_unresolved`، دو پیوند «Manage courses» با دو مقصد |
| ۵ | ۹. تصمیم‌محور | SEC-04، SEC-05، OPS-03، OPS-04، OPS-10، SEC-07، SEC-08، PRD-05، PRD-06 + ثبت نسخه‌دار تصمیم‌ها (D80 تا D93) | Opus 5.5 | `fix/audit-9` | ادغام‌شده (بخشی) | سه دور اصلاح (همه برای hook داده‌پاک‌کن)؛ هر دو بازبین در دور ۳ تأیید کردند؛ پس از ادغام: lint، typecheck، boundaries، ۴٬۲۲۸ آزمون واحد، build، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری | ۱۲ commit؛ ادغام `6f1f4a4`؛ سند محدودیت‌های hook `ac74633` | SEC-07 به تصمیم و migration موکول. نیاز به تصمیم: تعارض D81 با CLAUDE.md، نسخهٔ privacy-notice، جملهٔ «hourly cleanup»، گارد کد Preview، ایمیل تأیید حذف حساب |
| ۶ | ۱۲. تصمیم‌های پایانی مالک | UX-02، SEC-05، PRD-05، OPS-01 | Opus 5.5 | `fix/audit-12` | ادغام‌شده | دو بازبین در دور اول تأیید کردند؛ پس از ادغام: lint، typecheck، boundaries، ۴٬۲۳۷ آزمون واحد، build، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری | ۳ commit؛ ادغام `81abf78` | تمرکز کامل صفحه‌های ضبط؛ hook برای `--approve-data-loss` ask؛ privacy-notice ۰٫۳ (D94). هشدار «Self-Modification» برای ویرایش مصوب `.claude/hooks/` بررسی شد: نوشتنی بیرون از worktree نبود |
| ۷ | ۱۳. migrationهای باقی‌مانده | SEC-07، OPS-05، PERF-07، PRD-03، OPS-02 | Opus 5.5 | `fix/audit-13` | ادغام‌شده | یک دور اصلاح (ناشناس‌سازی در همان تراکنش، مثال حقوقی، دو index)؛ دو بازبین تأیید کردند؛ پس از ادغام و آزمون تطابق متن هشدار: lint، typecheck، boundaries، ۴٬۲۷۴ آزمون واحد، build، client-bundle سبز؛ push شد (`e8d4fe2`) | `8df1a9d`، `9017557`؛ ادغام `122eb28` | چهار migration `20261019120000..120300`؛ آزمون integration در CI روی PR به `main`؛ اعمال بلافاصله پس از ادغام در `main` |
| ۷ | ۱۴. کارت System health و گارد Preview | OPS-02، OPS-03 | Opus 5.5 | `fix/audit-14` | ادغام‌شده | دو بازبین در دور اول تأیید کردند؛ پس از ادغام: lint، typecheck، boundaries، ۴٬۲۶۵ آزمون واحد، build، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری؛ push شد (`9f34962`) | `910871f`، `f4abd46` | Preview بدون `RECALINO_UI_PREVIEW=1` در مسیرهای دیتابیس‌دار خطای پیکربندی (500) می‌دهد؛ عمدی است |
| ۸ | ۱۵. رابط پیشرفت پایلوت و وظیفه‌های تازه | PRD-03، OPS-02 | Opus 5.5 | `fix/audit-15` | ادغام‌شده | بازبین در دور اول تأیید کرد؛ پس از ادغام: lint، typecheck، boundaries، ۴٬۲۹۳ آزمون واحد، build، client-bundle سبز؛ `pnpm audit --prod` بدون آسیب‌پذیری؛ push شد (`c16cf42`) | `9ad7717`؛ ادغام `c16cf42` | پنج ستون تاریخ، عنوان و مسیر مصوب دو وظیفه (D98) |
| ۹ | ۱۶. پیگیری‌های بدون تصمیم | QUA-08، QUA-04، SEC-04، SEC-05 | Opus 5.5 | `fix/audit-16` | ادغام‌شده | دو بازبین در دور اول تأیید کردند؛ پس از ادغام: lint، typecheck، boundaries، ۴٬۳۳۷ آزمون واحد، build، client-bundle سبز؛ push شد (`5739f33`) | ۵ commit | کلاس‌های `preview-*` به `workspace-*`؛ `learnerActor` در capture-staging؛ حذف `fontGoogleFamily`؛ `timeZoneCity` به ui؛ hook: UESCAPE پس از توضیح و search_path با cron |
| ۹ | ۱۷. کنتراست، اندازهٔ فونت، برچسب کارت و export | A11Y-01، UI-02، UX-05، QUA-05 | Opus 5.5 | `fix/audit-17` | ادغام‌شده | بازبین در دور اول تأیید کرد؛ پس از ادغام: lint، typecheck، boundaries، ۴٬۳۵۶ آزمون واحد، build، client-bundle سبز؛ push شد (`d087536`)؛ /dev/ui با next dev بدون خطای اپ (فقط خطای websocket HMR از proxy محیط) | `e34ee9f` | `--rc-border-strong` روشن `#7a8d80` (۳٫۰۳ تا ۳٫۵۳)؛ ۵۸ اندازهٔ خام به token؛ D99 و D100. نیاز به تصمیم: hover فیلد متن (حدود ۲٫۶)؛ متن‌های باقی‌ماندهٔ UX-05 |
| ۹ | ۱۸. ادامهٔ QUA-01 و PERF-04 | QUA-01، PERF-04 | Opus 5.5 | `fix/audit-18` | ادغام‌شده | کار نخست در سقف مصرف هفتگی قطع شد (۱۰ commit)؛ ادامه با دو دور اصلاح؛ دو بازبین تأیید کردند؛ پس از ادغام: lint، typecheck، boundaries، ۴٬۴۳۹ آزمون واحد، build، client-bundle سبز؛ push شد (`252988c`) | ۱۸ commit | بلندترین تابع proc حدود ۱۹۸ خط؛ خواندن وضعیت‌های Today حداکثر ۸ statement؛ قفل هر کارت در درخواست Anki عمداً همان ترتیب قبلی |
| ۹ | ۱۹. متن‌های باقی‌ماندهٔ UX-05 و hover فیلد | UX-05، A11Y-01 | Opus 5.5 | `fix/audit-19` | ادغام‌شده | بازبین در دور اول تأیید کرد؛ پس از ادغام: lint، typecheck، boundaries، ۴٬۳۷۵ آزمون واحد، build، client-bundle سبز؛ push شد (`861d8b4`) | `93b4325` | D101؛ hover روشن ۵٫۵ تا ۶٫۴ |
| ۱۰ | ۲۰. سبز کردن e2e روی CI | CI-e2e | Opus 5.5 | `fix/audit-20` | ادغام‌شده | بازبین در دور اول تأیید کرد؛ lint، typecheck (شامل specها)، boundaries، ۴٬۴۳۹ آزمون واحد سبز؛ push شد (`3bb86fc`) | `8053285` | ۱۰ شکست e2e همه drift spec بود (عنوان «Session material» پس از D86، loading.tsx، nonce hiding با CSP header، fixture کارت due، مسیر goBack در حالت تمرکز)؛ اپ تغییر نکرد |

## تصمیم‌های مالک محصول در طول اجرا

| تاریخ | موضوع | تصمیم | پیگیری |
|---|---|---|---|
| 2026-10-19 | نگهداری پشتیبان (OPS-01) | سه نسخهٔ ready آخر حتی پس از ۳۰ روز نگه داشته می‌شوند | اصلاح نسخه‌دار متن «نگهداری ۳۰ روزه» در ADR-0001، `docs/legal/privacy-notice.md` و `PILOT_TECHNICAL_FACTS.md` (پیش‌نویس) و ثبت در `PRODUCT_DECISIONS_LOG.md` در دستهٔ تصمیم‌محور |
| 2026-10-19 | ۷ متن تازهٔ رابط (دستهٔ ۴) | اول متن‌ها نشان داده شوند | فهرست متن‌ها با محل در گزارش موج؛ تأیید جداگانهٔ هر متن |
| 2026-10-19 | cooldown انتشار pnpm (OPS-12) | `minimumReleaseAge: 1440` سخت‌گیر بماند | — |
| 2026-10-19 | ناوبری صفحه‌های ضبط (UX-02) | منو فقط حین ضبط پنهان شود؛ پیش از شروع و پس از Stop دیده شود | دستهٔ کوچک در موج ۳؛ پس از پیاده‌سازی، پیش‌نمایش ۳۷۵ و ۱۴۴۰ نشان داده و پرسیده شود که بماند یا به «تمرکز کامل» برگردد |
| 2026-10-19 | متن‌های تازهٔ رابط | همهٔ ۷ متن دستهٔ ۴ عیناً تأیید شد: `cardActions.rejected` «Card rejected»، `termsAcceptance.guidance`، `accountDeletion.needsOperator`، `yourData.downloadFirst`، `allowanceHelp.need`، `allowanceHelp.reserved`، `workspaceErrors.sourcesChanged` (متن کامل در `docs/design/UI_COPY_PENDING.md` روی `audit-fixes/2026-10-18`). سه پیشنهاد دیگر هم تأیید شد: جملهٔ صفحهٔ ورود «Built for a small pilot group. Sign in with Google to start.»، برآورد انتظار UX-13 و دعوت به اعلان UX-13 | ورود به رابط در دستهٔ ۵ (موج ۴) و ثبت «تأییدشده در 2026-10-19» در `UI_COPY_PENDING.md`؛ گزینهٔ «Something else» بی‌متن انتخاب شد — اگر مالک متن دیگری داد اضافه شود |
| 2026-10-19 | حالت نهایی منوی صفحهٔ ضبط (دستهٔ ۱۱) | پیش‌نمایش ۳۷۵ و ۱۴۴۰ دیده شد؛ تصمیم «بماند یا تمرکز کامل» به پایان کار موکول شد | در گزارش پایانی دوباره پرسیده شود؛ تا آن زمان حالت تازه (منو فقط حین ضبط پنهان) روی شاخهٔ یکپارچه‌سازی است |
| 2026-10-19 | منو در فاز saving پس از Stop | دیده شود (همان رفتار فعلی `captureIsQuiet`) | — |
| 2026-10-19 | PERF-03، بررسی نشست | `getUser` بماند (FR-PLT-001) با مهلت ۲٫۵ ثانیه برای هر مرحلهٔ Auth | تنظیم reuse interval و تشخیص reuse در پروژهٔ Supabase را مالک ببیند |
| 2026-10-19 | جابه‌جایی فایل در دستهٔ ۱۰ | هر سه تأیید شد: QUA-07 انتقال «claude promps/» به `docs/design/reference-output/`، QUA-07 خروج ۸۹ فایل `.build` از ردیابی با `git rm --cached` و `.gitignore`، QUA-08 انتقال `preview.css` و `primitives.tsx` به `ui/workspace/` | موج ۴ |
| 2026-10-19 | فونت جزوه و کارت (SEC-04، تصمیم ۲) | A: حذف Google Fonts و استفاده از فونت سیستم | دستهٔ ۹ |
| 2026-10-19 | مجوزهای Claude Code (SEC-05، تصمیم ۳) | B: allow بماند و hook از نوع `PreToolUse` برای SQL مخرب پرسش کند و `--approve-data-loss` را رد کند | دستهٔ ۹ |
| 2026-10-19 | محیط Preview (OPS-03، تصمیم ۴) | A: اسرار پایلوت فقط در Production؛ preview فقط با fixture؛ چرخش و Sensitive کردن `BLOB_READ_WRITE_TOKEN` | دستهٔ ۹: سند و چک‌لیست؛ تغییر Vercel کار مالک |
| 2026-10-19 | CI و GitHub (OPS-04 و OPS-10، تصمیم‌های ۵ و ۶) | انتخاب به Claude سپرده شد. انتخاب: ruleset برای `main` با PR و check الزامی و Vercel Deployment Checks (چک‌لیست برای مالک)، حذف build تکراری e2e با artifact، Dependabot فقط برای security updates | دستهٔ ۹ |
| 2026-10-19 | تب ناوبری (دستهٔ ۵، تعارض با D50) | «Sessions» بماند | اصلاح نسخه‌دار D50 و مورد ۱۱ `HANDOFF_R1_REVIEW.md` در دستهٔ ۹ |
| 2026-10-19 | برچسب نوع کارت (دستهٔ ۵، تعارض با D79) | «Core cards» و «Supplementary cards» بماند | اصلاح نسخه‌دار D79 در دستهٔ ۹ |
| 2026-10-19 | متن خطای `provider_outcome_unresolved` | تأیید: «A result is still being checked. Contact the pilot operator before trying again.» | ورود به رابط در دستهٔ ۹ |
| 2026-10-19 | گرد کردن قیمت (QUA-09) | وضع فعلی بماند؛ بدون تغییر حساب | — |
| 2026-10-19 | حالت نهایی منوی صفحهٔ ضبط (پس از دیدن پیش‌نمایش) | بازگشت به «تمرکز کامل»: منو در همهٔ مراحل صفحهٔ ضبط پنهان | دستهٔ ۱۲: `RECORDING_FOCUS_MODE = "always"`، specها، D90 و سند ناوبری |
| 2026-10-19 | `--approve-data-loss` در hook (تعارض D81 با CLAUDE.md) | hook به‌جای رد، پنجرهٔ تأیید باز کند؛ روال CLAUDE.md و D77 می‌ماند | دستهٔ ۱۲: hook، آزمون، D81، `CLOUD_ENVIRONMENT_FA.md` |
| 2026-10-19 | نسخهٔ privacy-notice | نسخهٔ ۰٫۳ با هر دو اصلاح: نگهداری پشتیبان (D85) و «A cleanup job runs at least once an hour» به‌جای «hourly» (در CLASSROOM_NOTICE هم) | دستهٔ ۱۲: متن‌های حقوقی، `consents.md`، `documents.ts`، `pnpm legal:build`؛ پذیرش دوباره یک بار |
| 2026-10-19 | push و PR | پس از دستهٔ ۱۲ و بررسی دوباره، push و یک PR از `audit-fixes/2026-10-18` به `claude/optimistic-archimedes-xh9mr3` | — |
| 2026-10-19 | migrationهای باقی‌مانده (SEC-07، OPS-05، PERF-07، PRD-03، هشدار وظیفهٔ ادمین) | الان نوشته شوند؛ آزمون integration در CI روی PR به `main` | دستهٔ ۱۳ |
| 2026-10-19 | مدت نگهداری سوابق (SEC-07) | `plt.security_event` پس از ۹۰ روز پاک شود؛ در `plt.audit_event` شناسهٔ کاربر پس از حذف حساب ناشناس شود؛ متن در همان privacy-notice نسخهٔ ۰٫۳ | دستهٔ ۱۳ |
| 2026-10-19 | متن کارت «System health» (۱۶ سطر دستهٔ ۳) | همه تأیید شد | دستهٔ ۱۴ |
| 2026-10-19 | گارد کد Preview (OPS-03)، پاک کردن worktree و branchهای ادغام‌شده، پیگیری PR | تأیید شد | گارد در دستهٔ ۱۴؛ worktreeهای ۱ تا ۱۲ و branchهای `fix/audit-1..12` پاک شدند؛ PR #67 زیر نظر است |
| 2026-10-19 | push | اجازهٔ دائم: هر جا push لازم است بدون پرسیدن دوباره انجام شود و کار تا انتها پیش برود | — |
| 2026-10-19 | برچسب ستون‌های پیشرفت پایلوت و عنوان و مسیر دو وظیفهٔ تازه (دستهٔ ۱۳) | همه تأیید شد | دستهٔ ۱۵ |
| 2026-10-19 | آزمون integration و e2e | پایهٔ PR #67 به `main` تغییر کند و برچسب `e2e` بگیرد تا CI کامل اجرا شود؛ ادغام در `main` با مالک | پس از دسته‌های ۱۶ تا ۱۸، یک بار |
| 2026-10-19 | کنتراست مرز کنترل‌ها (A11Y-01، تصمیم ۸) | A: تیره‌تر کردن `--rc-border-strong` در تم روشن تا دست‌کم ۳:۱ | دستهٔ ۱۷ |
| 2026-10-19 | اندازه‌های خام ۱۳/۱۵/۱۸ پیکسل (UI-02) | نگاشت پیشنهادی به token‌ها (۱۳→sm، ۱۵→md، ۱۸→read) | دستهٔ ۱۷ |
| 2026-10-19 | برچسب‌های کارت (`card-labels.ts`)، ردیف خراب export، ادامهٔ QUA-01 و PERF-04 | همه تأیید شد | برچسب‌ها و export در دستهٔ ۱۷؛ QUA-01 و PERF-04 در دستهٔ ۱۸ |
| 2026-10-20 | متن‌های باقی‌ماندهٔ UX-05 | همه تأیید شد: رسید حذف حساب، پیام توقف پردازش بی‌واژهٔ provider، «In your review queue»، برچسب‌های نوع فایل و «Computer voice N · Ready» | دستهٔ ۱۹ |
| 2026-10-20 | hover فیلد متن در تم روشن | هم‌رنگ یا تیره‌تر از `--rc-border-strong` | دستهٔ ۱۹ |

- 2026-10-20 02:20 UTC: پایهٔ PR #67 به `main` تغییر کرد و برچسب `e2e` خورد؛ CI روی `252988c` شروع شد. 02:30: یک شکست از ۷۱۳ آزمون integration (`ended-job-reconcile.int.test.ts`: ترتیب ردیف‌های ledger با شناسهٔ تصادفی)؛ اصلاح در `77766bb` و push؛ CI دوباره اجرا شد: verify (شامل ۷۱۳ آزمون integration) سبز؛ e2e با ۱۰ شکست و سقف ۲۰ دقیقه قطع شد؛ اصلاح specها در دستهٔ ۲۰ و push `3bb86fc`. 04:31: CI کامل سبز شد (verify شامل integration، و e2e: ۲۹۵ آزمون در حدود ۱۳ دقیقه)؛ PR قابل ادغام (clean) و منتظر مالک است.

## پرسش‌های نگه‌داشته برای مالک (2026-10-20، هنگام نبود مالک) — هر سه در 2026-10-20 تأیید شد (D102، commit `472bab7`)

1. hover فیلد متن در **تم تیره** (از پیش از این شاخه): کنتراست روی primary-tint به ۲٫۹۱ پایین می‌آید. همان قاعدهٔ تم روشن برای تم تیره هم اعمال شود؟
2. برچسب «Class image N» در `mediaAssetLabel` هنوز تأیید ندارد.
3. برگهٔ تأیید حذف حساب (`PrivacyView.tsx`) هنوز «…and server cleanup will begin. This cannot be undone.» دارد؛ این متن در طرح نیست و برای حذف «server cleanup» متن تازهٔ مصوب لازم است.

## ادغام و استقرار (2026-10-20)

- PR #67 با commit `b606e07` در `main` ادغام شد (درخواست صریح مالک؛ CI روی `472bab7` هنگام ادغام در جریان بود، head قبلی `3bb86fc` کاملاً سبز بود).
- چهار migration با `pnpm db:apply --apply` اعمال شد (آخرین نسخه `20261019120300`؛ grant نگهبان schema درست است).
- Vercel: `RECALINO_ALLOW_DRAFT_LEGAL=1` در Production ساخته شد؛ `BLOB_READ_WRITE_TOKEN` از Preview برداشته شد. حذف `RECALINO_SPIKE`، `SPIKE_TOKEN` و هفت سرّ Preview با ابزارهای این سشن ممکن نبود؛ مالک بعداً حذف می‌کند.
- استقرار production دستی ساخته شد: `dpl_GVzCLD7qQfpPH7UnR4fzANkQgrr1` (استقرار قبلی برای بازگشت: `dpl_CavJXpirHGYqav4v2VEWo7r83bo6`). در 08:41 UTC به READY رسید و `recalino.vercel.app` به آن وصل شد؛ `/api/health` پاسخ 200 داد. CI روی `472bab7`: verify و e2e هر دو سبز (e2e در 08:52 UTC).

## وضعیت پایانی (2026-10-19)

- شاخهٔ `audit-fixes/2026-10-18` روی `ac74633`: ۸۲ commit پس از `8a2a22d`؛ ۵۵۸ فایل (۱۵۲ تازه، ۳۰۰ تغییرکرده، ۴ جابه‌جاشده، ۱۰۲ حذف‌شده که ۸۹ تای آن خروج `.build` از ردیابی است).
- بررسی‌های پایانی: lint، typecheck، boundaries، ۴٬۲۲۸ آزمون واحد، build (بزرگ‌ترین Function ۱۷۱٫۲MB از ۲۲۵)، client-bundle و `pnpm audit --prod` سبز. **اجرانشده:** `pnpm test:int` و `pnpm test:e2e` (Docker در این محیط نیست).
- پس از دستهٔ ۱۵: head `c16cf42` (۹۶ commit در PR). پیش از آن، پس از دستهٔ ۱۲: head `81abf78`. push شد: `claude/optimistic-archimedes-xh9mr3` (روی `8a2a22d`) و `audit-fixes/2026-10-18`. PR: https://github.com/Ali-Paybarjay/recalino/pull/67 (به `claude/optimistic-archimedes-xh9mr3`). worktreeها و branchهای محلی `fix/audit-1` تا `fix/audit-12` باقی‌اند.
- `main` تا `48f61a3` در شاخه ادغام شد (`66efa83`، تعارض importهای `packages/core/src/proc/maintenance.ts` حل شد) و `claude/optimistic-archimedes-xh9mr3` روی remote تا `48f61a3` جلو برده شد؛ PR #67 قابل ادغام (clean) است.

### فهرست فایل‌های تغییرکرده در PR #67 (نسبت به پایهٔ `48f61a3`، تا `3bb86fc`؛ 638 files changed, 24584 insertions(+), 8937 deletions(-))

- `D` ۸۹ فایل زیر `artifacts/recalino-presentation/.build/` (فقط خروج از ردیابی git)
- `A` `.claude/hooks/data-loss-guard.ts`
- `M` `.claude/settings.json`
- `M` `.env.example`
- `A` `.github/dependabot.yml`
- `M` `.github/workflows/ci.yml`
- `M` `.gitignore`
- `M` `CLAUDE.md`
- `A` `README.md`
- `M` `apps/web/AGENTS.md`
- `M` `apps/web/e2e-preview/isolation.spec.ts`
- `M` `apps/web/e2e-preview/sources.spec.ts`
- `M` `apps/web/e2e/account.spec.ts`
- `M` `apps/web/e2e/background-uploads.spec.ts`
- `A` `apps/web/e2e/connection-errors.spec.ts`
- `M` `apps/web/e2e/course-materials.spec.ts`
- `M` `apps/web/e2e/helpers.ts`
- `M` `apps/web/e2e/learning-privacy.spec.ts`
- `M` `apps/web/e2e/learning-session.spec.ts`
- `M` `apps/web/e2e/multilingual-study.spec.ts`
- `M` `apps/web/e2e/organization.spec.ts`
- `M` `apps/web/e2e/processing-review.spec.ts`
- `M` `apps/web/e2e/recall-pronunciation.spec.ts`
- `M` `apps/web/e2e/recording-capture.spec.ts`
- `M` `apps/web/e2e/recording.spec.ts`
- `M` `apps/web/e2e/reference-study.spec.ts`
- `M` `apps/web/e2e/session-navigation-screens.spec.ts`
- `M` `apps/web/e2e/shell.spec.ts`
- `M` `apps/web/e2e/signin.spec.ts`
- `M` `apps/web/e2e/smoke.spec.ts`
- `M` `apps/web/e2e/source-original.spec.ts`
- `M` `apps/web/e2e/study.spec.ts`
- `A` `apps/web/e2e/terminology.spec.ts`
- `M` `apps/web/e2e/today.spec.ts`
- `M` `apps/web/e2e/upload-recovery.spec.ts`
- `M` `apps/web/e2e/voice-class.spec.ts`
- `M` `apps/web/e2e/voice.spec.ts`
- `M` `apps/web/next.config.ts`
- `M` `apps/web/package.json`
- `A` `apps/web/src/app/(app)/LearnerShell.test.ts`
- `M` `apps/web/src/app/(app)/LearnerShell.tsx`
- `A` `apps/web/src/app/(app)/RecordingShell.test.ts`
- `A` `apps/web/src/app/(app)/RecordingShell.tsx`
- `M` `apps/web/src/app/(app)/TermsNotice.tsx`
- `M` `apps/web/src/app/(app)/app.module.css`
- `M` `apps/web/src/app/(app)/courses/[id]/materials/page.tsx`
- `M` `apps/web/src/app/(app)/courses/page.tsx`
- `A` `apps/web/src/app/(app)/help/[id]/page.test.ts`
- `M` `apps/web/src/app/(app)/help/[id]/page.tsx`
- `M` `apps/web/src/app/(app)/help/new/page.tsx`
- `M` `apps/web/src/app/(app)/layout.tsx`
- `A` `apps/web/src/app/(app)/loading.test.ts`
- `A` `apps/web/src/app/(app)/loading.tsx`
- `A` `apps/web/src/app/(app)/me/LegalTexts.tsx`
- `A` `apps/web/src/app/(app)/me/ProfileSettings.test.ts`
- `M` `apps/web/src/app/(app)/me/ProfileSettings.tsx`
- `M` `apps/web/src/app/(app)/me/edit/[field]/EditField.module.css`
- `M` `apps/web/src/app/(app)/me/edit/[field]/EditField.tsx`
- `M` `apps/web/src/app/(app)/me/page.tsx`
- `M` `apps/web/src/app/(app)/me/profile.module.css`
- `M` `apps/web/src/app/(app)/me/quota/page.tsx`
- `A` `apps/web/src/app/(app)/nav.test.ts`
- `A` `apps/web/src/app/(app)/nav.ts`
- `A` `apps/web/src/app/(app)/page-headers.test.ts`
- `M` `apps/web/src/app/(app)/recordings/page.tsx`
- `M` `apps/web/src/app/(app)/sessions/[id]/notes/versions/page.tsx`
- `M` `apps/web/src/app/(app)/sessions/[id]/options/page.tsx`
- `M` `apps/web/src/app/(app)/sessions/[id]/record/page.tsx`
- `M` `apps/web/src/app/(app)/sessions/[id]/sources/material-page.tsx`
- `M` `apps/web/src/app/(app)/sessions/[id]/voice/page.tsx`
- `M` `apps/web/src/app/(app)/sessions/organize/page.tsx`
- `M` `apps/web/src/app/(app)/sessions/page.tsx`
- `A` `apps/web/src/app/(app)/texts-changed-on.ts`
- `M` `apps/web/src/app/(app)/today/page.tsx`
- `M` `apps/web/src/app/SignIn.module.css`
- `M` `apps/web/src/app/SignIn.tsx`
- `M` `apps/web/src/app/SignInForm.tsx`
- `M` `apps/web/src/app/api/health/route.ts`
- `M` `apps/web/src/app/auth/sign-out/route.ts`
- `A` `apps/web/src/app/deletion/deletion.module.css`
- `M` `apps/web/src/app/deletion/page.tsx`
- `D` `apps/web/src/app/dev/spike/[action]/route.ts`
- `M` `apps/web/src/app/dev/ui/UiKit.module.css`
- `M` `apps/web/src/app/dev/ui/learning/LearningReference.tsx`
- `M` `apps/web/src/app/dev/ui/learning/page.tsx`
- `M` `apps/web/src/app/dev/ui/profile/page.tsx`
- `A` `apps/web/src/app/dev/ui/recording-shell/page.tsx`
- `M` `apps/web/src/app/dev/ui/session/SessionReference.tsx`
- `M` `apps/web/src/app/dev/ui/session/page.tsx`
- `M` `apps/web/src/app/dev/ui/shell/page.module.css`
- `M` `apps/web/src/app/dev/ui/study/page.tsx`
- `M` `apps/web/src/app/dev/ui/voice/page.tsx`
- `M` `apps/web/src/app/layout.tsx`
- `M` `apps/web/src/app/preview/layout.tsx`
- `A` `apps/web/src/app/robots.test.ts`
- `A` `apps/web/src/app/robots.ts`
- `M` `apps/web/src/app/setup/SetupFrame.tsx`
- `M` `apps/web/src/app/setup/consent/ConsentAgain.tsx`
- `M` `apps/web/src/app/setup/labels.ts`
- `M` `apps/web/src/app/setup/languages.ts`
- `M` `apps/web/src/app/setup/setup.module.css`
- `M` `apps/web/src/app/setup/steps.tsx`
- `M` `apps/web/src/app/setup/voice/page.tsx`
- `M` `apps/web/src/legal/texts.generated.ts`
- `A` `apps/web/src/next-config.test.ts`
- `M` `apps/web/src/proxy.auth.test.ts`
- `M` `apps/web/src/proxy.preview.test.ts`
- `M` `apps/web/src/proxy.ts`
- `M` `apps/web/src/server/account-routes.ts`
- `M` `apps/web/src/server/admin-data.int.test.ts`
- `M` `apps/web/src/server/admin-data.ts`
- `M` `apps/web/src/server/admin-routes.ts`
- `A` `apps/web/src/server/admin-task-copy.test.ts`
- `M` `apps/web/src/server/api.test.ts`
- `M` `apps/web/src/server/api.ts`
- `M` `apps/web/src/server/auth/deletion-recovery.int.test.ts`
- `A` `apps/web/src/server/auth/deletion-stage.test.ts`
- `A` `apps/web/src/server/auth/deletion-stage.ts`
- `M` `apps/web/src/server/auth/flow.int.test.ts`
- `M` `apps/web/src/server/auth/gateway.test.ts`
- `M` `apps/web/src/server/auth/gateway.ts`
- `M` `apps/web/src/server/auth/learner.ts`
- `M` `apps/web/src/server/auth/return-path.test.ts`
- `M` `apps/web/src/server/auth/return-path.ts`
- `A` `apps/web/src/server/auth/supabase.test.ts`
- `M` `apps/web/src/server/auth/supabase.ts`
- `M` `apps/web/src/server/automatic-learning-message.test.ts`
- `M` `apps/web/src/server/automatic-learning-notifications.ts`
- `M` `apps/web/src/server/automatic-learning-routes.ts`
- `A` `apps/web/src/server/automatic-learning-statuses.int.test.ts`
- `A` `apps/web/src/server/automatic-learning-statuses.test.ts`
- `M` `apps/web/src/server/automatic-learning.int.test.ts`
- `M` `apps/web/src/server/automatic-learning.ts`
- `A` `apps/web/src/server/capture-flags.ts`
- `M` `apps/web/src/server/capture-staging-jobs.ts`
- `M` `apps/web/src/server/capture-staging.ts`
- `M` `apps/web/src/server/export-routes.ts`
- `A` `apps/web/src/server/health-alert-copy.test.ts`
- `A` `apps/web/src/server/health.test.ts`
- `A` `apps/web/src/server/health.ts`
- `M` `apps/web/src/server/jobs.int.test.ts`
- `M` `apps/web/src/server/jobs.test.ts`
- `M` `apps/web/src/server/jobs.ts`
- `M` `apps/web/src/server/lesson-review-routes.ts`
- `M` `apps/web/src/server/media-routes.ts`
- `A` `apps/web/src/server/native-runtime-boundary.test.ts`
- `M` `apps/web/src/server/note-recovery-routes.ts`
- `M` `apps/web/src/server/notification-routes.ts`
- `M` `apps/web/src/server/org-routes.ts`
- `M` `apps/web/src/server/pers-routes.ts`
- `M` `apps/web/src/server/preview-mode.test.ts`
- `M` `apps/web/src/server/privacy-composition.int.test.ts`
- `M` `apps/web/src/server/privacy-routes.ts`
- `M` `apps/web/src/server/processing-jobs.ts`
- `M` `apps/web/src/server/processing-routes.ts`
- `M` `apps/web/src/server/quota-routes.ts`
- `M` `apps/web/src/server/recording-routes.ts`
- `A` `apps/web/src/server/route-keys.test.ts`
- `M` `apps/web/src/server/routes.ts`
- `A` `apps/web/src/server/schema-version.generated.ts`
- `M` `apps/web/src/server/source-routes.ts`
- `D` `apps/web/src/server/spike-jobs.ts`
- `D` `apps/web/src/server/spike-voice.test.ts`
- `D` `apps/web/src/server/spike.ts`
- `M` `apps/web/src/server/storage.ts`
- `M` `apps/web/src/server/study-routes.ts`
- `M` `apps/web/src/server/support-routes.ts`
- `M` `apps/web/src/server/voice-routes.ts`
- `A` `apps/web/src/server/workspace.test.ts`
- `M` `apps/web/src/server/workspace.ts`
- `M` `apps/web/src/ui/admin/Admin.module.css`
- `M` `apps/web/src/ui/admin/CoreScreens.tsx`
- `A` `apps/web/src/ui/admin/PilotProgress.test.ts`
- `M` `apps/web/src/ui/admin/QuotaScreens.tsx`
- `A` `apps/web/src/ui/admin/SystemHealthCard.test.ts`
- `M` `apps/web/src/ui/admin/contracts.ts`
- `M` `apps/web/src/ui/admin/copy.ts`
- `M` `apps/web/src/ui/admin/model.test.ts`
- `M` `apps/web/src/ui/admin/model.ts`
- `M` `apps/web/src/ui/allowance-copy.ts`
- `A` `apps/web/src/ui/approved-copy.test.ts`
- `M` `apps/web/src/ui/components/Feedback.module.css`
- `M` `apps/web/src/ui/components/Feedback.tsx`
- `M` `apps/web/src/ui/components/Field.module.css`
- `M` `apps/web/src/ui/components/FileSelectionQueue.tsx`
- `M` `apps/web/src/ui/components/LegalDocument.module.css`
- `M` `apps/web/src/ui/components/ListPicker.module.css`
- `M` `apps/web/src/ui/components/ListPicker.tsx`
- `M` `apps/web/src/ui/components/SegmentedControl.module.css`
- `M` `apps/web/src/ui/components/Sheet.module.css`
- `M` `apps/web/src/ui/components/Sheet.tsx`
- `M` `apps/web/src/ui/components/Snackbar.module.css`
- `M` `apps/web/src/ui/components/Snackbar.tsx`
- `M` `apps/web/src/ui/components/Status.module.css`
- `M` `apps/web/src/ui/components/Status.tsx`
- `M` `apps/web/src/ui/components/StudyOverview.module.css`
- `M` `apps/web/src/ui/components/StudyOverview.tsx`
- `M` `apps/web/src/ui/components/Switch.module.css`
- `M` `apps/web/src/ui/experience-copy.ts`
- `M` `apps/web/src/ui/notifications/NotificationCenter.tsx`
- `A` `apps/web/src/ui/notifications/open-notifications-event.test.ts`
- `A` `apps/web/src/ui/notifications/open-notifications-event.ts`
- `M` `apps/web/src/ui/pending-copy.ts`
- `M` `apps/web/src/ui/preview/AccountViews.module.css`
- `M` `apps/web/src/ui/preview/AccountViews.tsx`
- `M` `apps/web/src/ui/preview/LearningViews.module.css`
- `M` `apps/web/src/ui/preview/LearningViews.tsx`
- `M` `apps/web/src/ui/preview/PreviewApp.tsx`
- `M` `apps/web/src/ui/preview/PreviewContext.tsx`
- `M` `apps/web/src/ui/preview/SourceViews.tsx`
- `M` `apps/web/src/ui/preview/WorkspaceViews.tsx`
- `A` `apps/web/src/ui/preview/heading-order.test.ts`
- `A` `apps/web/src/ui/preview/preview-links.tsx`
- `D` `apps/web/src/ui/preview/primitives.tsx`
- `M` `apps/web/src/ui/recording/MissingAudioNotice.tsx`
- `M` `apps/web/src/ui/recording/Recording.module.css`
- `A` `apps/web/src/ui/recording/RecordingProvider.test.ts`
- `M` `apps/web/src/ui/recording/RecordingProvider.tsx`
- `A` `apps/web/src/ui/recording/RecordingView.test.ts`
- `M` `apps/web/src/ui/recording/RecordingView.tsx`
- `A` `apps/web/src/ui/recording/SavedPartStatus.test.ts`
- `A` `apps/web/src/ui/recording/SavedPartStatus.tsx`
- `M` `apps/web/src/ui/recording/capture-diagnostics.ts`
- `A` `apps/web/src/ui/recording/capture-phase.test.ts`
- `A` `apps/web/src/ui/recording/capture-phase.ts`
- `A` `apps/web/src/ui/recording/recording-focus.test.ts`
- `A` `apps/web/src/ui/recording/recording-focus.ts`
- `A` `apps/web/src/ui/recording/recording-format.test.ts`
- `A` `apps/web/src/ui/recording/recording-format.ts`
- `M` `apps/web/src/ui/recording/source-sync.ts`
- `M` `apps/web/src/ui/recording/store.ts`
- `M` `apps/web/src/ui/shell/AppShell.module.css`
- `A` `apps/web/src/ui/shell/AppShell.test.ts`
- `M` `apps/web/src/ui/shell/AppShell.tsx`
- `A` `apps/web/src/ui/shell/FocusShell.module.css`
- `A` `apps/web/src/ui/shell/FocusShell.test.ts`
- `A` `apps/web/src/ui/shell/FocusShell.tsx`
- `M` `apps/web/src/ui/shell/Wordmark.tsx`
- `A` `apps/web/src/ui/strings-fill.ts`
- `A` `apps/web/src/ui/strings-settings.ts`
- `A` `apps/web/src/ui/strings-setup.ts`
- `A` `apps/web/src/ui/strings-shell.ts`
- `A` `apps/web/src/ui/strings-sign-in.ts`
- `A` `apps/web/src/ui/strings-status.ts`
- `M` `apps/web/src/ui/strings.test.ts`
- `M` `apps/web/src/ui/strings.ts`
- `M` `apps/web/src/ui/study-copy.ts`
- `M` `apps/web/src/ui/styles/app.css`
- `A` `apps/web/src/ui/styles/contrast.test.ts`
- `A` `apps/web/src/ui/styles/token-rules.test.ts`
- `A` `apps/web/src/ui/time-zone.test.ts`
- `A` `apps/web/src/ui/time-zone.ts`
- `M` `apps/web/src/ui/voice/ClassVoiceConfirmation.tsx`
- `M` `apps/web/src/ui/voice/OriginalRecovery.tsx`
- `M` `apps/web/src/ui/voice/Voice.module.css`
- `M` `apps/web/src/ui/voice/VoiceConfirmation.tsx`
- `M` `apps/web/src/ui/voice/VoiceLines.tsx`
- `M` `apps/web/src/ui/voice/VoiceProfile.tsx`
- `M` `apps/web/src/ui/voice/sample-capture.ts`
- `M` `apps/web/src/ui/voice/voice-copy.ts`
- `M` `apps/web/src/ui/workspace/AutomaticLearningProvider.tsx`
- `M` `apps/web/src/ui/workspace/AutomaticLearningView.module.css`
- `M` `apps/web/src/ui/workspace/AutomaticLearningView.test.ts`
- `M` `apps/web/src/ui/workspace/AutomaticLearningView.tsx`
- `M` `apps/web/src/ui/workspace/CardEditor.test.ts`
- `M` `apps/web/src/ui/workspace/CardEditor.tsx`
- `M` `apps/web/src/ui/workspace/CardFace.test.ts`
- `M` `apps/web/src/ui/workspace/CardFace.tsx`
- `M` `apps/web/src/ui/workspace/CardMedia.tsx`
- `M` `apps/web/src/ui/workspace/CardsView.test.ts`
- `M` `apps/web/src/ui/workspace/CardsView.tsx`
- `M` `apps/web/src/ui/workspace/ClassDirectory.module.css`
- `M` `apps/web/src/ui/workspace/ClassDirectory.tsx`
- `M` `apps/web/src/ui/workspace/ClassForm.tsx`
- `M` `apps/web/src/ui/workspace/CourseManager.tsx`
- `M` `apps/web/src/ui/workspace/CourseNavigation.tsx`
- `A` `apps/web/src/ui/workspace/ExportView.module.css`
- `M` `apps/web/src/ui/workspace/ExportView.tsx`
- `M` `apps/web/src/ui/workspace/LearningMemory.tsx`
- `M` `apps/web/src/ui/workspace/LearningProfile.tsx`
- `M` `apps/web/src/ui/workspace/LessonAdaptation.tsx`
- `M` `apps/web/src/ui/workspace/LessonReview.tsx`
- `M` `apps/web/src/ui/workspace/NoteView.module.css`
- `M` `apps/web/src/ui/workspace/NoteView.test.ts`
- `M` `apps/web/src/ui/workspace/NoteView.tsx`
- `A` `apps/web/src/ui/workspace/NotificationInvite.test.ts`
- `A` `apps/web/src/ui/workspace/NotificationInvite.tsx`
- `A` `apps/web/src/ui/workspace/PrivacyView.test.ts`
- `M` `apps/web/src/ui/workspace/PrivacyView.tsx`
- `M` `apps/web/src/ui/workspace/ProcessingView.test.ts`
- `M` `apps/web/src/ui/workspace/ProcessingView.tsx`
- `M` `apps/web/src/ui/workspace/PronunciationAudio.tsx`
- `M` `apps/web/src/ui/workspace/ReviewSettings.tsx`
- `A` `apps/web/src/ui/workspace/ReviewView.test.ts`
- `M` `apps/web/src/ui/workspace/ReviewView.tsx`
- `M` `apps/web/src/ui/workspace/SessionLearningSummary.tsx`
- `M` `apps/web/src/ui/workspace/SessionNextStep.tsx`
- `M` `apps/web/src/ui/workspace/SessionNotesReader.module.css`
- `M` `apps/web/src/ui/workspace/SourceRefViewer.tsx`
- `M` `apps/web/src/ui/workspace/SourcesView.tsx`
- `M` `apps/web/src/ui/workspace/UploadProvider.tsx`
- `A` `apps/web/src/ui/workspace/account-gate.tsx`
- `M` `apps/web/src/ui/workspace/api.test.ts`
- `M` `apps/web/src/ui/workspace/api.ts`
- `M` `apps/web/src/ui/workspace/automatic-learning-loop.ts`
- `M` `apps/web/src/ui/workspace/automatic-learning-recovery.ts`
- `M` `apps/web/src/ui/workspace/automatic-learning.ts`
- `A` `apps/web/src/ui/workspace/card-actions-copy.ts`
- `A` `apps/web/src/ui/workspace/card-actions.test.ts`
- `A` `apps/web/src/ui/workspace/card-actions.ts`
- `A` `apps/web/src/ui/workspace/card-labels.test.ts`
- `A` `apps/web/src/ui/workspace/card-labels.ts`
- `M` `apps/web/src/ui/workspace/class-notes-pronunciation.test.ts`
- `M` `apps/web/src/ui/workspace/class-notes-pronunciation.ts`
- `A` `apps/web/src/ui/workspace/delete-buttons.test.ts`
- `A` `apps/web/src/ui/workspace/error-copy.ts`
- `M` `apps/web/src/ui/workspace/file-processing.test.ts`
- `M` `apps/web/src/ui/workspace/file-processing.ts`
- `M` `apps/web/src/ui/workspace/learning-memory-copy.ts`
- `A` `apps/web/src/ui/workspace/learning-progress-copy.ts`
- `M` `apps/web/src/ui/workspace/learning-progress.test.ts`
- `M` `apps/web/src/ui/workspace/learning-progress.ts`
- `M` `apps/web/src/ui/workspace/manual-audio-manager.ts`
- `A` `apps/web/src/ui/workspace/media-alt.test.ts`
- `A` `apps/web/src/ui/workspace/media-alt.ts`
- `M` `apps/web/src/ui/workspace/primitives.tsx`
- `A` `apps/web/src/ui/workspace/privacy-copy.ts`
- `A` `apps/web/src/ui/workspace/review-focus.test.ts`
- `A` `apps/web/src/ui/workspace/review-focus.ts`
- `M` `apps/web/src/ui/workspace/session-state.test.ts`
- `M` `apps/web/src/ui/workspace/session-state.ts`
- `A` `apps/web/src/ui/workspace/source-labels.ts`
- `A` `apps/web/src/ui/workspace/terms-notice-event.test.ts`
- `A` `apps/web/src/ui/workspace/terms-notice-event.ts`
- `M` `apps/web/src/ui/workspace/upload-manager.ts`
- `M` `apps/web/src/ui/workspace/upload-problems.ts`
- `R072` `apps/web/src/ui/preview/preview.css` `apps/web/src/ui/workspace/workspace.css`
- `M` `apps/web/tools/native-build-adapter.mjs`
- `M` `apps/web/tools/native-build-adapter.test.mjs`
- `M` `apps/web/tools/trace-native-dependencies.mjs`
- `M` `apps/web/tools/trace-native-dependencies.test.mjs`
- `M` `docs/API_CONTRACTS.md`
- `M` `docs/PRODUCT_DECISIONS_LOG.md`
- `M` `docs/PROJECT_SPEC.md`
- `M` `docs/adr/0001-stack-and-hosting.md`
- `M` `docs/design/HANDOFF_R1_REVIEW.md`
- `A` `docs/design/RECORDING_NAVIGATION_2026-10-19.md`
- `M` `docs/design/REFERENCE_STUDY_OUTPUT_2026-10-06.md`
- `M` `docs/design/UI_COPY_PENDING.md`
- `A` `docs/design/UI_TOKEN_FOLLOWUPS_2026-10-19.md`
- `R100` `claude promps/CODEX_PROMPT.md` `docs/design/reference-output/CODEX_PROMPT.md`
- `R100` `claude promps/class-notes-reference.html` `docs/design/reference-output/class-notes-reference.html`
- `R100` `claude promps/flashcards-reference.html` `docs/design/reference-output/flashcards-reference.html`
- `M` `docs/fr/VOC.md`
- `M` `docs/legal/CLASSROOM_NOTICE.md`
- `M` `docs/legal/PILOT_TECHNICAL_FACTS.md`
- `M` `docs/legal/README.md`
- `M` `docs/legal/consents.md`
- `M` `docs/legal/privacy-notice.md`
- `A` `docs/ops/BRANCH_PROTECTION_FA.md`
- `M` `docs/ops/CI_LOW_COST_POLICY.md`
- `M` `docs/ops/CLOUD_ENVIRONMENT_FA.md`
- `M` `docs/ops/GOOGLE_OAUTH_SETUP_FA.md`
- `M` `docs/plans/M4_QUEUE_STORAGE.md`
- `M` `docs/plans/M5_MVP_COMPLETION.md`
- `M` `docs/plans/RELEASE_RUNBOOK_2026-10-12.md`
- `M` `docs/plans/RELEASE_SECURITY_REVIEW_2026-10-12.md`
- `M` `docs/runbooks/BACKUP_RESTORE.md`
- `A` `docs/runbooks/CLOUD_AUTH_CONFIG.md`
- `M` `docs/runbooks/CLOUD_SETUP.md`
- `A` `docs/runbooks/DATA_ACCESS_REQUEST.md`
- `M` `docs/runbooks/GOOGLE_OAUTH.md`
- `M` `docs/runbooks/SECRETS.md`
- `M` `package.json`
- `M` `packages/core/src/acc/acc.test.ts`
- `M` `packages/core/src/acc/account.ts`
- `M` `packages/core/src/acc/documents.ts`
- `M` `packages/core/src/aip/contracts.ts`
- `M` `packages/core/src/aip/openrouter.test.ts`
- `M` `packages/core/src/aip/openrouter.ts`
- `M` `packages/core/src/aip/pricing.test.ts`
- `A` `packages/core/src/anki/export-list-read-budget.test.ts`
- `A` `packages/core/src/anki/export-read-budget.int.test.ts`
- `A` `packages/core/src/anki/export-request-read-budget.test.ts`
- `A` `packages/core/src/anki/export-snapshot.test.ts`
- `M` `packages/core/src/anki/exports.ts`
- `M` `packages/core/src/card/cards.ts`
- `M` `packages/core/src/card/index.ts`
- `M` `packages/core/src/card/projections.ts`
- `A` `packages/core/src/card/reviewable-read-budget.test.ts`
- `A` `packages/core/src/card/revision-snapshot.test.ts`
- `M` `packages/core/src/card/study-content.ts`
- `M` `packages/core/src/db/connection.test.ts`
- `M` `packages/core/src/db/connection.ts`
- `A` `packages/core/src/db/foreign-key-indexes.int.test.ts`
- `M` `packages/core/src/db/types.ts`
- `A` `packages/core/src/html/export-list-read-budget.test.ts`
- `A` `packages/core/src/html/export-snapshot.test.ts`
- `M` `packages/core/src/html/exports.ts`
- `M` `packages/core/src/lkm/card-html.test.ts`
- `M` `packages/core/src/lkm/card-html.ts`
- `M` `packages/core/src/lkm/index.ts`
- `M` `packages/core/src/lkm/study-locale.ts`
- `M` `packages/core/src/lkm/study-multilingual.test.ts`
- `M` `packages/core/src/lkm/study-render.test.ts`
- `M` `packages/core/src/lkm/study-render.ts`
- `M` `packages/core/src/lkm/versions.ts`
- `M` `packages/core/src/media/assets.ts`
- `M` `packages/core/src/media/index.ts`
- `M` `packages/core/src/note/index.ts`
- `M` `packages/core/src/note/notebooks.ts`
- `A` `packages/core/src/note/published-read-budget.test.ts`
- `M` `packages/core/src/ops/admin-contracts.ts`
- `M` `packages/core/src/ops/admin-read.ts`
- `A` `packages/core/src/ops/admin-tasks.test.ts`
- `M` `packages/core/src/ops/backups.int.test.ts`
- `A` `packages/core/src/ops/backups.test.ts`
- `M` `packages/core/src/ops/backups.ts`
- `A` `packages/core/src/ops/deletion-journal-state.ts`
- `A` `packages/core/src/ops/health.int.test.ts`
- `A` `packages/core/src/ops/health.test.ts`
- `A` `packages/core/src/ops/health.ts`
- `M` `packages/core/src/ops/index.ts`
- `M` `packages/core/src/org/common.ts`
- `M` `packages/core/src/org/index.ts`
- `M` `packages/core/src/org/sessions.ts`
- `M` `packages/core/src/plt/errors.ts`
- `M` `packages/core/src/plt/export.ts`
- `A` `packages/core/src/plt/health.ts`
- `M` `packages/core/src/plt/index.ts`
- `M` `packages/core/src/plt/jobs.ts`
- `M` `packages/core/src/plt/log.test.ts`
- `M` `packages/core/src/plt/log.ts`
- `M` `packages/core/src/plt/maintenance.ts`
- `A` `packages/core/src/plt/schema-version.int.test.ts`
- `A` `packages/core/src/plt/schema-version.test.ts`
- `A` `packages/core/src/plt/schema-version.ts`
- `A` `packages/core/src/plt/security-retention.int.test.ts`
- `A` `packages/core/src/plt/security-retention.test.ts`
- `M` `packages/core/src/plt/security.ts`
- `M` `packages/core/src/plt/settings.ts`
- `A` `packages/core/src/plt/snapshot.test.ts`
- `A` `packages/core/src/plt/snapshot.ts`
- `D` `packages/core/src/plt/spike.ts`
- `A` `packages/core/src/plt/storage-vercel-blob.test.ts`
- `M` `packages/core/src/plt/storage-vercel-blob.ts`
- `M` `packages/core/src/priv/deletion.ts`
- `M` `packages/core/src/priv/index.ts`
- `A` `packages/core/src/priv/jobs.int.test.ts`
- `A` `packages/core/src/priv/jobs.test.ts`
- `A` `packages/core/src/priv/jobs.ts`
- `A` `packages/core/src/proc/automatic-sessions-read-budget.test.ts`
- `M` `packages/core/src/proc/automatic-state.ts`
- `M` `packages/core/src/proc/contracts.ts`
- `A` `packages/core/src/proc/create-run.test.ts`
- `A` `packages/core/src/proc/ended-job-reconcile.int.test.ts`
- `M` `packages/core/src/proc/index.ts`
- `M` `packages/core/src/proc/knowledge-generation.test.ts`
- `M` `packages/core/src/proc/knowledge-generation.ts`
- `M` `packages/core/src/proc/maintenance.test.ts`
- `M` `packages/core/src/proc/maintenance.ts`
- `A` `packages/core/src/proc/processing-job.test.ts`
- `M` `packages/core/src/proc/processing-review.ts`
- `M` `packages/core/src/proc/run-stage.ts`
- `M` `packages/core/src/proc/runs.ts`
- `A` `packages/core/src/proc/steps/audio-source.test.ts`
- `A` `packages/core/src/proc/steps/audio-source.ts`
- `A` `packages/core/src/proc/steps/context.ts`
- `A` `packages/core/src/proc/steps/extract-sources.test.ts`
- `A` `packages/core/src/proc/steps/extract-sources.ts`
- `A` `packages/core/src/proc/steps/fail-run.test.ts`
- `A` `packages/core/src/proc/steps/fail-run.ts`
- `A` `packages/core/src/proc/steps/image-sources.test.ts`
- `A` `packages/core/src/proc/steps/image-sources.ts`
- `A` `packages/core/src/proc/steps/knowledge-checks.test.ts`
- `A` `packages/core/src/proc/steps/knowledge-checks.ts`
- `A` `packages/core/src/proc/steps/legacy-knowledge-repair.test.ts`
- `A` `packages/core/src/proc/steps/legacy-knowledge-repair.ts`
- `A` `packages/core/src/proc/steps/lesson-input.test.ts`
- `A` `packages/core/src/proc/steps/lesson-input.ts`
- `A` `packages/core/src/proc/steps/lesson-knowledge.test.ts`
- `A` `packages/core/src/proc/steps/lesson-knowledge.ts`
- `A` `packages/core/src/proc/steps/lesson-parts.test.ts`
- `A` `packages/core/src/proc/steps/lesson-parts.ts`
- `A` `packages/core/src/proc/steps/lesson.test.ts`
- `A` `packages/core/src/proc/steps/lesson.ts`
- `A` `packages/core/src/proc/steps/pdf-source.test.ts`
- `A` `packages/core/src/proc/steps/pdf-source.ts`
- `A` `packages/core/src/proc/steps/publish.test.ts`
- `A` `packages/core/src/proc/steps/publish.ts`
- `A` `packages/core/src/proc/steps/runtime.test.ts`
- `A` `packages/core/src/proc/steps/runtime.ts`
- `A` `packages/core/src/proc/steps/start.test.ts`
- `A` `packages/core/src/proc/steps/start.ts`
- `A` `packages/core/src/proc/steps/vision.ts`
- `A` `packages/core/src/proc/steps/voice-check.test.ts`
- `A` `packages/core/src/proc/steps/voice-check.ts`
- `A` `packages/core/src/proc/steps/voice-correction.test.ts`
- `A` `packages/core/src/proc/steps/voice-correction.ts`
- `A` `packages/core/src/proc/today-status-read-budget.test.ts`
- `M` `packages/core/src/proc/worker.ts`
- `M` `packages/core/src/quota/costs.ts`
- `M` `packages/core/src/quota/index.ts`
- `M` `packages/core/src/quota/ledger.ts`
- `A` `packages/core/src/quota/spend-totals.test.ts`
- `M` `packages/core/src/src/index.ts`
- `M` `packages/core/src/src/projections.ts`
- `M` `packages/core/src/src/verifier.test.ts`
- `M` `packages/core/src/src/verifier.ts`
- `A` `packages/core/src/srs/review-snapshot.test.ts`
- `M` `packages/core/src/srs/review.int.test.ts`
- `M` `packages/core/src/srs/review.ts`
- `M` `packages/core/src/support/email.ts`
- `M` `packages/core/src/support/index.ts`
- `M` `packages/core/src/support/support.test.ts`
- `A` `packages/core/test/processing-run.ts`
- `A` `packages/core/test/statement-log.ts`
- `M` `packages/ops-cli/src/backup.ts`
- `M` `pnpm-lock.yaml`
- `M` `pnpm-workspace.yaml`
- `M` `supabase/config.toml`
- `A` `supabase/migrations/20261019120000_plt_event_retention.sql`
- `A` `supabase/migrations/20261019120100_schema_version_read_grant.sql`
- `A` `supabase/migrations/20261019120200_hot_foreign_key_indexes.sql`
- `A` `supabase/migrations/20261019120300_admin_pilot_progress.sql`
- `A` `tools/claude-hooks/data-loss-guard.test.ts`
- `M` `tools/configure-runtime-env.mjs`
- `M` `tools/db-apply/plan.test.ts`
- `M` `tools/db-apply/plan.ts`
- `A` `tools/env-example.test.ts`
- `A` `tools/function-size/check.ts`
- `A` `tools/function-size/scan.test.ts`
- `A` `tools/function-size/scan.ts`
- `M` `tools/legal/build.ts`
- `A` `tools/legal/guard.test.ts`
- `A` `tools/legal/guard.ts`
- `A` `tools/schema-version/build.test.ts`
- `A` `tools/schema-version/build.ts`
- `D` `tools/spikes/cloud-drive.mjs`
- `D` `tools/spikes/queue/contract.ts`
- `D` `tools/spikes/queue/pgboss-queue.ts`
- `D` `tools/spikes/queue/queue.int.test.ts`
- `D` `tools/spikes/queue/steps.ts`
- `D` `tools/spikes/queue/table-queue.ts`
- `D` `tools/spikes/vitest.config.ts`
- `M` `tools/voice/README.md`
- `A` `tools/voice/fetch-models.d.mts`
- `M` `tools/voice/fetch-models.mjs`
- `A` `tools/voice/fetch-models.test.ts`
- `M` `vitest.config.ts`
