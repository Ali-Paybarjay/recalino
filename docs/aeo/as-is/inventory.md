# Recalino — Inventory (brownfield-intake، بند ۲)

- Task Card: `REC-1` · پایه: `a1d559b` · تاریخ: 2026-10-30
- برچسب‌ها: **[M]** = Observed by model؛ **[NV]** = Not Verified.
- **محدودیت:** متن skill ‏`brownfield-intake` در این Job خواندنی نبود؛ دسترسی خواندن به مسیر plugin رد شد. ستون‌های این جدول از روی متن Task Card ساخته شده‌اند: «inventory و تصمیم پیشنهادی برای هر مورد». اگر بند ۲ ستون یا واژگان تصمیم دیگری می‌خواهد، این جدول باید با آن هم‌خوان شود. [NV]
- واژگان تصمیم پیشنهادی:
  - **Keep:** بماند.
  - **Keep+ADR:** بماند و تصمیمش ثبت شود.
  - **Refactor:** بماند ولی اصلاح شود.
  - **Retire:** حذف یا بایگانی شود.
  - **Investigate:** پیش از تصمیم، شواهد بیشتری لازم است.
- این تصمیم‌ها پیشنهادند. اجرای هر کدام Task Card جدا و تأیید مالک می‌خواهد.
- اصلاح کم‌ریسک `REC-5` (2026-10-31، پایه `a31cce4`): یافته‌های F-5 و F-10 از REC-1-review در این سند اعمال شدند. ستون «تصمیم پیشنهادی» تغییر نکرد. فهرست اعمال‌شده و اعمال‌نشده در [risk-register.md بخش ۷](risk-register.md) است.

## ۱. کد و بسته‌ها

| ID | مورد | مسیر | وضعیت مشاهده‌شده | شاهد | تصمیم پیشنهادی |
|---|---|---|---|---|---|
| INV-01 | اپ وب Next.js | `apps/web/` | ۸۲۷ فایل؛ ۶۵ route API؛ Cron دقیقه‌ای | `apps/web/package.json`، `apps/web/vercel.json` [M] | Keep |
| INV-02 | هستهٔ دامنه | `packages/core/src/` | ۲۰ ماژول با مرز اجراشده؛ ماژول بیست‌ویکم، `rec`، فقط در capability map است و در core پوشه ندارد (INV-04، RR-21) | `tools/capability-map.json`، `1445b3a` [M] | Keep |
| INV-03 | ماژول `proc` | `packages/core/src/proc/` | بزرگ‌ترین ماژول؛ در #67 به `steps/*` شکسته شد | fix-tracker دستهٔ ۱۰ و ۱۸ [M] | Keep؛ نوشتن FR-PROC (INV-30) |
| INV-04 | ماژول `rec` | `apps/web/src/ui/recording/` | در capability map هست ولی در core پوشه ندارد | `tools/capability-map.json` [M] | Investigate: آیا مرز `rec → src` در کد web هم بررسی می‌شود؟ |
| INV-05 | ابزار اپراتور | `packages/ops-cli/` | ارزیابی، پشتیبان، زمان‌سنجی | `packages/ops-cli/package.json` [M] | Keep |
| INV-06 | migrationها | `supabase/migrations/` | ۵۶ فایل؛ دو فایل پیش از ادغام ویرایش شدند | `36db6f0`، `d612040`، `9017557` [M] | Keep |
| INV-07 | نوع‌های تولیدشدهٔ DB | `packages/core/src/db/types.ts` | CI آن را با migrationها مقایسه می‌کند | `.github/workflows/ci.yml` [M] | Keep |
| INV-08 | فایل‌های تولیدشده | `apps/web/src/legal/texts.generated.ts`، `apps/web/src/server/schema-version.generated.ts` | در build ساخته و commit می‌شوند | `package.json` [M] | Keep |

## ۲. وابستگی‌ها

| ID | مورد | مسیر | وضعیت | شاهد | تصمیم پیشنهادی |
|---|---|---|---|---|---|
| INV-10 | `pg-boss` `12.35.1` | `package.json` خط ۴۵ | ADR-0003 آن را رد کرده و حذفش را پیامد گرفته است؛ هیچ import یا مصرفی در کد پیدا نشد | `1da668e`، fix-tracker خط ۱۶ [M] | Retire |
| INV-11 | `sherpa-onnx-node` | `apps/web` | موتور صدا داخل Function | `28447be` [M] | Keep+ADR |
| INV-12 | `ffmpeg-static` | `apps/web`، `packages/ops-cli` | ADR-0001 آن را «فقط در صورت نیاز» گذاشته بود؛ اکنون فعال است | `audio-preparer.ts` [M] | Keep+ADR |
| INV-13 | `fflate` برای `.apkg` | `packages/core` | ADR جداگانه‌ای که ADR-0001 خواسته بود نوشته نشده است | `anki/package.ts` [M] | Keep+ADR |
| INV-14 | `web-push` | `apps/web` | اعلان پایان پردازش (D47) | `1d9676b` [M] | Keep+ADR |
| INV-15 | `nodemailer` و Gmail | `packages/core` | فرستندهٔ «موقت» پایلوت (D42) | `7856cda` [M] | Investigate: آیا برای پس از پایلوت جایگزین لازم است؟ |
| INV-16 | `sharp`، `@napi-rs/canvas`، `pdfjs-dist` | `apps/web`، `packages/core` | باینری native؛ نگهبان اندازهٔ Function | `tools/function-size/` [M] | Keep |

## ۳. پیکربندی و زیرساخت

| ID | مورد | مسیر | وضعیت | شاهد | تصمیم پیشنهادی |
|---|---|---|---|---|---|
| INV-20 | پیش‌فرض‌های provider | `config/openrouter-defaults.json` | پیش‌فرض اصلاح گفتاری هنوز Haiku 4.5 است، در حالی که D57 به Gemini رأی داده است | D57 خط ۵۱۸ [M]؛ env production [NV] | Investigate: هم‌خوان‌سازی مخزن با production یا ثبت صریح تفاوت |
| INV-21 | سیاست هزینهٔ پایلوت | `config/pilot-cost-policy.json`، `config/pilot-defaults.json` | سقف‌های D37 و D56 | `docs/PRODUCT_DECISIONS_LOG.md` [M] | Keep |
| INV-22 | CI | `.github/workflows/ci.yml` | کم‌مصرف؛ e2e با برچسب | #49، D84 [M] | Keep |
| INV-23 | ruleset ‏`main` و Deployment Checks | GitHub و Vercel | تصویب شده (D83) ولی اجرایش با مالک است؛ یک push مستقیم کد (`b4aa3d5`) قبل از آن دیده می‌شود | `docs/ops/BRANCH_PROTECTION_FA.md` [M]؛ وضعیت فعلی [NV] | Investigate |
| INV-24 | مجوزها و hook عامل | `.claude/settings.json`، `.claude/hooks/data-loss-guard.ts` | allow گسترده همراه گارد SQL | D81 [M] | Keep؛ بازبینی امنیتی دوره‌ای |
| INV-25 | پشتیبان روی میزبان Windows | `tools/backup/*.ps1` | وابسته به یک میزبان روشن و متصل | `docs/runbooks/BACKUP_RESTORE.md` خط ۴۲ [M] | Keep+ADR؛ Investigate: نقطهٔ شکست واحد |
| INV-26 | تنظیمات Supabase محلی | `supabase/config.toml` | مقدارهای localhost؛ `config push` آن‌ها روی ابر می‌نویسد و ورود را می‌شکند | `CLAUDE.md` بخش Supabase MCP [M] | Keep (با همان هشدار) |

## ۴. اسناد

| ID | مورد | مسیر | وضعیت | شاهد | تصمیم پیشنهادی |
|---|---|---|---|---|---|
| INV-30 | FRهای ماژول‌ها | `docs/fr/` | فقط ۷ ماژول FR دارند (ACC، ORG، PLT، QUOTA، SRC، SUPPORT، VOC) | `git grep` بدون نتیجه برای `FR-PROC-` و مشابه آن [M] | Refactor: FR برای PROC، LKM، CARD، SRS، REC و NOTE نوشته شود، یا ارجاع جایگزین ثبت شود |
| INV-31 | ADRها | `docs/adr/` | فقط سه ADR وجود دارد؛ ۱۳ تصمیم ضمنی در `history.md` بخش ۵ آمده است | [M] | Refactor: ADR تکمیلی برای IMP-01 تا IMP-08 |
| INV-32 | دفتر تصمیم‌ها | `docs/PRODUCT_DECISIONS_LOG.md` | D28 تا D110؛ D30 عمداً خالی است | [M] | Keep؛ قاعدهٔ رزرو شناسه برای شاخه‌های موازی |
| INV-33 | اسناد معماری | `docs/architecture/01..05` | #75 | [M] | Keep؛ مرجع As-Is فنی |
| INV-34 | طرح‌ها و گزارش‌ها | `docs/plans/` (۳۶ فایل) | اسناد تاریخ‌دار؛ بسیاری از آن‌ها گزارش تحویل‌اند | [M] | Keep؛ برچسب «تاریخی» برای موارد بسته‌شده |
| INV-35 | ارزیابی Haiku 5.5 | `tools/eval/haiku55-*`، `packages/core/src/proc/haiku55-worker.int.test.ts`، `docs/*/HAIKU55_MIGRATION_2026-10-08.md` | ارزیابی نهایی FAIL بود و مدل فعال نشد | `docs/design/HAIKU55_MIGRATION_2026-10-08.md` خط ۵ [M] | Investigate: آیا هنوز در CI مصرفی دارد؟ اگر ندارد، Retire یا بایگانی |
| INV-36 | متن‌های حقوقی | `docs/legal/` | پیش‌نویس؛ نسخهٔ ۰٫۳ اطلاعیهٔ حریم خصوصی (D94)؛ G11 باز است | `docs/legal/privacy-notice.md` خط ۳ («Version 0.3»)؛ D94 در `docs/audit/2026-10-18-fix-tracker.md` خط ۲۴ [M] | Keep |

## ۵. داده و شواهد

| ID | مورد | مسیر | وضعیت | شاهد | تصمیم پیشنهادی |
|---|---|---|---|---|---|
| INV-40 | شواهد verification | `artifacts/` (۴۳۱ فایل) | JSON و PNG از استقرارها و آزمون‌ها؛ نام برخی فایل‌ها به اسرار اشاره دارد (`secret-check.json`، `production-secret-metadata.json`). محتوایشان خوانده نشد | `git ls-files artifacts` [M]؛ محتوا [NV] | Investigate (بازبین امنیت) |
| INV-41 | شناسهٔ پروژهٔ Supabase | ۵۴ فایل ردیابی‌شده (از جمله `CLAUDE.md` و ADR-0001) | شناسهٔ زیرساخت؛ secret نیست | `git grep -l` [M] | Investigate: آیا انتشار آن پذیرفته است؟ |
| INV-42 | نشانی ایمیل با الگوی Gmail | ۳۲ فایل؛ در کد: `packages/core/src/support/presentation.ts` و دو فایل آزمون | فرستندهٔ پایلوت (D42) | `git grep -l` [M] | Investigate: انتقال به config یا env |
| INV-43 | الگوهای شبیه کلید | `tools/client-bundle/scan.test.ts`، چهار فایل آزمون با رشتهٔ اتصال Postgres | به نظر fixture آزمون‌اند؛ مقدارها بازتولید نشدند | `git grep -l` [M]؛ واقعی بودن [NV] | Keep (fixture)؛ تأیید بازبین امنیت |
| INV-44 | دادهٔ seed | `supabase/seed.sql` | طبق ADR-0002 فقط مصنوعی است | ADR-0002 قاعدهٔ ۵ [M] | Keep |
