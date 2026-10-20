# ممیزی جامع پروژه و محصول — Recalino

## ۱. مشخصات

| مورد | مقدار |
|---|---|
| پروژه | Recalino (ریکالینو)، فضای یادگیری انگلیسی مبتنی بر کلاس |
| تاریخ | 2026-10-18 |
| شاخه و commit | `claude/optimistic-archimedes-xh9mr3` روی `8a2a22d` (هم‌سطح `main` پس از Merge #64) |
| تغییرات commitنشده | پیش از ممیزی هیچ. اکنون فقط همین گزارش و پوشهٔ شاهدها در `docs/audit/` |
| حالت و محدوده | `auto fix` با ultracode. کل مخزن، به‌علاوهٔ خواندن فقط‌خواندنی Supabase، Vercel و GitHub |
| مخزن | خصوصی (`Ali-Paybarjay/recalino`). گزارش طبق قاعده commit نشده است |

**بررسی‌های اجراشده:**

- `pnpm install --frozen-lockfile`
- lint، typecheck و boundaries
- ۳٬۵۳۲ آزمون واحد
- `pnpm build` و `check:client-bundle`
- `pnpm audit` و `pnpm outdated`
- جست‌وجوی secret در فایل‌ها و تاریخچهٔ git
- advisorهای امنیت و کارایی Supabase، فهرست migrationهای ابری و یک `select` تجمیعی روی جدول پشتیبان
- پروژه، env، دامنه‌ها و deploymentهای Vercel (فقط نام‌ها)
- هدرهای production
- آزمون زندهٔ ۴۹ صفحهٔ `/preview` در عرض ۳۷۵ و ۱۴۴۰ با axe، شامل screenshot، console، شبکه و کیبورد
- بررسی دستی هشت حوزه در دو گذر مستقل
- دو دور «تلاش برای رد» برای همهٔ یافته‌های High

**بررسی‌های اجرانشده:** آزمون‌های integration و e2e، Lighthouse، gitleaks یا trufflehog، و آزمون زندهٔ مسیرهای واقعی با حساب. دلیل هر کدام در بخش ۱۱ آمده است.

## ۲. خلاصهٔ مدیریتی

**حکم انتشار: «آماده با شرط».** هیچ مورد Critical پیدا نشد و فقط یک مورد High وجود دارد. پایهٔ امنیت داده محکم است: مالکیت داده در هر مسیر، آزمون عبور از حساب، RLS، idempotency و اعتبارسنجی خروجی AI. شرط اصلی پیش از دعوت زبان‌آموزان، رفع وضعیت پشتیبان است. دروازهٔ شناخته‌شدهٔ متن حقوقی (G11) هم باید بسته شود.

**پنج ریسک مهم:**

1. **پشتیبان دیتابیس سه روز است بی‌صدا شکست می‌خورد** (OPS-01). آخرین نسخهٔ سالم 2026-10-15 است. job نگهداری حدود 2026-11-14 همین نسخه را هم پاک می‌کند.
2. **پردازش گیرکرده** (PRD-02). اگر پردازش یک کلاس از سقف زمان بگذرد، برای همیشه «در حال پردازش» می‌ماند، سهمیه را نگه می‌دارد و کاربر راه بازگشتی ندارد.
3. **open redirect** (SEC-01). لینکی از دامنهٔ خود ریکالینو می‌تواند کاربر را بعد از ورود به سایت فیشینگ ببرد.
4. **راه‌های دسترسی پرقدرت و غیرضروری:**
   - مسیر آزمایشی spike با دسترسی به فایل همهٔ کاربران (SEC-02)؛
   - SQL مخرب بی‌پرسش برای Claude Code (SEC-05)؛
   - Preview وصل به دادهٔ پایلوت (OPS-03).
5. **هیچ پایش یا هشداری در production نیست** (OPS-02). متن‌های حقوقی پیش‌نویس هم بی‌گارد منتشر می‌شوند (PRD-01).

**پنج quick win** (اثر زیاد با تلاش کم):

1. **رفع `safeReturnPath`** (SEC-01).
2. **هدرهای امنیتی** (SEC-03).
3. **حذف متن کهنهٔ «coming next in the pilot»** از صفحهٔ ورود (UX-01).
4. **حالت hover دکمه‌های secondary** (UI-01).
5. **مدیریت فوکوس «Show answer»** در مرور روزانه (A11Y-03).

## ۳. کارنامه

| حوزه | امتیاز از ۱۰ | توجیه |
|---|---|---|
| امنیت (`SEC`) | ۷ | مالکیت، CSRF، rate limit، RLS و اعتبارسنجی AI عالی‌اند. open redirect، spike، هدرها و مجوزهای Claude Code هنوز باز هستند. |
| کیفیت کد (`QUA`) | ۷٫۵ | بدون `any` و `@ts-ignore`، با ۳٬۵۳۲ آزمون و مرز ماژول اجباری. یک تابع ۱٬۴۰۰ خطی هست و فهرست env ناقص است. |
| کارایی (`PERF`) | ۷ | indexهای داغ و timeoutهای provider درست‌اند. باینری بومی در همهٔ Functionها، N+1 در صف مرور و round-trip Auth در هر درخواست هست. |
| رابط کاربری (`UI`) | ۷٫۵ | token، تم تیره، RTL و بی‌اسکرول افقی در ۴۹ صفحه درست‌اند. hover دکمه‌ها از کار افتاده و مقیاس تایپ موازی شده است. |
| تجربهٔ کاربری (`UX`) | ۶ | مسیر اصلی کامل است. متن‌ها کهنه یا فنی‌اند، حذف بی‌تأیید است، ضبط ناوبری دارد و پس از Stop اصطکاک زیاد است. |
| دسترس‌پذیری (`A11Y`) | ۷ | landmark، skip link، label و axe بدون rule غیرفعال درست‌اند. کنتراست مرز فرم، `lang` و فوکوس مرور مشکل دارند. |
| آمادگی محصول (`PRD`) | ۶٫۵ | قابلیت‌های MVP و حذف حساب کامل‌اند. متن حقوقی پیش‌نویس است، Run گیرکرده می‌شود و قیف پایلوت دیده نمی‌شود. |
| DevOps (`OPS`) | ۴٫۵ | CI دقیقاً با الگوی کم‌مصرف می‌خواند. یک High (پشتیبان)، پایش صفر، Preview روی دادهٔ پایلوت و build شکننده دارد. |

## ۴. مقایسه با گزارش قبلی

در `docs/audit/` گزارش ممیزی قبلی نبود. نزدیک‌ترین مرجع، `docs/plans/RELEASE_SECURITY_REVIEW_2026-10-12.md` است:

- **S1 (دروازهٔ ضبط وابسته به کلید کلاینت): رفع‌شده.** `staged-audio.ts` حالا lease ضبط باز را لازم دارد، ولی سند هنوز آن را باز نشان می‌دهد (SEC-10).
- **S2 و S3: دوباره سنجیده نشدند.** S2 حذف نسخهٔ staged وسط رونویسی است و S3 JSON نامعتبر تنظیمات صدا.
- **مورد تازه:** همهٔ یافته‌های این گزارش برای ممیزی جامع تازه‌اند.

## ۵. جدول یافته‌ها

| شناسه | عنوان | حوزه | سطح | اطمینان | تلاش | محل |
|---|---|---|---|---|---|---|
| OPS-01 | پشتیبان فقط روی PC شخصی؛ سه شکست پیاپی بی‌هشدار؛ پاک‌سازی همهٔ نسخه‌ها در راه | OPS | High | بالا | M | `packages/core/src/ops/backups.ts:273-305` |
| SEC-01 | open redirect با `/..//evil.com` | SEC | Medium | بالا | S | `apps/web/src/server/auth/return-path.ts:5-16` |
| SEC-02 | مسیر spike در build تولید با actor «system» | SEC | Medium | بالا | M | `apps/web/src/server/spike.ts:33-279` |
| SEC-03 | نبود هدرهای امنیتی (clickjacking) | SEC | Medium | بالا | S | `apps/web/next.config.ts` |
| SEC-04 | فونت Google روی صفحه‌های خصوصی، بی‌اعلام | SEC | Medium | بالا | S | `apps/web/src/ui/workspace/CardFace.tsx:61-64` |
| SEC-05 | مجوز بی‌پرسش SQL و migration برای Claude Code | SEC | Medium | بالا | S | `.claude/settings.json:4-41` |
| OPS-02 | نبود پایش و هشدار؛ 500 بی‌محل خطا | OPS | Medium | بالا | M | `apps/web/src/app/api/health/route.ts` |
| OPS-03 | Preview روی دادهٔ پایلوت؛ توکن Blob خواندنی | OPS | Medium | متوسط | S | Vercel env، `docs/runbooks/CLOUD_SETUP.md:90` |
| OPS-04 | استقرار production بی‌توجه به CI | OPS | Medium | متوسط | S | `docs/plans/RELEASE_RUNBOOK_2026-10-12.md:216` |
| OPS-05 | کد پیش از migration زنده می‌شود | OPS | Medium | بالا | M | `apps/web/src/server/jobs.ts` |
| OPS-06 | build شکننده و نزدیک سقف ۲۵۰MB | OPS | Medium | بالا | M | `tools/voice/fetch-models.mjs:25-28` |
| OPS-07 | کلید پشتیبان کنار توکن Blob | OPS | Medium | بالا | S | `tools/configure-runtime-env.mjs:32-66` |
| PERF-01 | باینری بومی در Function صفحه‌ها | PERF | Medium | متوسط | M | `apps/web/src/server/automatic-learning.ts:61` |
| PERF-02 | N+1 در صف مرور | PERF | Medium | بالا | S | `packages/core/src/srs/review.ts:277-278` |
| PERF-03 | round-trip Auth در هر درخواست | PERF | Medium | بالا | M | `apps/web/src/server/auth/gateway.ts:50-52` |
| QUA-01 | تابع ۱٬۴۰۰ خطی `processingJob` | QUA | Medium | بالا | L | `packages/core/src/proc/worker.ts:864-2250` |
| QUA-02 | فهرست env و اسرار ناقص | QUA | Medium | بالا | S | `.env.example`، `docs/runbooks/SECRETS.md` |
| UI-01 | hover و active دکمه‌های secondary از کار افتاده | UI | Medium | بالا | S | `apps/web/src/ui/styles/app.css:71-74` |
| UI-02 | فونت ۱۰ و ۱۱ پیکسل و مقیاس موازی | UI | Medium | بالا | M | `apps/web/src/ui/shell/AppShell.module.css:81,225` |
| UX-01 | متن کهنهٔ «coming next in the pilot» | UX | Medium | بالا | S | `apps/web/src/app/SignIn.tsx:54-57` |
| UX-02 | ضبط داخل پوسته با ناوبری | UX | Medium | بالا | M | `apps/web/src/app/(app)/sessions/[id]/record/page.tsx:8-16` |
| UX-03 | حذف و رد کارت بی‌تأیید و بی‌Undo | UX | Medium | بالا | S | `apps/web/src/ui/workspace/CardEditor.tsx:186-195` |
| UX-04 | پیام خطای خام به کاربر | UX | Medium | متوسط | M | `apps/web/src/ui/workspace/api.ts:53-66` |
| UX-05 | enum و اصطلاح داخلی در رابط | UX | Medium | بالا | M | `apps/web/src/ui/workspace/CardsView.tsx:129-131` |
| UX-06 | نام‌گذاری ناوبری و اصطلاحات ناسازگار | UX | Medium | بالا | M | `apps/web/src/app/(app)/LearnerShell.tsx:51-56` |
| UX-07 | Terms و Privacy پس از ورود در دسترس نیستند | UX | Medium | بالا | S | `apps/web/src/app/(app)/me/ProfileSettings.tsx:66-93` |
| UX-08 | loading تمام‌صفحه در هر ناوبری | UX | Medium | متوسط | M | `apps/web/src/app/loading.tsx` |
| UX-09 | حلقهٔ «Review account setup» | UX | Medium | بالا | S | `apps/web/src/ui/workspace/session-state.ts:402` |
| A11Y-01 | کنتراست مرز کنترل‌ها کمتر از ۳:۱ | A11Y | Medium | بالا | S | `apps/web/src/ui/styles/app.css:10-11` |
| A11Y-02 | `dir` و `lang` محتوای زبان‌آموز | A11Y | Medium | بالا | S | `apps/web/src/ui/workspace/CardEditor.tsx:117-132` |
| A11Y-03 | از دست رفتن فوکوس در «Show answer» | A11Y | Medium | متوسط | S | `apps/web/src/ui/workspace/ReviewView.tsx:279-283` |
| PRD-01 | متن حقوقی پیش‌نویس بی‌گارد build | PRD | Medium | بالا | S | `apps/web/src/legal/texts.generated.ts` |
| PRD-02 | Run گیرکرده و رزرو آزادنشده | PRD | Medium | متوسط | M | `packages/core/src/plt/jobs.ts:285-292` |
| SEC-06 | pdf.js بدون `isEvalSupported: false` | SEC | Low | بالا | S | `apps/web/src/server/pdf-preparer.ts:146-158` |
| SEC-07 | نبود نگهداری محدود برای رخدادهای امنیتی و audit | SEC | Low | بالا | S | `packages/core/src/plt/maintenance.ts` |
| SEC-08 | رویهٔ درخواست دسترسی به داده نیست | SEC | Low | بالا | S | `apps/web/src/app/(app)/me/data/page.tsx:12` |
| SEC-09 | `/help/[id]` بی‌اعتبارسنجی؛ سیگنال در صفحه‌ها | SEC | Low | بالا | S | `apps/web/src/app/(app)/help/[id]/page.tsx:18` |
| OPS-08 | اسکن data-loss از بلوک `DO` نمی‌گذرد | OPS | Low | بالا | S | `tools/db-apply/plan.ts:37` |
| OPS-09 | setup script خطاها را پنهان می‌کند | OPS | Low | بالا | S | `docs/ops/CLOUD_ENVIRONMENT_FA.md:25-33` |
| OPS-10 | build تکراری در CI؛ بی‌سیگنال وابستگی | OPS | Low | بالا | S | `.github/workflows/ci.yml:80,112` |
| OPS-11 | پیکربندی Auth ابری مستند نیست | OPS | Low | بالا | S | `supabase/config.toml:162-180` |
| OPS-12 | تنظیم مردهٔ `minimumReleaseAgeExclude` | OPS | Low | بالا | S | `pnpm-workspace.yaml:14-40` |
| PERF-04 | کوئری‌های زیاد Today؛ N+1 در خروجی‌ها | PERF | Low | بالا | M | `apps/web/src/app/(app)/today/page.tsx:40-85` |
| PERF-05 | Blob بی‌timeout | PERF | Low | بالا | S | `packages/core/src/plt/storage-vercel-blob.ts:64-140` |
| PERF-06 | zod و `strings.ts` کامل در کلاینت | PERF | Low | بالا | M | `apps/web/src/ui/workspace/api.ts:1` |
| QUA-03 | نبود README ریشه | QUA | Low | بالا | S | ریشهٔ مخزن |
| QUA-04 | helperهای تکراری route | QUA | Low | بالا | S | `apps/web/src/server/*-routes.ts` |
| QUA-05 | snapshotهای JSONB بی‌Schema | QUA | Low | بالا | S | `packages/core/src/html/exports.ts:76` |
| QUA-06 | توابع export‌شدهٔ بی‌مصرف | QUA | Low | بالا | S | `packages/core/src/quota/ledger.ts:403` |
| QUA-07 | پوشهٔ `claude promps` و خروجی‌های `.build` | QUA | Low | بالا | S | `artifacts/recalino-presentation/.build/` |
| QUA-08 | وابستگی کد production به «preview» | QUA | Low | بالا | M | `apps/web/src/app/(app)/layout.tsx:2-23` |
| UI-03 | دکمه‌های ضبط ۵۲ پیکسلی به‌جای ۷۲ | UI | Low | بالا | S | `apps/web/src/ui/recording/RecordingView.tsx:268-284` |
| UI-04 | انحراف از token و logical properties | UI | Low | بالا | M | `apps/web/src/ui/components/Sheet.module.css:119` |
| UI-05 | دکمهٔ حذف primary به‌جای danger | UI | Low | بالا | S | `apps/web/src/ui/workspace/ClassForm.tsx:286-290` |
| UX-10 | پیام «Finish deletion» پس از حذف موفق | UX | Low | متوسط | S | `apps/web/src/ui/workspace/PrivacyView.tsx:137-157` |
| UX-11 | نویز فنی و alert حین ضبط | UX | Low | متوسط | S | `apps/web/src/ui/recording/RecordingView.tsx:341-366` |
| UX-12 | متن‌های ناهمخوان با رفتار | UX | Low | بالا | S | `apps/web/src/app/(app)/me/quota/page.tsx:283-303` |
| UX-13 | اصطکاک پس از Stop و انتظار بی‌برآورد | UX | Low | متوسط | M | `apps/web/src/ui/workspace/SourcesView.tsx:488-505` |
| UX-14 | دانلود از «Your data» پیدا نیست | UX | Low | بالا | S | `apps/web/src/app/(app)/me/data/page.tsx:12` |
| A11Y-04 | heading-order در سه قاب؛ axe فقط تم روشن | A11Y | Low | بالا | S | `apps/web/e2e/helpers.ts:7-13` |
| A11Y-05 | alt عمومی تصاویر کارت | A11Y | Low | بالا | S | `apps/web/src/ui/workspace/ReviewView.tsx:118-122` |
| PRD-03 | پیشرفت پایلوت برای اپراتور دیده نمی‌شود | PRD | Low | بالا | M | `packages/core/src/ops/admin-read.ts:463-470` |
| PRD-04 | صفحهٔ ورود قابل ایندکس | PRD | Low | بالا | S | `apps/web/src/app/layout.tsx:10-21` |
| PRD-05 | اسناد با config زنده نمی‌خوانند | PRD | Low | بالا | S | `docs/plans/M5_MVP_COMPLETION.md:51` |
| SEC-10 | leaked-password، `source-map-js` و بستن S1 | SEC | Info | بالا | S | Supabase Auth، `pnpm-lock.yaml` |
| PERF-07 | FKهای بی‌index و هم‌زمانی cron | PERF | Info | بالا | S | Supabase advisors |
| QUA-09 | نوع `lockAccount` و گردکردن pricing | QUA | Info | بالا | S | `packages/core/src/aip/pricing.ts:120-123` |
| UI-06 | SegmentedControl کوچک ۴۰ پیکسل | UI | Info | بالا | S | `apps/web/src/ui/components/SegmentedControl.module.css:22-25` |
| PRD-06 | ایمیل تراکنشی دستی؛ PWA بی‌صفحهٔ آفلاین | PRD | Info | بالا | S | `packages/core/src/support/contracts.ts:8-18` |

**جمع:**

| سطح | تعداد |
|---|---|
| Critical | ۰ |
| High | ۱ |
| Medium | ۳۲ |
| Low | ۳۱ |
| Info | ۵ |
| **کل** | **۶۹** |

## ۶. مرور مسیرهای کاربر

**الف) ورود از `/`**

- **گام‌های فعلی:** تیک «I am 18 or older» و پذیرش Terms، سپس «Continue with Google»، سپس `/setup`.
- **اصطکاک:**
  - متن کهنهٔ «coming next in the pilot» (UX-01).
  - Terms و Privacy فقط همین‌جا باز می‌شوند و بعداً در دسترس نیستند (UX-07).
  - مرز چک‌باکس‌ها کم‌کنتراست است (A11Y-01).
  - متن حقوقی «Draft for development only» دیده می‌شود (PRD-01).
  - لینک `?next=` قابل سوءاستفاده است (SEC-01).
- **جریان پیشنهادی:** همان جریان، بی‌pilotNote، با مرز خوانا و redirect امن.

**ب) راه‌اندازی `/setup` تا `/setup/voice`**

- **گام‌های فعلی:** پنج صفحهٔ کوتاه با نوار پیشرفت، شامل زبان، توضیح، سطح و هدف، منطقهٔ زمانی و رضایت ضبط. بعد صدا که اختیاری است، و بعد `/today`.
- **اصطکاک:** کم است. رضایت ضبط کوتاه و روشن است. فقط کنترل‌ها کم‌کنتراست‌اند (A11Y-01).
- **جریان پیشنهادی:** بی‌تغییر.

**پ) جلسه، ضبط یا آپلود، پردازش، جزوه و کارت**

- **گام‌های فعلی:** «Record a session» در Today با یک لمس، ضبط، «Stop and save»، صفحهٔ material، تیک حقوق مواد، پردازش خودکار، جزوه و کارت‌ها.
- **اصطکاک:**
  - ضبط ناوبری دارد (UX-02).
  - alert و KB حین ضبط نمایش داده می‌شود (UX-11).
  - پس از Stop، تیک دوم حقوق و صفحهٔ بلند با «Next step» در میانه می‌آید (UX-13).
  - انتظار پردازش بی‌برآورد است (UX-13).
  - خطاهای خام نمایش داده می‌شوند (UX-04).
  - material و sources به‌جای هم به کار رفته‌اند (UX-06).
  - Run ممکن است برای همیشه گیر کند (PRD-02).
  - «Review account setup» به حلقه می‌افتد (UX-09).
- **جریان پیشنهادی:** Today، سپس ضبط تمام‌صفحه، سپس Stop. بعد صفحهٔ کوتاه با «Next step» در بالا و یک تیک حقوق در هر نسخه. بعد اعلان «Your notes are ready»، سپس جزوه و کارت‌ها.

**ت) مرور روزانه در `/today` و `/review`**

- **گام‌های فعلی:** Today، سپس «Start review»، سپس «Show answer»، سپس نمره، سپس Undo، سپس توقف نرم، سپس خلاصه.
- **اصطکاک:**
  - فوکوس کیبورد گم می‌شود (A11Y-03).
  - enumهای خام و نام IANA نمایش داده می‌شوند (UX-05).
  - نشان «due» هرگز دیده نمی‌شود و حالت خالی مبهم است (UX-12).
  - رد و حذف کارت بی‌تأیید است (UX-03).
  - فونت از Google بارگذاری می‌شود (SEC-04).
  - صف مرور N+1 دارد (PERF-02).
- **جریان پیشنهادی:** همان جریان، با فوکوس مدیریت‌شده، برچسب‌های انسانی، دو حالت خالی جدا و Undo برای رد.

**ث) حساب `/me`، داده `/me/data` و حذف `/deletion`**

- **گام‌های فعلی:** `/me` ردیف‌های تنظیمات را دارد. `/me/data` حذف حساب را با Sheet و تیک تأیید انجام می‌دهد. بعد رسید و «Return to Recalino» نمایش داده می‌شود.
- **اصطکاک:**
  - به Terms و Privacy راه نیست (UX-07).
  - دانلود از «Your data» پیدا نیست (UX-14) و رویهٔ خروجی کامل داده وجود ندارد (SEC-08).
  - دکمهٔ حذف primary است (UI-05).
  - پیام «Finish deletion» گذرا نمایش داده می‌شود (UX-10).
- **جریان پیشنهادی:** `/me` با ردیف Terms و Privacy. بعد `/me/data` با «Download first» و سپس حذف با دکمهٔ danger. بعد رسید و خروج.

**زمان رسیدن به اولین ارزش:** حدود ۱۳ تعامل از ورود تا اولین کارت مرورشده، به‌علاوهٔ زمان پردازش. این عدد برای MVP معقول است. بیشترین اصطکاک در فاصلهٔ Stop تا شروع پردازش است.

## ۷. جزئیات یافته‌ها

یافته‌ها بر پایهٔ حوزه گروه‌بندی شده‌اند. ترتیب سطح در جدول بخش ۵ آمده است. هر یافته یک پرامپت اصلاح مستقل دارد.

### امنیت و حریم خصوصی — `SEC`

#### SEC-01 — دور زدن محافظ open redirect با مسیر نرمال‌شده (`/..//evil.com`)

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/server/auth/return-path.ts:5-16`، `apps/web/src/server/auth/flow.ts:73`، `apps/web/src/server/auth/flow.ts:106`، `apps/web/src/app/page.tsx:19`، `apps/web/src/server/api.ts:300-305`
- **شاهد:** اجرای همین تابع با `tsx`:

  ```text
  /..//evil.com  -> //evil.com    -> https://evil.com/
  /.//evil.com/x -> //evil.com/x  -> https://evil.com/x
  ```

  تابع فقط «شروع با `//`» را در ورودی رد می‌کند. `new URL` بخش `..` را حل می‌کند و خروجی با `//` شروع می‌شود، که مرورگر آن را دامنهٔ دیگری می‌خواند.
- **چرا مهم است:** لینک `https://recalino.vercel.app/?next=/..//evil.com` از دامنهٔ معتبر ریکالینو، کاربر را بعد از ورود با Google به سایت مهاجم می‌فرستد. اگر کاربر از قبل وارد شده باشد، این کار بلافاصله رخ می‌دهد (`page.tsx:19`). این برای فیشینگ کافی است.
- **راهکار:** در `safeReturnPath` بعد از ساخت `url`، اگر `url.pathname` با `//` یا `/\` شروع شد، fallback برگردان. لایهٔ دوم این است که `redirectTo` در `api.ts` برای مسیر نسبی، برابری origin مقصد و origin درخواست را بسنجد.
- **معیار پذیرش:** `safeReturnPath("/..//evil.com")`، `"/x/..//evil.com"` و `"/./..//evil.com"` برابر `/today` باشند. آزمون callback با کوکی `rc_next=/..//evil.com` هدر `location` را روی origin اپ نگه دارد. `pnpm verify` سبز باشد.

```text
یافتهٔ SEC-01 — دور زدن محافظ open redirect با مسیر نرمال‌شده را رفع کن.
مشکل: safeReturnPath فقط «شروع با //» را در ورودی رد می‌کند؛ ورودی "/..//evil.com" بعد از new URL به pathname "//evil.com" تبدیل می‌شود و redirect به دامنهٔ خارجی می‌رود — محل: apps/web/src/server/auth/return-path.ts:5-16 (مصرف در apps/web/src/server/auth/flow.ts:73,106 و apps/web/src/app/page.tsx:19).
هدف: هر مقدار next که پس از نرمال‌سازی به دامنهٔ دیگر برسد، به fallback (/today) برگردد؛ redirectTo در apps/web/src/server/api.ts برای مسیر نسبی فقط مقصد هم‌origin را بپذیرد.
محدودیت‌ها: کمترین تغییر لازم؛ پیروی از الگوهای موجود پروژه؛ بدون تغییر رفتارهای دیگر؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌هایی را که تغییر می‌کنند بگو و منتظر تأیید بمان. اول در apps/web/src/server/auth/return-path.test.ts آزمون‌های "/..//evil.com"، "/x/..//evil.com"، "/./..//evil.com" و "/.//evil.com/x" را اضافه کن و شکستشان را ببین، بعد اصلاح کن.
معیار پذیرش: [ ] همهٔ ورودی‌های بالا /today برمی‌گردانند [ ] مسیرهای درست مثل /sessions/<uuid>/notes?x=1#a بدون تغییر می‌مانند [ ] آزمون callback با کوکی rc_next مخرب location هم‌origin می‌دهد.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن (pnpm verify)، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-02 — مسیر آزمایشی spike در build تولید، با دسترسی «system» به فایل‌های همهٔ کاربران

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/app/dev/spike/[action]/route.ts:5-9`، `apps/web/src/server/spike.ts:33-63,222-240,268-279`، `apps/web/src/server/spike-jobs.ts`، `packages/core/src/plt/spike.ts:26-31`، `packages/core/src/plt/storage.ts:117-120`، `apps/web/src/server/routes.ts:186`، `apps/web/src/server/jobs.ts:135`، `apps/web/next.config.ts:47-52`، `pnpm-workspace.yaml:9-10`، `docs/plans/M4_QUEUE_STORAGE.md:81`
- **شاهد:**
  - کامنت می‌گوید `// … Removed in T6.`، ولی T6 تیک نخورده است. مسیر با `access: "public"`، `maxDuration = 800` و بدون rate limit در build هست.
  - تنها گارد، `RECALINO_SPIKE === "1"` و مقایسهٔ زمان‌ثابت `x-spike-token` با `SPIKE_TOKEN` است.
  - کنش‌های `blob-get-link`، `blob-delete`، `ffmpeg` و `blob-compose` با actor `"system"` کار می‌کنند. تابع `loadOwned` برای `"system"` مالکیت را نمی‌سنجد (`storage.ts:117-120`)، و `spikeObjects` فقط بر اساس `id` فیلتر می‌کند.
  - در Vercel production متغیرهای `RECALINO_SPIKE` و `SPIKE_TOKEN` تعریف شده‌اند.
- **چرا مهم است:** با نشت یک توکن ثابت، می‌شود برای فایل خصوصی هر زبان‌آموز لینک خواندن تا یک ساعت گرفت یا آن را حذف کرد، بی‌audit و بی‌سقف. این در پشتیِ غیرضروری است. کامنت‌های نادرست هم ممکن است به حذف اشتباه وابستگی تولیدی، مثل `ffmpeg-static` در `audio-preparer`، منجر شوند.
- **راهکار:** گام T6 را تمام کن. بررسی انتشار voice-runtime را به یک مسیر کوچک مستقل با همان توکن کوتاه‌عمر `VOICE_RELEASE_CHECK_TOKEN` منتقل کن. بعد این‌ها را حذف کن: `spike.ts`، `spike-jobs.ts`، `plt/spike.ts`، مسیر `/dev/spike`، `ROUTES.spike`، `spikeJobDefinitions()`، ورودی `next.config` و `tools/spikes` همراه `pg-boss` در ریشه. کامنت `pnpm-workspace.yaml` را اصلاح کن. پاک کردن `RECALINO_SPIKE` و `SPIKE_TOKEN` از Vercel کار مالک محصول است.
- **معیار پذیرش:** `grep -rn "spike" apps packages` فقط در اسناد تاریخی نتیجه بدهد. `route-coverage.test.ts` و `pnpm build` سبز باشند. `pnpm-lock.yaml` دیگر `pg-boss` نداشته باشد، اگر جای دیگری مصرف نمی‌شود.

```text
یافتهٔ SEC-02 — مسیر آزمایشی spike در build تولید را حذف کن.
مشکل: مسیر POST /dev/spike/[action] (SPIKE-05) با access public و actor "system" که بررسی مالکیت فایل را دور می‌زند هنوز در build تولید است؛ کامنت‌ها «Removed in T6» می‌گویند ولی T6 انجام نشده — محل: apps/web/src/app/dev/spike/[action]/route.ts، apps/web/src/server/spike.ts، apps/web/src/server/spike-jobs.ts، packages/core/src/plt/spike.ts، apps/web/src/server/routes.ts (ROUTES.spike)، apps/web/src/server/jobs.ts (spikeJobDefinitions)، apps/web/next.config.ts (outputFileTracingIncludes "/dev/spike/**")، pnpm-workspace.yaml (کامنت ffmpeg-static)، tools/spikes.
هدف: هیچ مسیر یا job مربوط به spike در build تولید نباشد؛ اگر بررسی انتشار voice-runtime (شاخهٔ VOICE_RELEASE_CHECK_TOKEN در guard) هنوز لازم است، به یک route کوچک مستقل منتقل شود که فقط همان کنش را با همان قاعدهٔ توکن کوتاه‌عمر دارد؛ کامنت pnpm-workspace بگوید ffmpeg-static decoder تولیدی audio-preparer است.
محدودیت‌ها: کمترین تغییر لازم؛ پیروی از الگوهای موجود پروژه؛ بدون تغییر رفتارهای دیگر؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر. به تنظیمات Vercel دست نزن؛ حذف env های RECALINO_SPIKE و SPIKE_TOKEN را فقط در گزارش پایانی به مالک یادآوری کن. docs/plans/M4_QUEUE_STORAGE.md (T6) را به‌روز کن.
روش: اول برنامه و فهرست فایل‌هایی را که حذف یا تغییر می‌کنند بگو و منتظر تأیید بمان. با grep همهٔ مصرف‌کننده‌های spike و pg-boss را پیدا کن؛ اگر docs/plans/RELEASE_RUNBOOK_2026-10-12.md به /dev/spike/voice-runtime ارجاع می‌دهد، مسیر تازه را در آن ثبت کن.
معیار پذیرش: [ ] grep -rn spike در apps و packages فقط مسیر جایگزین voice-runtime (اگر ساخته شد) را نشان دهد [ ] route-coverage.test.ts سبز [ ] pnpm build سبز [ ] pnpm install --frozen-lockfile پس از به‌روزرسانی lockfile سبز.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن (pnpm verify و pnpm build)، نتیجه را خلاصه کن و فایل‌های ساخته، حذف یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-03 — نبود هدرهای امنیتی (clickjacking و نبود CSP سراسری)

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/next.config.ts:23-64` (تابع `headers()` ندارد)، `apps/web/vercel.json`، `apps/web/src/proxy.ts:28-50`
- **شاهد:** پاسخ `https://recalino.vercel.app/` در 2026-10-18 فقط `cache-control`، `server` و `strict-transport-security` داشت. `X-Frame-Options`، `Content-Security-Policy` و `frame-ancestors` نبودند. `Referrer-Policy`، `Permissions-Policy` و `X-Content-Type-Options` هم نبودند. build محلی هم همین را نشان داد.
- **چرا مهم است:** صفحه‌های ادمین، مانند ارسال ایمیل و تغییر سهمیه، و صفحه‌های زبان‌آموز را می‌شود داخل iframe سایت دیگری گذاشت و کاربر را به کلیک فریب داد. چون درخواست از خودِ صفحهٔ framed فرستاده می‌شود، `assertSameOrigin` جلوی آن را نمی‌گیرد. CSP هم لایهٔ دوم دفاع برای `dangerouslySetInnerHTML` در `CardFace.tsx` و `layout.tsx` نیست.
- **راهکار:** در `next.config.ts` تابع `headers()` برای `/(.*)` اضافه کن، با این مقدارها:
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Content-Type-Options: nosniff`
  - `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`

  CSP کامل با nonce را پس از آزمون e2e اضافه کن. فریم جزوه `sandbox` و CSP خودش را دارد.
- **معیار پذیرش:** پاسخ `/`، `/today`، `/admin` و `/api/health` این هدرها را داشته باشند (آزمون واحد روی `headers()` و یک بررسی e2e). ضبط با میکروفون و فریم جزوه سالم بمانند.

```text
یافتهٔ SEC-03 — هدرهای امنیتی پایه را اضافه کن.
مشکل: اپ هیچ X-Frame-Options/frame-ancestors، Referrer-Policy، Permissions-Policy و X-Content-Type-Options نمی‌فرستد؛ صفحه‌های ادمین و زبان‌آموز قابل framing هستند (clickjacking) — محل: apps/web/next.config.ts (تابع headers() وجود ندارد).
هدف: همهٔ پاسخ‌ها این هدرها را داشته باشند: X-Frame-Options: DENY؛ Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'؛ Referrer-Policy: strict-origin-when-cross-origin؛ X-Content-Type-Options: nosniff؛ Permissions-Policy: camera=(), geolocation=(), microphone=(self). CSP کامل (script-src با nonce) در این تغییر نیست.
محدودیت‌ها: کمترین تغییر لازم؛ پیروی از الگوهای موجود پروژه؛ بدون تغییر رفتارهای دیگر؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر. ضبط صدا (getUserMedia)، فریم srcdoc جزوه با sandbox و ورود Google باید کار کنند.
روش: اول برنامه و فهرست فایل‌هایی را که تغییر می‌کنند بگو و منتظر تأیید بمان. فهرست هدرها را در یک ثابت قابل آزمون بگذار و آزمون واحد بنویس؛ برای UI یک بررسی Playwright (هدرهای پاسخ / و /today) اضافه کن و screenshot قبل و بعد صفحهٔ ضبط و جزوه را در عرض ۳۷۵ و ۱۴۴۰ بگیر.
معیار پذیرش: [ ] پاسخ /، /today، /admin و /api/health هدرهای بالا را دارند [ ] recording.spec و session-notes-reader.spec سبزند [ ] ورود (signin.spec) سبز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن (pnpm verify و pnpm test:e2e)، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-04 — بارگذاری فونت از Google روی صفحه‌های خصوصی، بی‌اعلام در متن حریم خصوصی

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S (پس از تصمیم)
- **محل:** `apps/web/src/ui/workspace/CardFace.tsx:61-64`، `packages/core/src/lkm/study-render.ts:59-69`، `apps/web/src/ui/workspace/class-notes-pronunciation.ts:188`، `docs/legal/PROCESSOR_REGISTER.md`، `docs/legal/privacy-notice.md`
- **شاهد:**
  - `CardFace.tsx` برای کارت‌های `lesson_html` در صفحهٔ اصلی اپ، `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora…&family=Vazirmatn…">` اضافه می‌کند.
  - `study-render.ts` در جزوه، هم نمای داخل اپ و هم HTML دانلودی، `preconnect` و stylesheet از Google می‌گذارد.
  - CSP فریم جزوه `fonts.googleapis.com` و `fonts.gstatic.com` را مجاز کرده است.
  - دفتر پردازشگران و اطلاعیهٔ حریم خصوصی Google را فقط برای ورود نام می‌برند.
- **چرا مهم است:** هر بار که زبان‌آموز کارت یا جزوه را باز می‌کند، IP و مرورگرش بی‌اعلام به Google فرستاده می‌شود. این با قاعدهٔ CLAUDE.md («هرگز web font اضافه نکن»)، `docs/design/CLAUDE_DESIGN_BRIEF.md:40` و قاعدهٔ فونت دستگاه در `docs/PRODUCT_DECISIONS_LOG.md:102` تعارض دارد. **ولی** brief خود مالک محصول در `claude promps/CODEX_PROMPT.md` بازتولید «دقیق» جزوه، همراه لینک فونت، را خواسته است. پس این تعارض اسناد است و تصمیمش با مالک محصول است (بخش «تصمیم‌های لازم»، مورد ۲). منتقد مستقل سطح را از High به Medium رساند.
- **راهکار:** یکی از گزینه‌های تصمیم ۲ را اجرا کن. پیشنهاد: فونت‌ها را حذف کن و از پشتهٔ فونت سیستمی با fallback موجود `Tahoma, sans-serif` استفاده کن. دامنه‌های Google را هم از CSP فریم حذف کن.
- **معیار پذیرش:** `grep -rn "fonts.googleapis\|fonts.gstatic" apps packages` خالی باشد، یا اعلام در متن حقوقی ثبت شده باشد. Playwright در باز کردن کارت `lesson_html` و جزوه هیچ درخواستی به origin دیگر نبیند. متن فارسی و انگلیسی خوانا بماند.

```text
یافتهٔ SEC-04 — بارگذاری فونت از Google روی صفحه‌های خصوصی را مطابق تصمیم مالک محصول اصلاح کن.
مشکل: کارت‌های lesson_html و جزوهٔ کلاس (درون اپ و HTML دانلودی) فونت Lora و Vazirmatn را از fonts.googleapis.com بارگذاری می‌کنند؛ IP زبان‌آموز بی‌اعلام به Google می‌رسد و با قاعدهٔ «هرگز web font اضافه نکن» در CLAUDE.md تعارض دارد — محل: apps/web/src/ui/workspace/CardFace.tsx:61-64، packages/core/src/lkm/study-render.ts:59-69 (تابع fonts)، apps/web/src/ui/workspace/class-notes-pronunciation.ts:188 (CSP فریم).
هدف (پیش‌فرض، مگر مالک محصول گزینهٔ دیگری گفته باشد): هیچ درخواست شبکه به Google Fonts نرود؛ جزوه و کارت با پشتهٔ فونت سیستمی و fallback موجود (Tahoma, sans-serif و stack IPA) نمایش داده شوند؛ دامنه‌های Google از CSP فریم حذف شوند.
محدودیت‌ها: کمترین تغییر لازم؛ پیروی از الگوهای موجود پروژه؛ بدون تغییر رفتارهای دیگر؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر. اگر مالک محصول افزودن فونت به‌صورت self-host یا اعلام در متن حقوقی را انتخاب کرده، قبل از شروع بپرس. آزمون‌های study-render و تطابق با نمونهٔ مرجع را به‌روز کن و تفاوت را در docs/design/REFERENCE_STUDY_OUTPUT_2026-10-06.md ثبت کن.
روش: اول برنامه و فهرست فایل‌هایی را که تغییر می‌کنند بگو و منتظر تأیید بمان. اول آزمونی بنویس که نبود fonts.googleapis/fonts.gstatic را در خروجی renderer و CardFace بسنجد. screenshot قبل و بعد کارت مرور و جزوه را در عرض ۳۷۵ و ۱۴۴۰ (فارسی و انگلیسی) بگیر.
معیار پذیرش: [ ] grep fonts.googleapis|fonts.gstatic در apps و packages خالی است [ ] Playwright هنگام باز کردن /review و /sessions/<id>/notes هیچ درخواست cross-origin نمی‌بیند [ ] متن فارسی، انگلیسی و IPA خوانا می‌ماند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن (pnpm verify و برای UI pnpm test:e2e)، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-05 — مجوزهای بی‌پرسش Claude Code برای SQL دلخواه و اعمال migration روی دیتابیس ابری

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S (پس از تصمیم)
- **محل:** `.claude/settings.json:4-6,23,41`
- **شاهد:** در `permissions.allow` این موارد هست و بخش `ask`، `deny` یا hook وجود ندارد:
  - `"Bash(pnpm exec supabase db push:*)"`
  - `"Bash(supabase db push:*)"`
  - `"Bash(pnpm db:apply:*)"`
  - `"mcp__Supabase__execute_sql"`
  - `"mcp__claude_ai_Supabase__execute_sql"`
- **چرا مهم است:** CLAUDE.md برای `drop`، `truncate` و `delete`/`update` بی‌شرط، و برای `--approve-data-loss`، اجازهٔ صریح مالک محصول را لازم می‌داند. ولی ابزار هیچ پرسشی نشان نمی‌دهد و `pnpm db:apply:*` شامل `--apply --approve-data-loss <v>` هم می‌شود. یک خطای مدل یا متن تزریق‌شده در داده (transcript، پیام پشتیبانی) می‌تواند بی‌پرسش دادهٔ ابری را پاک کند. این در لایهٔ هارنس اعمال نمی‌شود و فقط به انضباط مدل تکیه دارد.
- **راهکار:** تصمیم ۳. پیشنهاد: `execute_sql` در allow بماند، ولی یک hook `PreToolUse` برای `drop|truncate|alter`، `delete` و `update` بدون `where` تأیید بخواهد. `pnpm db:apply` بی‌آرگومان در allow بماند، `--apply` به ask برود و `--approve-data-loss` به deny.
- **معیار پذیرش:** `execute_sql` با `drop table x` یا `truncate` prompt بدهد. `select` بی‌پرسش بماند. `pnpm db:apply --approve-data-loss x` رد شود یا prompt بدهد.

```text
یافتهٔ SEC-05 — مجوزهای Claude Code برای SQL و migration ابری را مطابق تصمیم مالک محصول محدود کن.
مشکل: .claude/settings.json اجرای mcp__Supabase__execute_sql، mcp__claude_ai_Supabase__execute_sql، supabase db push و pnpm db:apply با هر آرگومان (از جمله --approve-data-loss) را بی‌پرسش مجاز می‌کند؛ قاعدهٔ «اجازهٔ صریح» CLAUDE.md در لایهٔ ابزار اعمال نمی‌شود — محل: .claude/settings.json:4-6,23,41.
هدف (گزینهٔ پیشنهادی؛ اگر مالک محصول گزینهٔ دیگری گفته، همان را اجرا کن): select و خواندن بی‌پرسش بمانند؛ SQL حاوی drop، truncate، alter، delete یا update بدون where با یک hook PreToolUse پرسش بخواهد؛ "Bash(pnpm db:apply)" بی‌آرگومان در allow، "--apply" در ask و "--approve-data-loss" در deny باشد.
محدودیت‌ها: این فایل تنظیمات مجوز است؛ هیچ تغییری بدون تأیید صریح مالک محصول در همین سشن اعمال نکن. کمترین تغییر لازم؛ hook را در یک اسکریپت کوچک در .claude/hooks/ با آزمون واحد بنویس؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول متن کامل تغییر پیشنهادی settings.json و hook را نشان بده و منتظر تأیید بمان. برای hook آزمون واحد با نمونه‌های select، drop table، delete from x where id=1 و update x set a=1 بنویس.
معیار پذیرش: [ ] execute_sql با drop/truncate پرسش می‌دهد [ ] select بی‌پرسش اجرا می‌شود [ ] pnpm db:apply --approve-data-loss رد می‌شود [ ] docs/ops/CLOUD_ENVIRONMENT_FA.md سیاست تازه را دارد.
پایان: آزمون hook و pnpm verify را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-06 — pdf.js بدون `isEvalSupported: false`

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/server/pdf-preparer.ts:146-158`
- **شاهد:** در `getDocument({ data, useSystemFonts: false, disableFontFace: true, stopAtErrors: true, … })` گزینهٔ `isEvalSupported` تنظیم نشده و پیش‌فرض آن `true` است.
- **چرا مهم است:** PDF آپلودی دادهٔ نامطمئن است (PRD-SEC-02). نسخهٔ فعلی وصله شده است، ولی بستن مسیر `eval` لایهٔ دفاعی ارزانی است.
- **راهکار:** در همهٔ فراخوانی‌های `getDocument`، گزینهٔ `isEvalSupported: false` را اضافه کن.
- **معیار پذیرش:** آزمون واحد وجود گزینه را بسنجد و fixtureهای PDF همچنان رندر شوند.

```text
یافتهٔ SEC-06 — گزینهٔ isEvalSupported: false را به pdf.js اضافه کن.
مشکل: getDocument برای PDF آپلودی کاربر بدون isEvalSupported: false فراخوانی می‌شود (پیش‌فرض true) — محل: apps/web/src/server/pdf-preparer.ts:146-158 (و هر فراخوانی دیگر getDocument که grep پیدا کند).
هدف: همهٔ فراخوانی‌های pdfjs-dist با isEvalSupported: false اجرا شوند.
محدودیت‌ها: کمترین تغییر لازم؛ پیروی از الگوهای موجود پروژه؛ بدون تغییر رفتارهای دیگر؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. اول در pdf-preparer.test.ts آزمونی بنویس که گزینه را بسنجد، بعد اصلاح کن.
معیار پذیرش: [ ] آزمون تازه سبز است [ ] pdf-preparer.test.ts و pdf-preparer.int.test.ts (اگر Supabase محلی هست) سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-07 — نبود سیاست نگهداری برای `plt.security_event` و `plt.audit_event`

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `packages/core/src/plt/maintenance.ts:20-61`، `supabase/migrations/20261001100505_plt_core.sql:33-69`
- **شاهد:** jobهای نگهداری فقط کلیدهای idempotency، bucketهای rate limit و jobهای تمام‌شده را پاک می‌کنند. این دو جدول `user_id`/`actor_id` بدون FK دارند و grant حذف به `recalino_app` داده نشده است.
- **چرا مهم است:** این دو جدول بی‌سقف رشد می‌کنند، و شناسهٔ کاربر حذف‌شده برای همیشه در آن‌ها می‌ماند (PRD-DEL-01 و PRD-DEL-04). اطلاعیهٔ حریم خصوصی هم برای این سوابق مدت نگهداری اعلام نکرده است.
- **راهکار:** یک job دوره‌ای برای پاک کردن `security_event` بعد از N روز بساز. برای `audit_event` سیاست مکتوب بگذار: نگهداری محدود یا ناشناس‌سازی `actor_id` پس از حذف حساب. migration لازم با grant محدود را اضافه کن. مدت‌ها نیاز به تصمیم مالک محصول دارند.
- **معیار پذیرش:** آزمون integration نشان دهد ردیف قدیمی‌تر از مدت تعیین‌شده پاک می‌شود، و مدت نگهداری در `docs/legal` ثبت شده باشد.

```text
یافتهٔ SEC-07 — برای plt.security_event و plt.audit_event سیاست نگهداری پیاده کن.
مشکل: این دو جدول هیچ job پاک‌سازی ندارند و شناسهٔ کاربر حذف‌شده را بی‌مدت نگه می‌دارند — محل: packages/core/src/plt/maintenance.ts:20-61، supabase/migrations/20261001100505_plt_core.sql:33-69.
هدف: یک job دوره‌ای مثل plt.purge_security_events که ردیف‌های قدیمی‌تر از مدت تنظیم‌پذیر (پیش‌فرض پیشنهادی ۹۰ روز در PltSettings) را حذف کند؛ برای audit_event یا همان کار با مدت جداگانه یا ناشناس‌سازی actor_id پس از حذف حساب، مطابق تصمیم مالک محصول.
محدودیت‌ها: مدت‌ها را حدس نزن؛ اگر مالک محصول مدت را تعیین نکرده، مقدار را در تنظیمات قابل تغییر بگذار و در گزارش بپرس. تغییر schema فقط با فایل migration تازه در supabase/migrations و بعد pnpm db:types. کمترین تغییر لازم؛ پیروی از الگوی jobهای maintenance.ts؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. اول آزمون integration بنویس که ردیف قدیمی پاک و ردیف تازه حفظ شود.
معیار پذیرش: [ ] آزمون integration سبز [ ] grant فقط delete روی همین دو جدول به recalino_app [ ] مدت‌ها در docs/legal/PROCESSOR_REGISTER.md یا privacy-notice.md (پیش‌نویس) ثبت شده‌اند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-08 — درخواست دسترسی و حمل داده (GDPR مادهٔ ۱۵ و ۲۰) نه در اپ هست و نه رویهٔ مستند دارد

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S (رویهٔ دستی) / L (خودسرویس)
- **محل:** `apps/web/src/app/(app)/me/data/page.tsx:12`، `apps/web/src/server/export-routes.ts:35`، `docs/legal/privacy-notice.md:151,157`
- **شاهد:**
  - صفحهٔ «Your data» با زیرعنوان «Choose exactly what you want to remove.» فقط حذف دارد.
  - خروجی‌ها فقط `html` و `anki` هر جلسه‌اند و پانویس آن‌ها می‌گوید «account information and review history are excluded».
  - اطلاعیه وعدهٔ «give you a copy of your data» ظرف یک ماه را می‌دهد.
- **چرا مهم است:** پروفایل، رضایت‌ها، تاریخچهٔ مرور و مکاتبات پشتیبانی راه خروجی ندارند. برای پایلوت هشت‌نفره پاسخ دستی کافی است، به شرطی که رویه‌اش مستند باشد تا پاسخ در مهلت قانونی و کامل داده شود.
- **راهکار:** فعلاً یک runbook در `docs/runbooks/` برای پاسخ دستی بنویس: جدول‌ها، کوئری‌های فقط‌خواندنی و قالب تحویل. خروجی خودسرویس را با یک تصمیم نسخه‌دار به بعد از MVP موکول کن.
- **معیار پذیرش:** runbook با فهرست جدول‌های `acc`، `srs`، `support`، `quota`، `org`، `note`، `card` و فیلدهای `auth.users` موجود باشد و از `privacy-notice.md` به آن ارجاع داده شود.

```text
یافتهٔ SEC-08 — رویهٔ پاسخ به درخواست دسترسی/حمل داده را مستند کن.
مشکل: /me/data فقط حذف را پوشش می‌دهد و خروجی‌ها (html/anki) پروفایل، رضایت‌ها، تاریخچهٔ مرور و پشتیبانی را ندارند؛ اطلاعیهٔ حریم خصوصی وعدهٔ «copy of your data» می‌دهد ولی رویه‌ای ثبت نیست — محل: apps/web/src/app/(app)/me/data/page.tsx:12، apps/web/src/server/export-routes.ts:35، docs/legal/privacy-notice.md:151,157.
هدف: یک runbook تازه docs/runbooks/DATA_ACCESS_REQUEST.md (فارسی، مثل بقیهٔ runbookها) که می‌گوید درخواست از کجا می‌رسد، هویت چطور تأیید می‌شود، کدام جدول‌ها (acc، srs، support، quota، org، note، card، media metadata و auth.users) با چه کوئری‌های فقط‌خواندنی و با فیلتر user_id خوانده می‌شوند، خروجی در چه قالبی (JSON و فایل‌های موجود) و از چه کانال امنی تحویل می‌شود، و مهلت یک‌ماهه چطور پیگیری می‌شود.
محدودیت‌ها: فقط سند؛ کد تغییر نکند. وعده‌ای فراتر از متن حقوقی موجود اضافه نکن. پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول ساختار سند را بگو و منتظر تأیید بمان. نام جدول‌ها و ستون‌ها را از supabase/migrations و packages/core/src/db/types.ts دربیاور.
معیار پذیرش: [ ] runbook همهٔ جدول‌های دارای user_id یا owner_id را پوشش می‌دهد [ ] کوئری‌ها فقط select هستند [ ] docs/legal/privacy-notice.md (پیش‌نویس) به runbook ارجاع می‌دهد یا پیشنهاد ارجاع در گزارش آمده است.
پایان: pnpm lint را اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-09 — صفحهٔ `/help/[id]` شناسه را اعتبارسنجی نمی‌کند؛ سیگنال `ownership_denied` در صفحه‌ها ثبت نمی‌شود

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/app/(app)/help/[id]/page.tsx:18`، `packages/core/src/support/feedback.ts:168,244`، `apps/web/src/server/workspace.ts:31-38`
- **شاهد:** `getFeedbackThread(getDatabase(), workspaceActor(learner), id)` بدون `z.uuid()` و بدون catch فراخوانی می‌شود و `ZodError` یا `ownershipDenied` به `error.tsx` می‌رسد. تابع `found()` در `workspace.ts` هم برای `not_found` فقط `notFound()` را صدا می‌زند و `recordSecurityEvent` را صدا نمی‌زند.
- **چرا مهم است:** شناسهٔ نامعتبر یا متعلق به کاربر دیگر به‌جای 404، صفحهٔ خطای عمومی نشان می‌دهد و در لاگ `request_failed` ثبت می‌شود. تلاش برای دسترسی به دادهٔ دیگران در صفحه‌ها، برخلاف APIها، سیگنال امنیتی نمی‌سازد. هیچ IDOR پیدا نشد.
- **راهکار:** همان الگوی `cards/[id]` را پیاده کن: `z.uuid()` و catch برای `not_found` و `ownership_denied` که `notFound()` را صدا بزند. در `found()` اگر `failure.securitySignal` تعریف شده بود، `recordSecurityEvent` را صدا بزن.
- **معیار پذیرش:** `/help/abc` و `/help/<uuid دیگری>` پاسخ 404 بدهند، و آزمون cross-account رخداد امنیتی را ببیند.

```text
یافتهٔ SEC-09 — اعتبارسنجی شناسه در /help/[id] و ثبت سیگنال ownership_denied در صفحه‌ها را اضافه کن.
مشکل: help/[id]/page.tsx شناسه را بدون z.uuid() و بدون catch به getFeedbackThread می‌دهد و خطا به error.tsx (۵۰۰) می‌رسد؛ found() در workspace.ts رخداد امنیتی ownership_denied را ثبت نمی‌کند — محل: apps/web/src/app/(app)/help/[id]/page.tsx:18، apps/web/src/server/workspace.ts:31-38.
هدف: شناسهٔ نامعتبر یا متعلق به دیگری 404 بدهد (الگوی apps/web/src/app/(app)/cards/[id]/page.tsx:22-25)؛ وقتی AppError سیگنال امنیتی دارد، recordSecurityEvent با userId و route صفحه ثبت شود.
محدودیت‌ها: کمترین تغییر لازم؛ پیروی از الگوهای موجود پروژه؛ بدون تغییر رفتارهای دیگر؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. اول آزمونی بنویس که 404 و ثبت رخداد را نشان دهد.
معیار پذیرش: [ ] /help/abc → 404 [ ] /help/<uuid کاربر دیگر> → 404 و یک ردیف plt.security_event [ ] صفحه‌های cards/notes رفتار قبلی را دارند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### SEC-10 — نکته‌های بدون ریسک فوری

- **سطح:** Info | **اطمینان:** بالا | **تلاش:** S
- **محل:** Supabase Auth (داشبورد)، `pnpm-lock.yaml` (`next > postcss > source-map-js`)، `packages/core/src/src/staged-audio.ts:44-64`
- **شاهد و توضیح:**
  - **«Leaked password protection» در Supabase Auth خاموش است.** ورود فقط با Google است، پس اثر فعلی ندارد. اگر ورود با رمز اضافه شود، روشنش کن.
  - **`pnpm audit --prod` یک آسیب‌پذیری High در `source-map-js <1.2.2` نشان می‌دهد** (`GHSA-68fv-2mgg-jv7q`). این بسته وابستهٔ زمان build است و ورودی کاربر به آن نمی‌رسد. با به‌روزرسانی بعدی Next یا یک `pnpm.overrides` موقت رفع می‌شود.
  - **یافتهٔ S1 بازبینی 2026-10-12 رفع شده است.** حالا `captureInProgress` لازم است، ولی سند بازبینی هنوز آن را باز نشان می‌دهد.
- **راهکار:** بسته شدن S1 را در `docs/plans/RELEASE_SECURITY_REVIEW_2026-10-12.md` ثبت کن. `source-map-js` را با به‌روزرسانی بعدی وابستگی‌ها رفع کن.
- **معیار پذیرش:** `pnpm audit --prod` بدون High باشد، و سند بازبینی S1 را بسته نشان دهد.

```text
یافتهٔ SEC-10 — دو کار کوچک نگهداری امنیتی را انجام بده.
مشکل: pnpm audit --prod یک High در source-map-js (<1.2.2، GHSA-68fv-2mgg-jv7q، مسیر next>postcss) گزارش می‌کند؛ و یافتهٔ S1 در docs/plans/RELEASE_SECURITY_REVIEW_2026-10-12.md رفع شده (packages/core/src/src/staged-audio.ts:44-64 اکنون captureInProgress را لازم دارد) ولی سند آن را باز نشان می‌دهد.
هدف: source-map-js به >=1.2.2 برسد (ترجیحاً با pnpm.overrides در package.json ریشه یا به‌روزرسانی سازگار next، با saveExact)؛ سند بازبینی بسته شدن S1 را با تاریخ و محل کد ثبت کند.
محدودیت‌ها: کمترین تغییر لازم؛ نسخهٔ next را بدون تأیید ارتقا نده؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان.
معیار پذیرش: [ ] pnpm audit --prod بدون High [ ] pnpm install --frozen-lockfile و pnpm build سبز [ ] سند بازبینی S1 را بسته نشان می‌دهد.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```
### DevOps، پشتیبان و CI — `OPS`

#### OPS-01 — پشتیبان دیتابیس فقط روی PC شخصی اجرا می‌شود؛ سه شکست پیاپی، بی‌هشدار، و پاک‌سازی خودکار همهٔ نسخه‌ها در راه

- **سطح:** High | **اطمینان:** بالا | **تلاش:** M
- **محل:** `docs/runbooks/BACKUP_RESTORE.md:80-100`، `tools/backup/install-daily-task.ps1`، `tools/backup/run-daily.ps1`، `packages/core/src/ops/backups.ts:273-305`، `apps/web/src/server/jobs.ts:107`، `docs/adr/0001-stack-and-hosting.md:35,60`
- **شاهد:**
  - runbook: «task از نوع `InteractiveToken` و سطح `Limited` است: حساب ویندوز مالک باید وارد سیستم باشد، میزبان روشن و آنلاین بماند، Docker موجود اجرا شود».
  - تنها job سرور `ops.backup_retention` است که پشتیبان قدیمی را پاک می‌کند و هیچ snapshot نمی‌سازد. Supabase Free هم پشتیبان خودکار ندارد.
  - خواندن فقط‌خواندنی `ops.database_backup` در 2026-10-18:

    | روز | نتیجه |
    |---|---|
    | 10-09، 10-10، 10-12، 10-13 | `ready` |
    | 10-11 | اجرا نشده |
    | 10-14 | `failed` |
    | 10-15 | `ready`، آخرین نسخهٔ سالم، 09:00 UTC |
    | 10-16، 10-17، 10-18 | `failed` |

    آخرین آزمون بازیابی: 2026-10-04.
  - `maintainDatabaseBackups` هر ردیفی را که `expires_at` آن گذشته باشد حذف می‌کند و آخرین نسخهٔ `ready` را نگه نمی‌دارد (`backups.ts:273-290`).
  - در کد هیچ هشداری برای «پشتیبان کهنه» نیست. پنل ادمین فقط فهرست پشتیبان‌ها را نشان می‌دهد.
- **چرا مهم است:** تنها راه بازیابی دادهٔ زبان‌آموزان، یعنی حساب‌ها، تاریخچهٔ مرور FSRS، ویرایش‌ها و سهمیه، سه روز است بی‌صدا از کار افتاده است. اگر شکست ادامه پیدا کند، job نگهداری حدود 2026-11-14 آخرین نسخهٔ سالم را هم پاک می‌کند. بعد از آن، یک migration اشتباه یا حذف تصادفی یعنی از دست رفتن قطعی داده. یک منتقد مستقل سطح را Medium پیشنهاد داد، چون فعلاً فقط مالک محصول کاربر پایلوت است. منتقد دیگر High را تأیید کرد. به‌خاطر مسیر مشخص به از دست رفتن داده و ورود قریب‌الوقوع زبان‌آموزان، High حفظ شد.
- **راهکار:**
  1. **فوری، دستی، کار مالک محصول:** علت شکست را در `daily-status.json` و `Get-ScheduledTaskInfo` ببین و یک پشتیبان دستی و یک تمرین بازیابی اجرا کن.
  2. **کد:** در `maintainDatabaseBackups`، آخرین N نسخهٔ `ready` (پیشنهاد ۳) را همیشه نگه دار، حتی اگر منقضی شده باشند.
  3. **کد:** در همان job ساعتی، اگر آخرین `ready` قدیمی‌تر از ۳۰ ساعت بود، یک لاگ `error` با رخداد `backup_stale` و یک وظیفهٔ ادمین یا ایمیل از outbox موجود بساز.
  4. **تصمیم ۱:** پشتیبان سمت سرور.
- **معیار پذیرش:**
  - آزمون integration: با نسخه‌های `ready` منقضی، دست‌کم سه نسخهٔ آخر پاک نشوند.
  - بدون نسخهٔ `ready` در ۳۰ ساعت، یک ردیف هشدار یا وظیفهٔ ادمین و یک لاگ `backup_stale` ساخته شود.
  - runbook هدف RPO پایلوت، روال بررسی هفتگی و مسئول آن را داشته باشد.

```text
یافتهٔ OPS-01 — پشتیبان دیتابیس را در برابر شکست بی‌صدا و پاک‌سازی همهٔ نسخه‌ها ایمن کن.
مشکل: پشتیبان روزانه فقط با Task Scheduler روی لپ‌تاپ مالک ساخته می‌شود و از 2026-10-16 سه روز پیاپی شکست خورده؛ هیچ هشداری نیست و job نگهداری ops.backup_retention هر پشتیبان منقضی را، حتی آخرین نسخهٔ ready، حذف می‌کند — محل: packages/core/src/ops/backups.ts:273-305 (maintainDatabaseBackups و databaseBackupMaintenanceJob)، apps/web/src/server/jobs.ts:107، docs/runbooks/BACKUP_RESTORE.md.
هدف: (۱) maintainDatabaseBackups همیشه آخرین ۳ پشتیبان ready را نگه دارد (عدد در تنظیمات قابل تغییر)؛ (۲) همان job ساعتی وقتی آخرین ready قدیمی‌تر از ۳۰ ساعت است لاگ error با رخداد backup_stale (فقط فیلدهای مجاز log.ts) و یک وظیفه یا اعلان قابل‌دیدن در پنل ادمین بسازد، و اگر outbox ایمیل تأییدشده (D41/D42) راهی برای پیام اپراتور دارد، از همان استفاده کند؛ (۳) BACKUP_RESTORE.md هدف RPO پایلوت، روال بررسی هفتگی و وضعیت فعلی شکست‌ها را ثبت کند.
محدودیت‌ها: سرویس یا پلن پولی تازه اضافه نکن (ADR-0001)؛ کمترین تغییر لازم؛ پیروی از الگوی jobهای موجود و ops schema؛ تغییر schema فقط با migration تازه؛ هیچ داده‌ای روی دیتابیس ابری ننویس؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌هایی را که تغییر می‌کنند بگو و منتظر تأیید بمان. اول آزمون integration بنویس که پاک شدن آخرین نسخهٔ ready را نشان دهد، بعد اصلاح کن؛ آزمون دوم برای هشدار کهنگی.
معیار پذیرش: [ ] با همهٔ نسخه‌ها منقضی، ۳ نسخهٔ ready آخر می‌مانند [ ] بدون ready در ۳۰ ساعت، هشدار و لاگ backup_stale ساخته می‌شود و تکرار هر ساعت هشدار تکراری نمی‌سازد (idempotent) [ ] runbook به‌روز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن. در گزارش پایانی به مالک محصول یادآوری کن که علت شکست task ویندوز را بررسی و یک پشتیبان دستی و تمرین بازیابی اجرا کند.
```

#### OPS-02 — پایش و هشدار production وجود ندارد؛ خطاهای 500 بدون محل لاگ می‌شوند

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/app/api/health/route.ts:4-7`، `apps/web/src/server/api.ts:144-151`، `packages/core/src/plt/log.ts:57,68,102`، `packages/core/src/plt/jobs.ts:492-498`، `packages/core/src/aip/openrouter.ts:109-110`، `packages/core/src/ops/admin-read.ts:463-470`
- **شاهد:**
  - health فقط `{ status: "ok" }` ثابت برمی‌گرداند، بدون دیتابیس.
  - `request_failed` فقط `error_name` و `pg_code` دارد. `IDENTIFIER` در `log.ts` هر رشتهٔ دیگری را `[redacted]` می‌کند.
  - همهٔ سطوح لاگ با `console.log` نوشته می‌شوند.
  - شکست شبکه در OpenRouter به `provider_outcome_unknown` تبدیل می‌شود و علت دور ریخته می‌شود.
  - پنل ادمین job شکست‌خورده یا سن آخرین اجرای runner را نشان نمی‌دهد.
  - هیچ Sentry، drain یا هشداری وجود ندارد (NFR-12 در ADR-0001).
- **چرا مهم است:** خرابی runner بعد از چرخش `CRON_SECRET`، شکست پشتیبان (OPS-01)، پر شدن ۵۰۰ مگابایت دیتابیس Free که پروژه را فقط‌خواندنی می‌کند، یا یک `TypeError` تازه، تا وقتی زبان‌آموزی شکایت نکند دیده نمی‌شود. در آن لحظه هم محل خطا معلوم نیست.
- **راهکار:** بدون سرویس پولی:
  1. فیلد مجاز `error_location`، یعنی اولین قاب stack با مسیر نسبی و بدون متن، و `cause_code` برای خطای provider را به لاگ اضافه کن.
  2. یک job ساعتی «سلامت» بساز که `pg_database_size`، تعداد job شکست‌خورده در ساعت گذشته، قدیمی‌ترین job در صف و سن آخرین اجرای runner را بخواند. با عبور از آستانه، وظیفهٔ ادمین یا ایمیل بسازد.
  3. `/api/health` را برای نسخهٔ readiness به `select 1` وصل کن (`/api/health?deep=1` با `CRON_SECRET`).
  4. در پنل ادمین کارت «سلامت سیستم» نشان بده.
- **معیار پذیرش:**
  - آزمون واحد: خطای غیر AppError لاگی با `error_location` نسبی و بی‌متن کاربر بسازد.
  - آزمون integration: job شکست‌خورده یک وظیفهٔ ادمین بسازد.
  - deep health با دیتابیس قطع پاسخ 503 بدهد.

```text
یافتهٔ OPS-02 — پایش و هشدار پایه برای production بساز.
مشکل: /api/health ثابت است، خطاهای 500 فقط error_name لاگ می‌شوند، شکست jobها و کهنگی runner هیچ هشداری نمی‌سازند و پنل ادمین سلامت سیستم را نشان نمی‌دهد — محل: apps/web/src/app/api/health/route.ts، apps/web/src/server/api.ts:144-151، packages/core/src/plt/log.ts، packages/core/src/plt/jobs.ts:492-498، packages/core/src/aip/openrouter.ts:109-110، packages/core/src/ops/admin-read.ts و apps/web/src/ui/admin/SystemScreens.tsx.
هدف: (۱) لاگ request_failed و job_failed فیلد مجاز error_location (فایل:خط نخستین قاب stack، مسیر نسبی، بدون متن پیام) و برای خطای provider فیلد cause_code داشته باشد؛ (۲) یک job ساعتی ops.health_check که اندازهٔ دیتابیس، تعداد jobهای failed در ساعت گذشته، قدیمی‌ترین job صف و سن آخرین اجرای runner را بخواند و با عبور از آستانه‌های قابل تنظیم یک وظیفهٔ ادمین (و در صورت امکان ایمیل از outbox تأییدشده) بسازد، بدون تکرار؛ (۳) /api/health?deep=1 فقط با bearer CRON_SECRET دیتابیس را بسنجد و در شکست 503 بدهد؛ (۴) کارت «System health» در پنل ادمین همین شاخص‌ها را نشان دهد.
محدودیت‌ها: سرویس پولی تازه اضافه نکن؛ لاگ‌ها نباید متن کلاس، transcript، ایمیل، کلید یا پیام خطای خام داشته باشند (PRD-PRIV-06)؛ کمترین تغییر لازم؛ پیروی از الگوهای موجود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. اول آزمون‌ها: واحد برای error_location بی‌متن، integration برای ساخت وظیفهٔ ادمین از job شکست‌خورده. برای کارت ادمین screenshot در عرض ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] آزمون‌های بالا سبز [ ] /api/health بی‌پارامتر همان پاسخ قبلی را می‌دهد [ ] deep health بدون توکن 401 و با دیتابیس قطع 503 می‌دهد [ ] تکرار job هشدار تکراری نمی‌سازد.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-03 — محیط Preview در Vercel به دیتابیس و Blob پایلوت وصل است؛ توکن Blob خواندنی و مشترک است

- **سطح:** Medium | **اطمینان:** متوسط | **تلاش:** S
- **محل:** تنظیمات env پروژهٔ Vercel `recalino`، `docs/PROJECT_SPEC.md:214`، `docs/runbooks/CLOUD_SETUP.md:90`، `docs/runbooks/SECRETS.md:48`، `docs/plans/M4_QUEUE_STORAGE.md:206`
- **شاهد:**
  - فهرست env در 2026-10-18 (فقط نام‌ها):
    - برای target `preview` این متغیرها تعریف شده‌اند: `DATABASE_URL`، `SUPABASE_URL`، `SUPABASE_PUBLISHABLE_KEY`، `SUPABASE_SECRET_KEY`، `CRON_SECRET`، `RATE_LIMIT_IP_KEY` و `BLOB_STORE_ID`.
    - `BLOB_READ_WRITE_TOKEN` یک متغیر **خواندنی (غیر Sensitive)** برای production، preview و development است و Vercel خودش آن را `readable-secret` نشانه‌گذاری کرده است.
    - `NODE_ENV` دستی در production تعریف شده است.
  - `M4_QUEUE_STORAGE.md:206` ثبت کرده که `DATABASE_URL` پایلوت «در هر دو ردیف Production و Preview» گذاشته شد.
  - `PROJECT_SPEC.md:214` می‌گوید «Deployment پیش‌نمایش Vercel به دیتابیس پایلوت وصل نمی‌شود (Q-SPEC-1)».
  - عوامل کاهنده: preview پشت SSO است، تیم Vercel یک عضو دارد و دو preview موجود با اسکریپت fixture ساخته شده‌اند.
- **چرا مهم است:** هر preview از شاخهٔ بازبینی‌نشده، کد ناآزموده را روی دادهٔ واقعی پایلوت اجرا می‌کند. توکن Blob خواندنی با `vercel env pull` در فایل محلی می‌نشیند و به همهٔ فایل‌های خصوصی زبان‌آموزان دسترسی خواندن و نوشتن می‌دهد. اسناد با هم تعارض دارند.
- **راهکار:** تصمیم ۴. پیشنهاد:
  - متغیرهای دیتابیس، Supabase، Blob، OpenRouter و Cron را از target Preview و Development بردار و preview را فقط در حالت fixture (`RECALINO_UI_PREVIEW=1`) بساز.
  - `BLOB_READ_WRITE_TOKEN` را Sensitive و فقط Production کن. پیش از آن توکن را چرخش بده، چون خواندنی بوده است.
  - `NODE_ENV` دستی را حذف کن.
  - `CLOUD_SETUP.md` و `SECRETS.md` را با Q-SPEC-1 هم‌خوان کن.
- **معیار پذیرش:**
  - فهرست env در Vercel برای Preview هیچ اتصال پایلوت نداشته باشد.
  - `BLOB_READ_WRITE_TOKEN` از نوع Sensitive و فقط Production باشد.
  - دو runbook با PROJECT_SPEC یکی باشند.

```text
یافتهٔ OPS-03 — جداسازی محیط Preview از دادهٔ پایلوت را در اسناد و چک‌لیست پیاده کن.
مشکل: طبق فهرست env، target Preview در Vercel همان DATABASE_URL، کلیدهای Supabase، CRON_SECRET و Blob پایلوت را دارد و BLOB_READ_WRITE_TOKEN خواندنی و مشترک بین production/preview/development است؛ docs/runbooks/CLOUD_SETUP.md:90 و docs/runbooks/SECRETS.md:48 دستور «Production و Preview» می‌دهند در حالی که docs/PROJECT_SPEC.md:214 (Q-SPEC-1) می‌گوید preview به دیتابیس پایلوت وصل نمی‌شود.
هدف: (۱) CLOUD_SETUP.md و SECRETS.md با Q-SPEC-1 هم‌خوان شوند: اسرار پایلوت فقط Production و Sensitive؛ preview فقط با RECALINO_UI_PREVIEW=1 (الگوی tools/deploy-ui-preview.ps1)؛ (۲) یک چک‌لیست دستی برای مالک محصول در همان runbook: حذف متغیرهای DATABASE_URL، SUPABASE_*، BLOB_*، CRON_SECRET، RATE_LIMIT_IP_KEY از Preview/Development، چرخش و Sensitive کردن BLOB_READ_WRITE_TOKEN فقط برای Production، حذف NODE_ENV دستی، و دستور بررسی خواندنی آن؛ (۳) در صورت امکان، یک گارد کد: اگر VERCEL_ENV === "preview" و RECALINO_UI_PREVIEW !== "1"، اتصال دیتابیس با پیام روشن رد شود (packages/core/src/db/connection.ts).
محدودیت‌ها: تنظیمات Vercel را خودت تغییر نده؛ فقط سند، چک‌لیست و گارد کد. کمترین تغییر لازم؛ پیروی از الگوهای موجود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. برای گارد، اول آزمون واحد بنویس (preview بدون fixture → خطا؛ preview با fixture و production → بدون تغییر).
معیار پذیرش: [ ] دو runbook با Q-SPEC-1 یکی‌اند [ ] چک‌لیست مالک کامل است [ ] آزمون گارد سبز و رفتار production بی‌تغییر است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-04 — هر push به `main` بی‌توجه به CI در production مستقر می‌شود

- **سطح:** Medium | **اطمینان:** متوسط | **تلاش:** S (پس از تصمیم)
- **محل:** `docs/plans/RELEASE_RUNBOOK_2026-10-12.md:32,216`، تنظیمات مخزن GitHub و Vercel Git
- **شاهد:**
  - runbook: «هر push به `main`، حتی با CI ازکارافتاده یا قرمز، استقرار می‌شود».
  - در مخزن هیچ ruleset، branch protection یا Deployment Check ثبت نشده است. تنظیمات GitHub از این سشن خوانده نشد.
- **چرا مهم است:** یک ادغام شتاب‌زده با آزمون قرمز ولی build سبز، بلافاصله برای همهٔ کاربران زنده می‌شود. تنها دروازه، انضباط انسانی «`pnpm verify` محلی» است.
- **راهکار:** تصمیم ۵. پیشنهاد:
  - ruleset برای `main` با PR اجباری و check الزامی «Lint, types, boundaries, tests, build». این با سیاست CI کم‌مصرف سازگار است، چون CI روی PR به `main` اجرا می‌شود.
  - Vercel Deployment Checks تا production فقط بعد از سبز شدن همان check ساخته شود.
- **معیار پذیرش:** push مستقیم به `main` رد شود. production فقط بعد از check سبز ساخته شود. runbook به‌روز شود.

```text
یافتهٔ OPS-04 — دروازهٔ CI پیش از استقرار production را مستند و آماده کن.
مشکل: هر push به main بی‌توجه به نتیجهٔ CI در production مستقر می‌شود و در مخزن هیچ ruleset یا Deployment Check ثبت نیست — محل: docs/plans/RELEASE_RUNBOOK_2026-10-12.md:32,216.
هدف: (۱) یک سند کوتاه docs/ops/BRANCH_PROTECTION_FA.md با تنظیمات دقیق پیشنهادی برای مالک محصول: ruleset روی main (PR اجباری، required status check با نام دقیق job «Lint, types, boundaries, tests, build» از .github/workflows/ci.yml، منع force push و حذف)، و فعال کردن Vercel Deployment Checks برای همان check؛ (۲) به‌روزرسانی RELEASE_RUNBOOK و docs/ops/CI_LOW_COST_POLICY.md که بگویند استقرار production به سبز بودن CI وابسته است.
محدودیت‌ها: تنظیمات GitHub یا Vercel را خودت تغییر نده و ci.yml را عوض نکن (تغییر CI بیرون از الگوی کم‌مصرف با پرسش از مالک)؛ فقط سند. پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول ساختار سند را بگو و منتظر تأیید بمان. نام دقیق job و workflow را از .github/workflows/ci.yml بخوان.
معیار پذیرش: [ ] سند گام‌به‌گام و قابل اجرا در UI گیت‌هاب و Vercel است [ ] runbook و سیاست CI به‌روزند.
پایان: pnpm lint را اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-05 — کد تازه پیش از migration زنده می‌شود؛ هیچ گام خودکار یا قفلی این دو را به هم گره نمی‌زند

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `docs/plans/RELEASE_RUNBOOK_2026-10-12.md:32,91,210`، `packages/core/src/db/connection.ts`، `apps/web/src/server/jobs.ts`
- **شاهد:** runbook سه چیز می‌گوید. «ادغام در `main` بلافاصله استقرار production می‌سازد». «`supabase db push` فقط پس از ادغام در `main`». «rollback کد، schema را برنمی‌گرداند».
- **چرا مهم است:** بین زنده شدن کد و اعمال دستی migration، کد تازه روی schema قدیمی اجرا می‌شود. این پنجره اگر اپراتور اعمال را فراموش کند، طولانی‌تر هم می‌شود. jobها در این فاصله با خطای ستون یا جدول شکست می‌خورند، و در بدترین حالت مسیر پردازش پولی نیمه‌کاره می‌ماند.
- **راهکار:** در build یک ثابت از آخرین نسخهٔ `supabase/migrations` تولید کن. runner و `/api/health?deep=1` آن را با `max(version)` در `supabase_migrations.schema_migrations` مقایسه کنند. اگر دیتابیس عقب‌تر بود، runner jobها را claim نکند، لاگ `schema_behind` بنویسد و هشدار OPS-02 را فعال کند. روال runbook هم ترتیب «migration سازگار با عقب، سپس کد» را صریح کند.
- **معیار پذیرش:** آزمون integration نشان دهد با نسخهٔ عقب‌تر دیتابیس، runner job را claim نمی‌کند و لاگ `schema_behind` می‌سازد. با نسخهٔ برابر، رفتار بی‌تغییر بماند.

```text
یافتهٔ OPS-05 — اجرای job روی schema عقب‌افتاده را متوقف کن.
مشکل: ادغام در main کد را فوراً زنده می‌کند ولی migration دستی و بعداً اعمال می‌شود؛ هیچ بررسی‌ای نمی‌گذارد runner روی schema قدیمی job اجرا نکند — محل: docs/plans/RELEASE_RUNBOOK_2026-10-12.md:32,91,210، apps/web/src/server/jobs.ts، packages/core/src/plt/jobs.ts.
هدف: در زمان build یک ثابت EXPECTED_SCHEMA_VERSION از بزرگ‌ترین نام فایل در supabase/migrations ساخته شود؛ runner پیش از claim، max(version) در supabase_migrations.schema_migrations را (با cache کوتاه) بخواند و اگر کوچک‌تر بود، هیچ job را claim نکند و لاگ warn با رخداد schema_behind بنویسد؛ runbook ترتیب «migration سازگار با عقب، سپس ادغام کد» را صریح کند.
محدودیت‌ها: کمترین تغییر لازم؛ اگر نقش recalino_app اجازهٔ خواندن supabase_migrations.schema_migrations را ندارد، grant لازم را فقط با migration تازه بده؛ بدون تغییر رفتار وقتی نسخه‌ها برابرند؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. اول آزمون integration بنویس.
معیار پذیرش: [ ] با schema عقب‌تر، runner هیچ job را claim نمی‌کند و schema_behind لاگ می‌شود [ ] با نسخهٔ برابر یا جلوتر، رفتار بی‌تغییر است [ ] runbook به‌روز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-06 — زنجیرهٔ build شکننده: دانلود شبکه‌ای بی‌timeout، tracerهای سفارشی و نزدیکی به سقف ۲۵۰ مگابایت

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/package.json:10` (اسکریپت `build`)، `tools/voice/prepare-build.mjs:7-8`، `tools/voice/fetch-models.mjs:25-28`، `apps/web/tools/trace-native-dependencies.mjs`، `apps/web/tools/trace-voice-native.mjs`، `apps/web/tools/native-build-adapter.mjs`
- **شاهد:**
  - روی Vercel (`VERCEL === "1"`) مدل‌های صوتی با `fetch(url)` از GitHub و Hugging Face، بدون `AbortSignal` و بدون retry گرفته می‌شوند. checksum sha256 بررسی می‌شود.
  - سه اسکریپت سفارشی فایل‌های `.nft.json` داخلی Next را بازنویسی می‌کنند.
  - در build محلی، جمع فایل‌های trace‌شدهٔ `api/jobs/run` بدون مدل‌ها حدود ۱۷۱ مگابایت است. با مدل‌ها برآورد حدود ۲۰۴ مگابایت از سقف ۲۵۰ است.
- **چرا مهم است:** قطعی یا کندی GitHub یا Hugging Face، استقرار اصلاحی فوری را ناممکن می‌کند. هر ارتقای ffmpeg، pdfjs یا sherpa می‌تواند build را با خطای اندازهٔ Function بشکند. ارتقای جزئی Next هم ممکن است tracerها را بی‌صدا از کار بیندازد.
- **راهکار:**
  - `AbortSignal.timeout(120_000)` و سه تلاش با backoff به دانلود اضافه کن.
  - مدل‌ها را در cache build (`node_modules/.cache/recalino-voice`) نگه دار.
  - یک نگهبان اندازه بعد از build بگذار که جمع بایت‌های یکتای هر `.nft.json` را با آستانهٔ ۲۲۵ مگابایت بسنجد.
- **معیار پذیرش:** شبیه‌سازی میزبان کند، build را بعد از retry با پیام `model_download_timeout` متوقف کند. build دوم از cache و بدون شبکه موفق شود. نگهبان اندازه با آستانهٔ کم‌تر شکست بخورد.

```text
یافتهٔ OPS-06 — زنجیرهٔ build را در برابر کندی شبکه و رشد اندازه مقاوم کن.
مشکل: tools/voice/fetch-models.mjs مدل‌ها را روی Vercel بدون timeout و retry دانلود می‌کند و هیچ نگهبانی اندازهٔ Functionهای native (نزدیک سقف ۲۵۰ مگابایت Vercel) را نمی‌سنجد — محل: tools/voice/fetch-models.mjs:25-28، tools/voice/prepare-build.mjs:7-8، apps/web/package.json (اسکریپت build)، apps/web/tools/trace-voice-native.mjs.
هدف: (۱) fetchPinned با AbortSignal.timeout(120000) و سه تلاش با backoff، و پیام خطای ثابت model_download_timeout؛ (۲) استفادهٔ دوباره از مدل‌های تأییدشده (همان sha256) از مسیر cache مثل node_modules/.cache/recalino-voice؛ (۳) اسکریپت نگهبان پس از build که جمع بایت‌های یکتای فایل‌های هر apps/web/.next/server/app/**/*.nft.json را حساب کند، عدد را JSON لاگ کند و با آستانهٔ قابل تنظیم (پیش‌فرض 225MB) شکست بخورد.
محدودیت‌ها: checksum فعلی را حفظ کن؛ manifest مدل‌ها را تغییر نده؛ کمترین تغییر لازم؛ پیروی از سبک اسکریپت‌های موجود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. آزمون node:test برای retry و timeout با fetch جعلی و برای نگهبان اندازه با چند فایل .nft.json ساختگی بنویس.
معیار پذیرش: [ ] آزمون retry/timeout سبز [ ] آزمون نگهبان سبز [ ] pnpm build محلی سبز و عدد اندازه را لاگ می‌کند.
پایان: lint، typecheck، تست‌ها و pnpm build را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-07 — کلید رمزگذاری پشتیبان کنار توکن Blob در Vercel؛ نسخهٔ مستقل بازیابی تثبیت نشده

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `tools/configure-runtime-env.mjs:32-39,60-66`، `docs/runbooks/BACKUP_RESTORE.md:7,22`، env `RECALINO_BACKUP_KEY_*`
- **شاهد:** کلید AES پشتیبان در Vercel production ثبت شده، کنار `BLOB_READ_WRITE_TOKEN` که به ciphertext دسترسی دارد. `CLAUDE.md` می‌گوید «مجوز انتقال کلید مستقل پشتیبان هنوز باز» است.
- **چرا مهم است:** حساب Vercel به‌خطرافتاده هم‌زمان به پشتیبان رمزشده و کلید آن می‌رسد. پس رمزگذاری در برابر همان تهدید محافظتی ندارد. از طرف دیگر، اگر DPAPI ویندوز از دست برود و نسخهٔ مستقل کلید نباشد، پشتیبان‌ها باز نمی‌شوند.
- **راهکار:** تصمیم ۱. runbook را با وضعیت واقعی و مدل تهدید اصلاح کن. نسخهٔ مستقل کلید را در محل آفلاین مالک محصول نگه دار. اگر journal حذف فقط به کلید جداگانه نیاز دارد، کلید پشتیبان را از Vercel جدا کن.
- **معیار پذیرش:** runbook محل‌های کلید، مدل تهدید و آزمون بازیابی با نسخهٔ مستقل را ثبت کند.

```text
یافتهٔ OPS-07 — وضعیت و مدل تهدید کلید رمزگذاری پشتیبان را در runbook درست ثبت کن.
مشکل: کلید AES پشتیبان (RECALINO_BACKUP_KEY_*) در Vercel production کنار BLOB_READ_WRITE_TOKEN است و نسخهٔ مستقل بازیابی تثبیت نشده؛ docs/runbooks/BACKUP_RESTORE.md:7,22 با این وضعیت ناسازگار است — محل: tools/configure-runtime-env.mjs:32-39,60-66، docs/runbooks/BACKUP_RESTORE.md.
هدف: runbook بگوید کلید کجاها هست (Vercel production برای journal حذف، DPAPI میزبان)، مدل تهدید واقعی چیست، نسخهٔ مستقل آفلاین چطور نگهداری و هر چند وقت با یک بازیابی آزمایشی سنجیده می‌شود، و اگر مالک محصول جداسازی کلید journal از کلید پشتیبان را تصویب کند، گام‌های آن چیست.
محدودیت‌ها: فقط سند؛ هیچ کلیدی را نخوان، چاپ یا جابه‌جا نکن؛ تصمیم انتقال کلید با مالک محصول است. پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول تغییرات پیشنهادی runbook را نشان بده و منتظر تأیید بمان.
معیار پذیرش: [ ] runbook با کد tools/configure-runtime-env.mjs و apps/web/src/server/privacy-journal.ts هم‌خوان است [ ] گام آزمون بازیابی با نسخهٔ مستقل کلید ثبت است.
پایان: pnpm lint را اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-08 — اسکن «حذف داده» در `pnpm db:apply` بلوک‌های `DO`/PL-pgSQL را نمی‌بیند

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `tools/db-apply/plan.ts:37`
- **شاهد:** `for (const raw of stripSqlNoise(sql).split(";"))` قواعد `^delete from`، `^truncate` و `^drop` را فقط روی ابتدای هر قطعه اجرا می‌کند.
- **چرا مهم است:** D77 به این اسکن تکیه دارد تا migration حذف‌کننده بدون اجازهٔ مالک اجرا نشود. منطق پاک‌سازی داخل `do $$ … $$` از آن عبور می‌کند.
- **راهکار:** بدنهٔ dollar-quoted را جدا استخراج کن و همان قواعد را روی آن هم اجرا کن. هر `do` یا `create function` حاوی این الگوها را data-loss بشمار.
- **معیار پذیرش:** آزمون با `do $$ begin delete from x; end $$;` نیاز به `--approve-data-loss` را گزارش کند.

```text
یافتهٔ OPS-08 — اسکن حذف داده در pnpm db:apply را برای بلوک‌های DO و توابع PL/pgSQL کامل کن.
مشکل: tools/db-apply/plan.ts:37 SQL را با ";" می‌شکند و قواعد delete/truncate/drop/update-بدون-where را فقط روی ابتدای هر قطعه اجرا می‌کند؛ داخل do $$ … $$ دیده نمی‌شود.
هدف: بدنه‌های dollar-quoted (با هر tag) جدا استخراج و با همان قواعد اسکن شوند؛ هر یافته در آن‌ها data loss حساب شود.
محدودیت‌ها: کمترین تغییر لازم؛ رفتار dry run و --apply برای migrationهای موجود تغییر نکند؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون‌هایی با do $$…$$، do $body$…$body$ و create function حاوی delete بنویس، بعد اصلاح کن؛ همهٔ migrationهای موجود را با اسکن جدید از آزمون بگذران تا مثبت کاذب تازه‌ای نیاید (اگر آمد، فهرست کن و بپرس).
معیار پذیرش: [ ] آزمون‌های تازه سبز [ ] migrationهای موجود همان نتیجهٔ قبلی را دارند یا تفاوت گزارش شده است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-09 — setup script محیط ابری خطاها را پنهان می‌کند و checksum ندارد

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `docs/ops/CLOUD_ENVIRONMENT_FA.md:25-33`
- **شاهد:** `curl -fsSLO "https://nodejs.org/dist/v$V/…tar.xz" && … && ln -sf … || true`. فایل `SHASUMS256.txt` بررسی نمی‌شود، و `|| true` شکست هر گام را پنهان می‌کند.
- **چرا مهم است:** شکست بی‌صدای setup، سشن را با Node یا pnpm اشتباه شروع می‌کند. خطا فقط در میانهٔ کار ظاهر می‌شود.
- **راهکار:**
  - `set -euo pipefail` اضافه کن.
  - checksum را با `sha256sum -c` بسنج.
  - pnpm را با `corepack prepare pnpm@12.4.2 --activate` نصب کن.
  - در پایان، نسخهٔ Node 24 و pnpm 12 را صریح بسنج.
- **معیار پذیرش:** با checksum نادرست، script با خطای روشن بایستد. در حالت عادی Node 24 و pnpm 12 فعال باشند.

```text
یافتهٔ OPS-09 — setup script محیط ابری Recalino را سخت‌گیر و قابل اعتماد کن.
مشکل: script در docs/ops/CLOUD_ENVIRONMENT_FA.md:25-33 خطاها را با || true پنهان می‌کند، tarball Node را بدون SHASUMS256 بررسی نمی‌کند و pnpm را با پین مشخص فعال نمی‌کند.
هدف: نسخهٔ تازهٔ script در همان سند با set -euo pipefail، بررسی sha256 از SHASUMS256.txt رسمی، فعال‌سازی pnpm@12.4.2 با corepack و بررسی پایانی node -v (v24) و pnpm -v (12)؛ با شکست هر گام پیام روشن و خروج غیرصفر.
محدودیت‌ها: فقط سند؛ environment را خودت تغییر نده (کار مالک محصول در تنظیمات environment «Recalino» است). پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول متن تازه را نشان بده و منتظر تأیید بمان؛ اگر ممکن است script را در scratchpad با bash -n و shellcheck (در صورت نصب) بسنج.
معیار پذیرش: [ ] script تازه syntax درست دارد [ ] سند گام اعمال در environment را برای مالک توضیح می‌دهد.
پایان: نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-10 — CI: job e2e دوباره build می‌کند و هیچ سیگنال خودکار به‌روزرسانی وابستگی نیست

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S (پس از تصمیم)
- **محل:** `.github/workflows/ci.yml:80,112`
- **شاهد:** `pnpm build` یک بار در job `verify` و دوباره در job `e2e` با `needs: verify` اجرا می‌شود. `dependabot.yml` وجود ندارد و `pnpm audit` در CI نیست.
- **چرا مهم است:** سهمیهٔ Actions مشترک است و هر ادغام چند دقیقه را دو بار می‌سوزاند. advisoryهای تازه، مثل SEC-10، فقط با ممیزی دستی دیده می‌شوند.
- **راهکار:** تصمیم ۶. هر دو تغییر CI هستند و طبق سیاست مالک محصول به پرسش نیاز دارند.
  - خروجی `.next` را با `upload-artifact` از `verify` به `e2e` بده.
  - Dependabot را فقط برای security updates روشن کن. PRهایش CI می‌خورند.
- **معیار پذیرش:** در اجرای `main`، `pnpm build` یک بار اجرا شود. advisory امنیتی PR خودکار بسازد، اگر مالک آن را تأیید کرد.

```text
یافتهٔ OPS-10 — مطابق تصمیم مالک محصول، build تکراری CI را حذف و هشدار وابستگی را فعال کن.
مشکل: .github/workflows/ci.yml:80 و :112 دو بار pnpm build اجرا می‌کنند و هیچ dependabot یا audit خودکاری نیست.
هدف (فقط بخش‌هایی که مالک محصول صریحاً تأیید کرده): (۱) job e2e خروجی apps/web/.next (بدون cache) را با actions/upload-artifact و download-artifact (pin شده به SHA مثل بقیهٔ actionها) از job verify بگیرد و دوباره build نکند؛ (۲) .github/dependabot.yml فقط برای security updates اکوسیستم npm.
محدودیت‌ها: هر تغییر CI باید در الگوی کم‌مصرف بماند (docs/ops/CI_LOW_COST_POLICY.md: فقط push/PR به main و دستی؛ e2e فقط main یا برچسب e2e؛ concurrency با لغو؛ paths-ignore برای docs)؛ بدون تأیید صریح مالک محصول ci.yml را تغییر نده؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول diff پیشنهادی ci.yml و dependabot.yml را نشان بده و منتظر تأیید بمان. pnpm db:env باید پیش از start سرور در e2e بماند.
معیار پذیرش: [ ] YAML معتبر (actionlint اگر نصب است) [ ] الگوی کم‌مصرف حفظ شده [ ] e2e بدون build دوباره اجرا می‌شود (پس از ادغام روی main بررسی شود).
پایان: نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-11 — پیکربندی Auth ابری فقط در داشبورد است؛ `config.toml` مقادیر localhost دارد

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `supabase/config.toml:162,167,180`، `docs/runbooks/GOOGLE_OAUTH.md`، `docs/runbooks/CLOUD_SETUP.md`
- **شاهد:** `site_url = "http://localhost:3000"`، فقط callbackهای localhost و `enable_signup = true`. مقادیر ابری Site URL، Redirect URLs و provider فعال در هیچ سندی کامل ثبت نیستند.
- **چرا مهم است:** یک `supabase config push` تصادفی Site URL ابری را به localhost برمی‌گرداند و ورود را می‌شکند. بازیابی پس از فاجعه به حافظهٔ اپراتور وابسته است.
- **راهکار:** مقادیر غیرمحرمانهٔ فعلی ابر را با تاریخ بررسی در `docs/runbooks/CLOUD_AUTH_CONFIG.md` ثبت کن. در CLAUDE.md و runbook هشدار بگذار که `supabase config push` فقط با اجازهٔ صریح اجرا شود.
- **معیار پذیرش:** سند مقادیر و گام بازسازی را دارد، و هشدار `config push` ثبت شده است.

```text
یافتهٔ OPS-11 — پیکربندی Auth ابری را مستند و در برابر config push محافظت کن.
مشکل: تنظیمات Auth ابری (Site URL، Redirect URLs، provider) فقط در داشبورد Supabase است و supabase/config.toml:162,167 مقادیر localhost دارد؛ supabase config push تصادفی ورود را می‌شکند.
هدف: سند docs/runbooks/CLOUD_AUTH_CONFIG.md با مقادیر غیرمحرمانهٔ فعلی (Site URL، Redirect URLs، provider فعال، jwt_expiry، تنظیم refresh token) و تاریخ بررسی، گام بازسازی پس از فاجعه، و هشدار صریح «supabase config push فقط با اجازهٔ صریح مالک محصول»؛ ارجاع از GOOGLE_OAUTH.md و CLOUD_SETUP.md.
محدودیت‌ها: هیچ secret یا client secret ننویس؛ مقادیر را از داشبورد فقط اگر ابزار خواندنی Supabase در دسترس است بخوان، وگرنه جای خالی بگذار و از مالک بپرس؛ تنظیمات ابری را تغییر نده. پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول ساختار سند را بگو و منتظر تأیید بمان.
معیار پذیرش: [ ] سند کامل و بدون secret است [ ] ارجاع‌ها برقرارند.
پایان: pnpm lint را اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### OPS-12 — تنظیم مردهٔ `minimumReleaseAgeExclude` و نبود `.npmrc`

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `pnpm-workspace.yaml:14-40`
- **شاهد:** ۲۵ مورد در `minimumReleaseAgeExclude:` فهرست شده‌اند، ولی کلید `minimumReleaseAge:` تعریف نشده است. `saveExact: true` در workspace هست، ولی `.npmrc` با `engine-strict` وجود ندارد.
- **چرا مهم است:** خواننده خیال می‌کند cooldown انتشار، که حفاظت در برابر بستهٔ تازه‌منتشرشدهٔ مخرب است، فعال است، در حالی که نیست.
- **راهکار:** یا `minimumReleaseAge: 1440` (دقیقه) را اضافه کن، یا فهرست exclude را حذف کن. تصمیم با مالک محصول است. `engine-strict=true` را هم اضافه کن.
- **معیار پذیرش:** `pnpm install --frozen-lockfile` سبز بماند و رفتار cooldown مستند باشد.

```text
یافتهٔ OPS-12 — تنظیم cooldown انتشار pnpm را یا فعال یا حذف کن.
مشکل: pnpm-workspace.yaml:14-40 فهرست minimumReleaseAgeExclude دارد ولی minimumReleaseAge تعریف نشده، پس cooldown فعال نیست؛ engine-strict هم تنظیم نیست.
هدف (مطابق تصمیم مالک محصول؛ پیش‌فرض پیشنهادی فعال‌سازی): minimumReleaseAge: 1440 در pnpm-workspace.yaml و engine-strict برای Node 24؛ یا اگر مالک cooldown نمی‌خواهد، حذف فهرست exclude با یک کامنت دلیل.
محدودیت‌ها: lockfile فعلی نباید تغییر کند؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان.
معیار پذیرش: [ ] pnpm install --frozen-lockfile سبز [ ] docs/PROJECT_SPEC.md بخش ۳ یا ۸ رفتار را توضیح می‌دهد.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```
### کارایی و پایداری — `PERF`

#### PERF-01 — باینری‌های بومی (ffmpeg، sherpa-onnx، canvas) در بستهٔ تقریباً همهٔ Functionها، حتی `/today`

- **سطح:** Medium | **اطمینان:** متوسط | **تلاش:** M
- **محل:** `apps/web/src/server/automatic-learning.ts:61`، `apps/web/src/server/processing-jobs.ts:5-10`، `apps/web/src/server/audio-preparer.ts:20`، `apps/web/src/server/pdf-preparer.ts:6`، `apps/web/next.config.ts:49-55`، `apps/web/tools/native-build-adapter.mjs:24`
- **شاهد:**
  - در build فعلی، `(app)/today/page.js.nft.json` شامل ffmpeg، ۸ فایل sherpa و canvas است. `api/review/events` هم canvas دارد.
  - حجم این بسته‌ها: ffmpeg حدود ۷۷، sherpa حدود ۳۲ و canvas حدود ۳۴ مگابایت.
  - زنجیرهٔ import ایستا: `today/page.tsx` → `automatic-learning.ts` → `processing-jobs` → `audio-preparer` و `pdf-preparer`.
  - الگوی `"/*"` در `outputFileTracingIncludes` هم به هر Function منابع PDF اضافه می‌کند.
- **چرا مهم است:** cold start صفحه‌های روزانهٔ زبان‌آموز و APIهای سبک کندتر می‌شود. Functionها هم بی‌دلیل به سقف ۲۵۰ مگابایت نزدیک می‌شوند (OPS-06).
- **راهکار:** preparerها را فقط با `await import()` داخل handler job بارگذاری کن. تعریف job را از خواندن وضعیت جدا کن. `outputFileTracingIncludes` را به `/api/jobs/run` و مسیرهای پردازش محدود کن و الگوی `"/*"` را بردار.
- **معیار پذیرش:** بعد از build، trace صفحهٔ `today` و `api/review/events` هیچ ffmpeg، sherpa یا canvas نداشته باشد. `api/jobs/run` همچنان همه را داشته باشد و آزمون‌های processing و voice سبز بمانند.

```text
یافتهٔ PERF-01 — باینری‌های بومی را فقط در Functionهای پردازش نگه دار.
مشکل: today/page.tsx از راه apps/web/src/server/automatic-learning.ts:61 → processing-jobs.ts → audio-preparer.ts (ffmpeg-static) و pdf-preparer.ts (@napi-rs/canvas) و voice-processing به‌صورت ایستا import می‌کند؛ با الگوی "/*" در apps/web/next.config.ts:49-55 بستهٔ تقریباً هر Function (حتی /today و /api/review/events) باینری‌های بومی را دارد.
هدف: preparerها فقط با await import() درون handler jobها بارگذاری شوند؛ تعریف job از خواندن وضعیت جدا شود تا صفحه‌ها گراف ایستای پردازش را نداشته باشند؛ outputFileTracingIncludes فقط برای /api/jobs/run و مسیرهای لازم پردازش بماند و الگوی "/*" حذف یا محدود شود؛ apps/web/tools/native-build-adapter.mjs هم فقط outputهای مشخص را پر کند.
محدودیت‌ها: رفتار پردازش تغییر نکند؛ check-native-runtime و tracerها سبز بمانند؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. پیش و پس از تغییر، با یک اسکریپت فقط‌خواندنی ورودی‌های ffmpeg/sherpa/canvas را در apps/web/.next/server/app/**/*.nft.json بشمار و جدول مقایسه بده.
معیار پذیرش: [ ] trace صفحه‌های (app)/* و api/review/* بدون ffmpeg-static، sherpa-onnx و canvas-linux است [ ] api/jobs/run همهٔ منابع بومی را دارد [ ] آزمون‌های processing، pdf، audio و voice سبزند [ ] pnpm build سبز است.
پایان: lint، typecheck، تست‌ها و pnpm build را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PERF-02 — N+1 در `getReviewQueue`: یک کوئری سریالی برای هر کارت listening

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `packages/core/src/srs/review.ts:238,277-278`، `packages/core/src/card/cards.ts:203-211`
- **شاهد:**

  ```text
  review.ts:277  for (const card of cards) {
  review.ts:278    if (!(await isCardReviewable(db, ctx, card))) continue;
  ```

  برای `template === "listening"`، تابع `isCardReviewable` هر بار `getMediaAsset` را اجرا می‌کند.
- **چرا مهم است:** زمان باز شدن Today و Review با تعداد کارت‌های listening به‌صورت خطی رشد می‌کند. هر کارت یک round-trip سریالی پشت pool سه‌اتصالی است.
- **راهکار:** `frontMediaId`ها را جمع کن و همه را با یک کوئری `where id in (…) and user_id = …` بخوان. بعد نسخهٔ خالص `isCardReviewableWith(asset)` را روی نتیجه اجرا کن.
- **معیار پذیرش:** آزمون integration نشان دهد با ۵۰ کارت listening، تعداد کوئری‌ها ثابت است. ترتیب و محتوای صف هم بی‌تغییر بماند.

```text
یافتهٔ PERF-02 — N+1 در getReviewQueue را برطرف کن.
مشکل: packages/core/src/srs/review.ts:277-278 برای هر کارت به‌صورت سریالی isCardReviewable را await می‌کند و برای کارت‌های listening هر بار یک کوئری media.asset می‌زند (packages/core/src/card/cards.ts:203-211)؛ همین الگو در review.ts:238.
هدف: پیش از حلقه frontMediaId کارت‌های listening جمع و با یک کوئری مالک‌محور (where id in (...) and user_id = ctx.userId) خوانده شوند؛ یک تابع خالص isCardReviewableWith(card, asset) تصمیم بگیرد؛ خروجی صف دقیقاً همان قبلی باشد.
محدودیت‌ها: بررسی مالکیت حفظ شود؛ ترتیب صف و محدودیت ۲۰ کارت تازه (D79) تغییر نکند؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول یک آزمون integration بنویس که تعداد کوئری‌ها را با ۵۰ کارت listening بشمارد (مثلاً با log plugin Kysely) و خطی بودن را نشان دهد، بعد اصلاح کن.
معیار پذیرش: [ ] تعداد کوئری‌ها مستقل از تعداد کارت‌ها است [ ] review.int.test.ts و study.spec سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PERF-03 — هر درخواست صفحه و API یک round-trip بی‌timeout به Supabase Auth دارد

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/server/auth/gateway.ts:50-52`، `apps/web/src/server/auth/learner.ts:20,72`، `apps/web/src/server/auth/supabase.ts:22`، `apps/web/src/proxy.ts:50`
- **شاهد:** `currentUser()` تابع `auth.getUser()` را صدا می‌زند، که یک HTTP به Supabase است، و این در هر API و هر صفحه تکرار می‌شود. همین درخواست پیش‌تر در proxy با `getClaims()` و به‌صورت محلی اعتبارسنجی شده است. `createServerClient` بدون `fetch` دارای timeout ساخته می‌شود.
- **چرا مهم است:** هر کنش، مثل ثبت هر پاسخ مرور، ۵۰ تا ۲۰۰ میلی‌ثانیه تأخیر ثابت دارد. کندی یا قطعی Supabase Auth هم بی‌سقف کل اپ را معطل می‌کند.
- **راهکار:** در `currentUser` از `getClaims()` استفاده کن، که JWT را با JWKS کش‌شده محلی می‌سنجد. `getUser` را فقط برای جریان‌های حساس، مثل حذف حساب، نگه دار. به `createServerClient` یک `global.fetch` با `AbortSignal.timeout(5000)` بده.
- **معیار پذیرش:** `GET /api/review` با نشست معتبر هیچ درخواستی به `/auth/v1/user` نفرستد. با Auth بی‌پاسخ، پاسخ زیر ۶ ثانیه برسد. آزمون‌های `auth/flow` و `api.int` سبز بمانند.

```text
یافتهٔ PERF-03 — round-trip شبکه‌ای Auth در هر درخواست را حذف و برای Auth timeout بگذار.
مشکل: apps/web/src/server/auth/gateway.ts:50-52 در هر صفحه و API تابع auth.getUser() (HTTP به Supabase Auth) را بی‌timeout اجرا می‌کند، در حالی که proxy (apps/web/src/proxy.ts:50) همان نشست را با getClaims() محلی سنجیده است.
هدف: currentUser هویت را از getClaims() بگیرد (sub به‌عنوان user id، با بررسی امضا و انقضا)؛ getUser فقط برای جریان‌های حساس (حذف حساب، و هر جای دیگری که دادهٔ تازهٔ Auth لازم است) بماند؛ createServerClient در apps/web/src/server/auth/supabase.ts و proxy با global.fetch دارای AbortSignal.timeout(5000) ساخته شود.
محدودیت‌ها: امنیت نشست کاهش نیابد: getClaims باید امضای JWT را بسنجد (نه فقط decode)؛ مستندات @supabase/ssr و @supabase/supabase-js نصب‌شده را در node_modules بخوان؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. آزمون‌ها: واحد برای gateway با claims معتبر/منقضی؛ integration برای Auth بی‌پاسخ (fetch جعلی که resolve نمی‌شود) که زیر ۶ ثانیه 401/503 بدهد.
معیار پذیرش: [ ] در مسیرهای عادی هیچ فراخوانی /auth/v1/user نیست [ ] JWT منقضی یا جعلی رد می‌شود [ ] auth/flow.int.test.ts و api.int.test.ts و signin.spec سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PERF-04 — کوئری‌های زیاد در Today، N+1 در خروجی‌ها و جمع هزینه در حافظه

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/app/(app)/today/page.tsx:40-43,74-85`، `apps/web/src/server/automatic-learning.ts:279-287`، `packages/core/src/html/exports.ts:193-195`، `packages/core/src/anki/exports.ts:138-150,228-230`، `packages/core/src/src/service.ts:834-835,1041-1042`، `packages/core/src/quota/costs.ts:120-131`
- **شاهد:**
  - Today برای هر جلسهٔ اخیر چند کوئری موازی می‌زند، که حدود ۴۰ کوئری پشت pool سه‌اتصالی می‌شود.
  - `for (const row of rows) result.push(await getHtmlExport(…))`
  - export کارت‌ها برای هر کارت `getCard` و `describe` را جدا صدا می‌زند.
  - `beginProviderStep` همهٔ ردیف‌های `quota.provider_cost` ماه را می‌خواند و در JS جمع می‌زند.
- **چرا مهم است:** با رشد داده، زمان صفحهٔ اصلی و زمان قفل تراکنش‌های export و پردازش خطی بالا می‌رود. اندازهٔ داده فعلاً کوچک است.
- **راهکار:** یک reader تجمعی برای Today با `where session_id in (…)` بنویس. `getCards` و `describeMany` را با `in` پیاده کن. جمع هزینه‌ها را با `sum(...) filter (where …)` در یک کوئری بگیر.
- **معیار پذیرش:** تعداد کوئری Today با ۱۰ جلسه حداکثر ۸ باشد. export ۵۰ کارتی تعداد کوئری ثابت داشته باشد. آزمون‌های `costs` و `pricing` همان نتایج را بدهند.

```text
یافتهٔ PERF-04 — الگوهای N+1 و جمع در حافظه را در Today، خروجی‌ها و بررسی بودجه کاهش بده.
مشکل: apps/web/src/app/(app)/today/page.tsx:40-85 با automatic-learning.ts:279-287 برای هر جلسهٔ اخیر چند کوئری می‌زند (تا حدود ۴۰)؛ packages/core/src/html/exports.ts:193-195 و anki/exports.ts:138-150,228-230 برای هر ردیف/کارت جدا کوئری می‌زنند؛ packages/core/src/src/service.ts:834-835,1041-1042 برای هر پیوند مالکیت را جدا می‌سنجد؛ packages/core/src/quota/costs.ts:120-131 همهٔ هزینه‌های ماه را در JS جمع می‌زند.
هدف: reader تجمعی readTodayNextSteps(db, actor, sessionIds) با یک کوئری برای هر جدول؛ getCards/describeMany با where id in؛ assertSessionOwner روی مجموعهٔ یکتای session_id و update با in؛ جمع scopeهای هزینه با یک کوئری aggregate (sum ... filter).
محدودیت‌ها: رفتار و خطاها (not_found، conflict، بودجه) تغییر نکنند؛ مالکیت در همهٔ کوئری‌ها حفظ شود؛ کار را در commitهای جدا برای هر بخش انجام بده؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. برای هر بخش اول آزمون integration شمارش کوئری بنویس.
معیار پذیرش: [ ] Today با ۱۰ جلسه حداکثر ۸ کوئری [ ] export ۵۰ کارت تعداد کوئری ثابت [ ] costs/pricing همان نتایج [ ] e2e redesign و session-navigation سبز.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PERF-05 — فراخوانی‌های Vercel Blob بدون timeout

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `packages/core/src/plt/storage-vercel-blob.ts:64,85,94,140`
- **شاهد:** `await head(key)`، `await put(…)`، `await del(key)` هیچ‌کدام `abortSignal` ندارند. در مقابل، OpenRouter، web-push و SMTP timeout دارند.
- **چرا مهم است:** یک `put` معلق تا kill شدن Function، یعنی ۸۰۰ ثانیه، ادامه پیدا می‌کند. بعد job دوباره claim می‌شود و همان کار و هزینه تکرار می‌شود.
- **راهکار:** `abortSignal: AbortSignal.timeout(settings.blobTimeoutMs ?? 60_000)` را به همهٔ فراخوانی‌ها اضافه کن. abort را به `AppError` قابل retry نگاشت کن.
- **معیار پذیرش:** آزمون با fetch معلق، `put` را بعد از timeout با کد `storage_timeout` رد کند و job آن را retry کند.

```text
یافتهٔ PERF-05 — برای فراخوانی‌های Vercel Blob timeout بگذار.
مشکل: packages/core/src/plt/storage-vercel-blob.ts:64,85,94,140 فراخوانی‌های head، put، del و compose را بی‌abortSignal اجرا می‌کند.
هدف: همهٔ فراخوانی‌ها abortSignal: AbortSignal.timeout(تنظیم قابل تغییر، پیش‌فرض ۶۰ ثانیه) بگیرند و خطای abort به AppError قابل retry با کد storage_timeout تبدیل شود.
محدودیت‌ها: فقط همین فایل و تنظیمات storage؛ نسخهٔ نصب‌شدهٔ @vercel/blob را در node_modules بخوان تا نام دقیق گزینه را بدانی؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون واحد با SDK جعلی معلق بنویس.
معیار پذیرش: [ ] put معلق بعد از timeout با storage_timeout رد می‌شود [ ] خطا retryable است [ ] storage.int.test.ts سبز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PERF-06 — zod کامل و کل `strings.ts` در chunk مشترک پوستهٔ زبان‌آموز

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/ui/workspace/api.ts:1`، `apps/web/src/ui/recording/store.ts:1`، `apps/web/src/ui/recording/capture-diagnostics.ts:1`، `apps/web/src/ui/strings.ts`
- **شاهد:** chunk مشترک zod حدود ۹۲ کیلوبایت است، و chunk مربوط به `strings.ts` حدود ۱۲۲ کیلوبایت. هر دو در مسیر `(app)/today` بارگذاری می‌شوند.
- **چرا مهم است:** حدود ۲۱۰ کیلوبایت JavaScript اضافه روی موبایل، پیش از هر تعامل.
- **راهکار:** در سه فایل کلاینتی، `zod/mini` را import کن. `strings.ts` را به ماژول‌های هر حوزه بشکن. آزمون منشأ رشته‌ها باید همهٔ آن‌ها را پوشش دهد.
- **معیار پذیرش:** chunkهای مشترک `(app)/today` دست‌کم ۱۰۰ کیلوبایت کوچک‌تر شوند. `strings.test.ts` و e2e سبز بمانند.

```text
یافتهٔ PERF-06 — حجم JavaScript مشترک پوستهٔ زبان‌آموز را کم کن.
مشکل: zod کامل (حدود ۹۲KB) از apps/web/src/ui/workspace/api.ts، apps/web/src/ui/recording/store.ts و capture-diagnostics.ts و کل apps/web/src/ui/strings.ts (حدود ۱۲۲KB) در chunk مشترک مسیر (app)/today به مرورگر می‌روند.
هدف: سه فایل کلاینتی از zod/mini استفاده کنند (یا validator سبک)، و strings.ts به چند ماژول هر حوزه (shell، recording، workspace، …) شکسته شود با همان API؛ آزمون منشأ رشته‌ها (strings.test.ts) همهٔ ماژول‌ها را پوشش دهد.
محدودیت‌ها: هیچ متن رابط تغییر نکند؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اندازهٔ chunkها را پیش و پس از تغییر با ls -la apps/web/.next/static/chunks و manifest مسیر مقایسه کن.
معیار پذیرش: [ ] کاهش دست‌کم ۱۰۰KB در chunkهای مشترک (app)/today [ ] strings.test.ts و pnpm test:e2e سبزند.
پایان: lint، typecheck، تست‌ها و pnpm build را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PERF-07 — نکته‌های دیتابیس و هم‌زمانی بدون ریسک فوری

- **سطح:** Info | **اطمینان:** بالا | **تلاش:** S
- **محل:** Supabase performance advisors، `apps/web/vercel.json:3`، `packages/core/src/db/index.ts:26,33`
- **شاهد و توضیح:**
  - advisor گزارش می‌دهد ۵۱ کلید خارجی بدون index پوشاننده وجود دارد، از جمله FKهای `card.*`، `note.*`، `srs.review_event` و `org.class_session`. ۲۴ index هم هنوز استفاده نشده‌اند. با دادهٔ کم پایلوت این طبیعی است.
  - cron هر دقیقه اجرا می‌شود و هر invocation یک pool با `max: 3` دارد. اجرای هم‌پوشان در اوج پردازش تا حدود ۳۹ اتصال به pooler رایگان می‌رسد. سقف هم‌زمانی ثبت نشده است.
- **راهکار:** فعلاً تغییری لازم نیست. پیش از ورود زبان‌آموزان، indexهای FKهایی را که در حذف cascade یا join داغ استفاده می‌شوند اضافه کن، به‌ویژه `srs.review_event(card_id,user_id)` و `note.revision(notebook_id,user_id)`. سقف هم‌زمانی runner را هم در ADR ثبت کن.
- **معیار پذیرش:** فهرست FKهای داغ با migration index‌گذاری شده باشد و ADR-0001 سقف هم‌زمانی را داشته باشد.

```text
یافتهٔ PERF-07 — indexهای FK داغ را اضافه و سقف هم‌زمانی runner را ثبت کن.
مشکل: Supabase advisor ۵۱ FK بدون index گزارش می‌دهد و هم‌زمانی runner (cron دقیقه‌ای با pool سه‌اتصالی، apps/web/vercel.json:3 و packages/core/src/db/index.ts:26,33) سقف ثبت‌شده ندارد.
هدف: (۱) از میان FKهای گزارش‌شده، آن‌هایی را که در حذف cascade، پاک‌سازی privacy یا joinهای پرتکرار مصرف می‌شوند (حداقل srs.review_event(card_id,user_id)، srs.review_undo(review_event_id,user_id)، card.revision(card_id,user_id)، note.revision(notebook_id,user_id)، card.session_link(session_id,user_id)) با یک migration تازه index کن؛ (۲) سقف هم‌زمانی runner (مثلاً شمار state='running' پیش از claim) را در docs/adr/0001-stack-and-hosting.md به‌صورت تصمیم پیشنهادی ثبت کن.
محدودیت‌ها: تغییر schema فقط با migration تازه و pnpm db:types؛ index unused را حذف نکن؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول فهرست indexها و دلیل هر کدام را بگو و منتظر تأیید بمان.
معیار پذیرش: [ ] migration روی Supabase محلی اعمال می‌شود [ ] pnpm db:types بی‌تغییر یا با تفاوت مورد انتظار [ ] آزمون‌های integration سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### کیفیت کد و معماری — `QUA`

#### QUA-01 — تابع حدوداً ۱٬۴۰۰ خطی `processingJob` و چند فایل بسیار بزرگ دیگر

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** L
- **محل:** `packages/core/src/proc/worker.ts:864-2250`؛ همچنین `packages/core/src/src/service.ts` (۱٬۶۶۷ خط)، `packages/core/src/proc/knowledge-generation.ts` (۱٬۵۵۵)، `apps/web/src/ui/workspace/SourcesView.tsx` (۱٬۲۲۵)، `apps/web/src/ui/admin/CommunicationScreens.tsx` (۱٬۶۲۸)، `apps/web/src/ui/recording/controller.ts` (۱٬۱۳۵)
- **شاهد:** closure `run` از خط ۸۷۱ تا ۲۲۴۶، با ۱۶ سطح تورفتگی. رونویسی، vision، PDF، تولید دانش، تعمیر، voice، تسویهٔ سهمیه و نگاشت خطا همه در آن جمع شده‌اند.
- **چرا مهم است:** هر تغییر در یک مرحله از دل همهٔ مراحل می‌گذرد. آزمون واحد مستقل هر مرحله ممکن نیست، و ریسک رگرسیون در مسیری که پول و محتوای کلاس را جابه‌جا می‌کند بالاست.
- **راهکار:** بدون تغییر رفتار، مراحل را به ماژول‌های `proc/steps/*.ts` با امضای یکسان بشکن و `run` را orchestrator کوتاه کن. الگوی `knowledge-generation-step.ts` موجود را دنبال کن. کار را در چند PR کوچک انجام بده.
- **معیار پذیرش:** هیچ تابعی در `proc` بیش از حدود ۳۰۰ خط نباشد. هر مرحله آزمون واحد با provider mock داشته باشد. همهٔ آزمون‌های موجود proc بی‌تغییر سبز بمانند.

```text
یافتهٔ QUA-01 — processingJob را بدون تغییر رفتار به مراحل مستقل بشکن.
مشکل: packages/core/src/proc/worker.ts:864-2250 یک closure حدوداً ۱٬۴۰۰ خطی است که رونویسی، vision/PDF، تولید و تعمیر دانش، voice، تسویهٔ سهمیه و نگاشت خطا را با هم دارد.
هدف: هر مرحله در یک فایل packages/core/src/proc/steps/<name>.ts با امضای یکسان (مثلاً (ctx, state) => Promise<state>) و همان ctx.step/checkpoint؛ run فقط ترتیب مراحل و مدیریت خطای سطح بالا را داشته باشد؛ الگوی knowledge-generation-step.ts را دنبال کن.
محدودیت‌ها: صفر تغییر رفتار: نام stepها، کلیدهای checkpoint و cache، ترتیب فراخوانی provider، idempotency و تسویهٔ سهمیه دقیقاً همان بمانند؛ کار را در چند commit کوچک (یک مرحله در هر commit) انجام بده و پس از هر commit آزمون‌ها را اجرا کن؛ مرز ماژول‌ها (pnpm check:boundaries) حفظ شود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول نقشهٔ مراحل (خط شروع و پایان هر بخش در worker.ts) و ترتیب استخراج را بگو و منتظر تأیید بمان. پیش از هر استخراج، اگر آزمون مشخصی برای آن مرحله نیست، آزمون characterization بنویس.
معیار پذیرش: [ ] هیچ تابع در proc بیش از حدود ۳۰۰ خط نیست [ ] هر مرحله آزمون واحد مستقل با provider mock دارد [ ] همهٔ آزمون‌های موجود proc و e2e پردازش بی‌تغییر سبزند.
پایان: pnpm verify را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### QUA-02 — فهرست متغیرهای محیطی و اسرار ناقص است (`.env.example`، `SECRETS.md`)

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `.env.example`، `docs/runbooks/SECRETS.md:19-27`، `docs/PROJECT_SPEC.md:211`، `apps/web/src/server/storage.ts:15`، `packages/core/src/voc/settings.ts:75`، `apps/web/src/server/voice-engine.ts:186-189`، `apps/web/src/server/capture-staging-jobs.ts:21-24`، `apps/web/src/server/recording-routes.ts`، `apps/web/src/server/preview-mode.ts:3`
- **شاهد:**
  - این نام‌ها در کد خوانده می‌شوند ولی در `.env.example` نیستند:
    - `BLOB_STORE_ID` و `BLOB_READ_WRITE_TOKEN`
    - `VOICE_SETTINGS_JSON`، `VOICE_EMBEDDING_MODEL_PATH` و `VOICE_SEGMENTATION_MODEL_PATH`
    - `RECALINO_CAPTURE_EARLY_UPLOAD`، `RECALINO_CAPTURE_EARLY_TRANSCRIPTION` و `RECALINO_CAPTURE_DIAGNOSTICS`
    - `RECALINO_UI_PREVIEW` و `RECALINO_PROVISION_VOICE_MODELS`
    - `VOICE_RELEASE_CHECK_TOKEN` و `VOICE_RELEASE_CHECK_EXPIRES_AT`
  - جدول `SECRETS.md` فقط پنج سر دارد. کلیدهای OpenRouter، Blob، App Password جیمیل، VAPID و پشتیبان در آن نیستند، با اینکه خود سند می‌گوید سطر هر سرویس تازه اضافه می‌شود.
- **چرا مهم است:** عضو تازه یا سشن ابری کلیدهای D60 و D61 ضبط یا موتور صدا را فقط با grep کد پیدا می‌کند. در نشت مشکوک هم روال چرخش برای نیمی از اسرار مستند نیست. اسکن client-bundle هم همین فهرست را مبنا می‌گیرد.
- **راهکار:** نام‌ها را به بخش‌های تازهٔ `.env.example` اضافه کن، فقط نام با یک خط توضیح. سطرهای چرخش را به `SECRETS.md` اضافه کن. یک آزمون واحد بنویس که نام‌های `process.env.X` در کد را با `.env.example` مقایسه کند.
- **معیار پذیرش:** آزمون `env-example.test.ts` سبز باشد. `SECRETS.md` همهٔ اسرار production را با روال چرخش داشته باشد.

```text
یافتهٔ QUA-02 — فهرست متغیرهای محیطی و اسرار را کامل و با آزمون محافظت کن.
مشکل: .env.example حدود ۱۲ نام خوانده‌شده در کد را ندارد (BLOB_STORE_ID، BLOB_READ_WRITE_TOKEN، VOICE_SETTINGS_JSON، VOICE_EMBEDDING_MODEL_PATH، VOICE_SEGMENTATION_MODEL_PATH، RECALINO_CAPTURE_EARLY_UPLOAD، RECALINO_CAPTURE_EARLY_TRANSCRIPTION، RECALINO_CAPTURE_DIAGNOSTICS، RECALINO_UI_PREVIEW، RECALINO_PROVISION_VOICE_MODELS، VOICE_RELEASE_CHECK_TOKEN، VOICE_RELEASE_CHECK_EXPIRES_AT) و جدول docs/runbooks/SECRETS.md:19-27 فقط پنج سر دارد.
هدف: (۱) .env.example بخش‌های «Storage (Vercel Blob)»، «Voice engine»، «Capture switches (D60/D61/diagnostics)» و «Preview/dev only» با فقط نام و یک خط توضیح و ارجاع FR/D؛ (۲) SECRETS.md سطر هر secret تولید (OPENROUTER_API_KEY، BLOB_READ_WRITE_TOKEN، RECALINO_GMAIL_APP_PASSWORD، RESEND_API_KEY، RECALINO_WEB_PUSH_PRIVATE_KEY، RECALINO_BACKUP_KEY_*، VOICE_RELEASE_CHECK_TOKEN) با محل نگهداری و روال چرخش؛ (۳) آزمون واحد tools/env-example.test.ts که نام‌های process.env.X در apps/web/src، packages/core/src و tools را (با فهرست استثنای مستند مثل NODE_ENV و VERCEL*) با .env.example مقایسه کند.
محدودیت‌ها: هیچ مقداری ننویس، فقط نام؛ اگر spike حذف شده (SEC-02)، نام‌های SPIKE_* را اضافه نکن؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون را بنویس و شکستش را ببین، بعد فهرست را کامل کن.
معیار پذیرش: [ ] آزمون سبز [ ] tools/client-bundle هم از فهرست کامل استفاده می‌کند یا تفاوتش مستند است [ ] PROJECT_SPEC بخش ۸ به آزمون ارجاع می‌دهد.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### QUA-03 — مخزن README ریشه ندارد؛ راهنمای `apps/web` فقط بلوک خودکار Next است

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** ریشهٔ مخزن (`README.md` وجود ندارد)، `apps/web/CLAUDE.md`، `apps/web/AGENTS.md`
- **شاهد:** `ls README*` نتیجه‌ای ندارد. `apps/web/CLAUDE.md` فقط `@AGENTS.md` است و AGENTS.md همان بلوک خودکار «This is NOT the Next.js you know» است.
- **چرا مهم است:** عضو تازه یا ابزار باید از CLAUDE.md و `docs/PROJECT_SPEC.md` بفهمد اپ چطور بالا می‌آید. هر دو فارسی‌اند و صفحهٔ GitHub مخزن خالی است.
- **راهکار:** یک README کوتاه دوزبانه بنویس: یک پاراگراف معرفی، پیش‌نیازها (Node 24، pnpm 12 و Docker)، پنج دستور اصلی، و پیوند به CLAUDE.md و PROJECT_SPEC. در `apps/web/AGENTS.md`، پایین بلوک خودکار، چند خط راهنمای اختصاصی اپ اضافه کن.
- **معیار پذیرش:** README با `pnpm install`، `pnpm db:start`، `pnpm db:env`، `pnpm dev` و `pnpm verify` وجود داشته باشد، و پیوندهایش سالم باشند.

```text
یافتهٔ QUA-03 — README ریشه و راهنمای کوتاه apps/web را بنویس.
مشکل: مخزن README.md ریشه ندارد و apps/web/CLAUDE.md فقط به بلوک خودکار Next در apps/web/AGENTS.md ارجاع می‌دهد.
هدف: README.md کوتاه (حداکثر حدود ۶۰ خط؛ انگلیسی با یک پاراگراف فارسی یا برعکس، مطابق قاعدهٔ اسناد پروژه) با معرفی یک‌پاراگرافی، پیش‌نیازها (Node 24، pnpm 12، Docker برای Supabase محلی)، دستورهای pnpm install، pnpm db:start، pnpm db:env، pnpm dev، pnpm verify، pnpm test:e2e، و پیوند به CLAUDE.md، docs/PROJECT_SPEC.md و docs/ops/CI_LOW_COST_POLICY.md؛ در apps/web/AGENTS.md زیر بلوک خودکار (بدون دست زدن به خود بلوک) چند خط دربارهٔ ساختار src/app، src/server و src/ui.
محدودیت‌ها: املای Recalino؛ هیچ ادعایی فراتر از CLAUDE.md و PROJECT_SPEC؛ بلوک <!-- BEGIN:nextjs-agent-rules --> را تغییر نده؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول متن پیشنهادی را نشان بده و منتظر تأیید بمان.
معیار پذیرش: [ ] README ساخته شده و پیوندهایش سالم‌اند [ ] pnpm lint سبز است.
پایان: نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### QUA-04 — helperهای تکراری `actor` و `key` در ۱۱ فایل route، با اعتبارسنجی ناهمسان

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/server/export-routes.ts:54`، `media-routes.ts:22`، `processing-routes.ts:28`، `source-routes.ts:44`، `study-routes.ts:39-47`، `voice-routes.ts:42-48`، `admin-routes.ts:92-96`، `org-routes.ts:36-40`، `support-routes.ts:11`
- **شاهد:** شش نسخهٔ یکسان از `function actor(ctx)` وجود دارد. `key(request)` در admin و voice با `isValidIdempotencyKey` کار می‌کند، ولی در org، study و support فقط `if (!value)` دارد. core جبران می‌کند، پس امنیتی نیست.
- **چرا مهم است:** تغییر قرارداد کلید یا context باید در ۱۱ جا تکرار شود، و پیام خطا بین routeها فرق می‌کند.
- **راهکار:** `learnerActor(ctx)` و `idempotencyKey(request)` را در `api.ts` export کن و کپی‌ها را با آن‌ها جایگزین کن.
- **معیار پذیرش:** `grep -c "^function actor" apps/web/src/server/*-routes.ts` برابر صفر باشد، و کلید نامعتبر در همهٔ routeها خطای یکسان بدهد.

```text
یافتهٔ QUA-04 — helperهای تکراری actor و key را یکی کن.
مشکل: شش نسخهٔ یکسان actor(ctx) و پنج نسخهٔ key(request) با دو رفتار متفاوت (با و بی isValidIdempotencyKey) در apps/web/src/server/*-routes.ts کپی شده‌اند.
هدف: دو export در apps/web/src/server/api.ts (learnerActor و idempotencyKey، همیشه با isValidIdempotencyKey و پیام‌های required/invalid یکسان) و جایگزینی همهٔ کپی‌ها.
محدودیت‌ها: رفتار موفق routeها تغییر نکند؛ اگر route‌ای امروز کلید نامعتبر را می‌پذیرفت، آن را در گزارش فهرست کن؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. آزمون api برای کلید نامعتبر در org و study اضافه کن.
معیار پذیرش: [ ] هیچ تعریف محلی actor یا key در *-routes.ts نمی‌ماند [ ] آزمون‌ها سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### QUA-05 — snapshotهای JSONB با `as unknown as` و بدون Schema خوانده می‌شوند

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `packages/core/src/html/exports.ts:76,215,243`، `packages/core/src/anki/exports.ts:78,249,275`، `packages/core/src/card/cards.ts:604`، `packages/core/src/srs/review.ts:346,498`
- **شاهد:** `const snapshot = row.snapshot as unknown as HtmlSnapshot;` و `const after = replay.after_state as unknown as CardSchedule;`. این‌ها همهٔ موارد `as unknown as` در کد غیرآزمونی‌اند. هیچ `any` یا `@ts-ignore` وجود ندارد.
- **چرا مهم است:** پس از تغییر نوع یا migration، دادهٔ قدیمی بی‌صدا با شکل نادرست مصرف می‌شود. این خلاف اصل «مصرف فقط پس از اعتبارسنجی Schema» است که برای خروجی LLM رعایت شده.
- **راهکار:** برای این چهار نوع، schema نسخه‌دار zod بنویس و در خواندن `parse` کن. شکست را به `AppError` با کد `snapshot_invalid` نگاشت کن.
- **معیار پذیرش:** هیچ `as unknown as` روی ستون دیتابیس در core نماند، و snapshot ناقص خطای کنترل‌شده بدهد.

```text
یافتهٔ QUA-05 — خواندن snapshotهای JSONB را با schema اعتبارسنجی کن.
مشکل: ستون‌های JSONB در packages/core/src/html/exports.ts:76,215,243، anki/exports.ts:78,249,275، card/cards.ts:604 و srs/review.ts:346,498 با as unknown as به نوع دامنه cast می‌شوند.
هدف: schemaهای zod برای HtmlSnapshot، AnkiSnapshot، snapshot کارت و CardSchedule (کنار تعریف نوع، با نوع استخراج‌شده از schema)؛ خواندن با parse و نگاشت شکست به AppError با کد snapshot_invalid.
محدودیت‌ها: ساختار ذخیره‌شده تغییر نکند؛ داده‌های موجود باید parse شوند (اگر فیلد اختیاری قدیمی هست، اختیاری بماند)؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون snapshot ناقص بنویس.
معیار پذیرش: [ ] هیچ as unknown as روی ستون DB در packages/core/src نمی‌ماند [ ] snapshot ناقص خطای کنترل‌شده می‌دهد [ ] آزمون‌های export و review سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### QUA-06 — توابع export‌شدهٔ بی‌مصرف (کد مرده)

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/server/automatic-learning-notifications.ts:33`، `packages/core/src/quota/ledger.ts:403`، `packages/core/src/org/sessions.ts:181,384`، `packages/core/src/priv/deletion.ts:93`، `packages/core/src/support/email.ts:394,575`
- **شاهد:** این توابع جز تعریف و re-export در `index` هیچ مصرفی ندارند: `notifyAutomaticLearningForVerifiedUpload`، `confirmedReservationAmounts`، `createRecordingSession`، `getDeletionRequest`، `getSourceDeletionRequest` و دو تابع در `email.ts`.
- **چرا مهم است:** API ماژول‌ها بزرگ‌تر از واقعیت به نظر می‌رسد، و خواننده مسیر اشتباه را دنبال می‌کند.
- **راهکار:** هر تابع را یا حذف کن، همراه re-export، یا اگر برای کار بعدی رزرو است با ارجاع FR یا D مستند کن.
- **معیار پذیرش:** grep برای هر نام یا هیچ نتیجه‌ای ندهد یا مصرف‌کنندهٔ مستند داشته باشد، و `pnpm verify` سبز باشد.

```text
یافتهٔ QUA-06 — توابع export‌شدهٔ بی‌مصرف را حذف یا مستند کن.
مشکل: notifyAutomaticLearningForVerifiedUpload (apps/web/src/server/automatic-learning-notifications.ts:33)، confirmedReservationAmounts (packages/core/src/quota/ledger.ts:403)، createRecordingSession و getDeletionRequest (packages/core/src/org/sessions.ts:181,384)، getSourceDeletionRequest (packages/core/src/priv/deletion.ts:93) و دو تابع در packages/core/src/support/email.ts:394,575 جز تعریف و re-export مصرفی ندارند.
هدف: هر تابع یا با re-exportش حذف شود، یا اگر برای FR مشخصی رزرو است، کامنت ارجاع FR/D و آزمون واحد بگیرد.
محدودیت‌ها: پیش از حذف هر تابع، با grep در apps، packages و tools (از جمله آزمون‌ها) بی‌مصرف بودنش را دوباره تأیید کن؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول جدول «نام، محل، تصمیم پیشنهادی (حذف یا نگه‌داشتن)، دلیل» را نشان بده و منتظر تأیید بمان.
معیار پذیرش: [ ] هر نام یا حذف شده یا مستند است [ ] pnpm verify سبز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته، حذف یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### QUA-07 — بهداشت مخزن: پوشهٔ `claude promps` و ۳۸ مگابایت خروجی میانی در `artifacts`

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `claude promps/` (سه فایل tracked)، `artifacts/recalino-presentation/.build/` (۸۹ فایل)
- **شاهد:**
  - نام پوشه غلط املایی و فاصله دارد، و دو سند به آن پیوند داده‌اند: `docs/design/REFERENCE_STUDY_OUTPUT_2026-10-06.md` و `docs/fr/VOC.md`.
  - `artifacts/` شامل ۵۲۰ فایل tracked و ۳۸ مگابایت است. پوشهٔ `.build` آن فایل‌هایی مثل `deck.json` با ۶٫۹ مگابایت و دو `candidate-v*.pptx` دارد.
- **چرا مهم است:** clone هر سشن ابری سنگین‌تر می‌شود، و rename آیندهٔ پوشه پیوندها را می‌شکند. brief این پوشه مبنای تصمیم SEC-04 هم هست.
- **راهکار:** پوشه را به `docs/design/reference-output/` منتقل کن و پیوندها را به‌روز کن. `.build`ها را از git حذف و به `.gitignore` اضافه کن. پاک کردن تاریخچه فقط با تأیید مالک انجام شود.
- **معیار پذیرش:** پیوندها سالم باشند، `git ls-files artifacts | grep /.build/` خالی باشد، و lint سبز بماند.

```text
یافتهٔ QUA-07 — پوشه‌های «claude promps» و خروجی‌های میانی artifacts را مرتب کن.
مشکل: پوشهٔ tracked «claude promps/» نام غلط و فاصله‌دار دارد و دو سند (docs/design/REFERENCE_STUDY_OUTPUT_2026-10-06.md، docs/fr/VOC.md) به آن پیوند داده‌اند؛ artifacts/recalino-presentation/.build/ ۸۹ فایل میانی (حدود ۸ مگابایت) دارد.
هدف: انتقال «claude promps/» به docs/design/reference-output/ با git mv و به‌روزرسانی همهٔ پیوندها؛ حذف .build از ردیابی (git rm --cached) و افزودن الگو به .gitignore؛ فایل‌ها روی دیسک بمانند.
محدودیت‌ها: تاریخچهٔ git را بازنویسی نکن؛ این کار جابه‌جایی و حذف از ردیابی است، پس پیش از هر git mv یا git rm --cached فهرست دقیق را نشان بده و تأیید بگیر؛ CI برای docs اجرا نمی‌شود ولی lint محلی را اجرا کن.
روش: اول فهرست فایل‌ها، مقصدها و پیوندهای متأثر (grep -rn "claude promps") را نشان بده و منتظر تأیید بمان.
معیار پذیرش: [ ] grep -rn "claude promps" خالی است [ ] git ls-files artifacts | grep "/.build/" خالی است [ ] pnpm lint سبز است.
پایان: نتیجه را خلاصه کن و فایل‌های جابه‌جاشده، حذف‌شده از ردیابی یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### QUA-08 — کد production به stylesheet، primitiveها و کلاس‌های «preview» وابسته است

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/app/(app)/layout.tsx:2,14,23`، `apps/web/src/app/deletion/page.tsx:5,19-20`، `apps/web/src/app/setup/voice/page.tsx:1`، `apps/web/src/ui/workspace/CardEditor.tsx:10`، `apps/web/src/ui/workspace/ReviewView.tsx:121`
- **شاهد:**
  - `import "../../ui/preview/preview.css"` و `<div className="preview-root">` برای فضای کار واقعی زبان‌آموز به کار رفته‌اند.
  - primitiveهای `ui/preview/primitives` در `CardEditor` و `ReviewView` استفاده می‌شوند.
  - ده فایل workspace کلاس‌های `preview-*` دارند، و `style={{ maxWidth: 760, … }}` در `/deletion` هست.
- **چرا مهم است:** «preview» نام حالت fixture و دادهٔ مصنوعی است (D35). اختلاط آن با کد واقعی، تغییر یکی را به شکستن دیگری تبدیل می‌کند و قاعدهٔ «تغییرات در `app.css` و CSS Modules» را دور می‌زند.
- **راهکار:** فایل را به `ui/workspace/workspace.css` و primitiveها را به `ui/workspace/primitives.tsx` با نام خنثی منتقل کن. `/preview` آن‌ها را import کند، نه برعکس. inline styleها را به CSS Module ببر.
- **معیار پذیرش:** هیچ فایل خارج از `ui/preview` و `app/preview` از `ui/preview/` import نکند. ظاهر صفحه‌ها در ۳۷۵ و ۱۴۴۰ بی‌تغییر بماند.

```text
یافتهٔ QUA-08 — وابستگی کد production به stylesheet و primitiveهای «preview» را جدا کن.
مشکل: apps/web/src/app/(app)/layout.tsx، deletion/page.tsx و setup/voice/page.tsx فایل ui/preview/preview.css را import می‌کنند و کلاس preview-root دارند؛ CardEditor.tsx و ReviewView.tsx از ui/preview/primitives استفاده می‌کنند؛ /deletion inline style دارد.
هدف: انتقال استایل مشترک به apps/web/src/ui/workspace/workspace.css (یا CSS Module) و primitiveها به apps/web/src/ui/workspace/primitives.tsx با نام‌های خنثی؛ /preview از نسخهٔ workspace import کند؛ inline styleهای /deletion و ReviewView و CardMedia به CSS Module بروند؛ هیچ رنگ، اندازه یا فاصلهٔ تازه‌ای اضافه نشود.
محدودیت‌ها: ظاهر هیچ صفحه‌ای تغییر نکند؛ vendor CSS دست نخورد؛ آزمون vendor.test.ts و strings.test.ts سبز بمانند؛ این کار جابه‌جایی و تغییر نام فایل دارد، پس پیش از هر git mv فهرست را نشان بده و تأیید بگیر.
روش: اول نقشهٔ جابه‌جایی را بگو و منتظر تأیید بمان. screenshot قبل و بعد از /today، /review، /sessions/<id>، /deletion و /preview/today در عرض ۳۷۵ و ۱۴۴۰ بگیر.
معیار پذیرش: [ ] grep 'ui/preview/' در apps/web/src بیرون از ui/preview و app/preview خالی است [ ] screenshotها یکسان‌اند [ ] pnpm test:e2e سبز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته، جابه‌جاشده یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### QUA-09 — نکته‌های کوچک کیفیت بدون باگ فعلی

- **سطح:** Info | **اطمینان:** بالا | **تلاش:** S
- **محل:** `packages/core/src/acc/account.ts:51-58`، `packages/core/src/aip/pricing.ts:120-123`
- **شاهد و توضیح:**
  - امضای `lockAccount(db: Database | Tx)` اجازه می‌دهد `FOR UPDATE` بیرون از تراکنش اجرا شود، که بی‌اثر است. هر ۱۱۰ فراخوانی فعلی `Tx` می‌دهند.
  - `total += (count / divisor) * rate.rateMicros` تقسیم را پیش از ضرب انجام می‌دهد. بعد `Math.ceil` همیشه به نفع سیستم گرد می‌کند. ذخیرهٔ پول integer است.
- **راهکار:** نوع پارامتر را به `Tx` محدود کن. در pricing، برای هر نرخ `Math.ceil((count * rate.rateMicros) / divisor)` را حساب کن و نتیجه‌ها را integer جمع بزن.
- **معیار پذیرش:** `pnpm typecheck` سبز باشد، و `pricing.test.ts` با مقادیر مرزی نتیجهٔ مستند بدهد.

```text
یافتهٔ QUA-09 — دو سخت‌سازی کوچک نوع و محاسبه را انجام بده.
مشکل: packages/core/src/acc/account.ts:51-58 تابع lockAccount پارامتر Database | Tx می‌گیرد و FOR UPDATE بیرون از تراکنش بی‌اثر است؛ packages/core/src/aip/pricing.ts:120-123 پیش از ضرب تقسیم می‌کند.
هدف: lockAccount فقط Tx بپذیرد؛ pricing برای هر نرخ Math.ceil((count * rateMicros) / divisor) حساب و integer جمع بزند.
محدودیت‌ها: اگر تغییر pricing نتیجهٔ هر آزمون موجود را تغییر داد، تفاوت را گزارش کن و پیش از ادامه تأیید بگیر (اثر مالی دارد)؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. آزمون مرزی pricing (count=1، divisor=1e6) بنویس.
معیار پذیرش: [ ] pnpm typecheck سبز [ ] pricing.test.ts و costs.int.test.ts سبز یا تفاوت مستند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### رابط کاربری — `UI`

#### UI-01 — دکمه‌های secondary و danger حالت hover و active ندارند

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/ui/styles/app.css:71-74`، `apps/web/src/ui/styles/vendor/nocturne-base.css:153-155`، `apps/web/src/app/layout.tsx:4-6`
- **شاهد:** `[data-theme] .btn-secondary { background: var(--color-surface); … }` در `app.css` با همان ویژگی (0,2,0) بعد از `.btn-secondary:hover` لایهٔ پایه می‌آید و برنده می‌شود. پس پس‌زمینه در hover و active ثابت می‌ماند. variant `danger` هم بر همین کلاس سوار است.
- **چرا مهم است:** اکثر دکمه‌های اپ secondary هستند، مثل Cancel، Reject، Edit و Back. کاربر ماوس بازخورد بصری نمی‌گیرد (اصل «visibility of system status»).
- **راهکار:** در `app.css` بعد از override، قواعد hover و active را با همان ویژگی اضافه کن. از مقادیر `color-mix` لایهٔ پایه، یعنی ۷٪ و ۱۴٪، استفاده کن تا رنگ تازه‌ای وارد نشود.
- **معیار پذیرش:** در `/dev/ui` دکمه‌های secondary و danger در تم روشن و تیره با hover و active تغییر کنند. primary و ghost بی‌تغییر بمانند.

```text
یافتهٔ UI-01 — حالت hover و active دکمه‌های secondary و danger را برگردان.
مشکل: قاعدهٔ [data-theme] .btn-secondary در apps/web/src/ui/styles/app.css:71-74 با همان ویژگی و ترتیب بعدی، :hover و :active لایهٔ پایه (apps/web/src/ui/styles/vendor/nocturne-base.css:153-155) را خنثی می‌کند.
هدف: در app.css پس از همان قاعده، [data-theme] .btn-secondary:hover و :active با color-mix(in srgb, var(--color-text) 7%/14%, var(--color-surface)) (همان درصدهای لایهٔ پایه) اضافه شوند تا رنگ تازه‌ای وارد نشود.
محدودیت‌ها: vendor CSS تغییر نکند (vendor.test.ts)؛ رنگ یا token تازه اضافه نکن؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. screenshot قبل و بعد /dev/ui در حالت hover دکمه‌های secondary و danger در تم روشن و تیره، عرض ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] hover و active در هر دو تم دیده می‌شوند [ ] primary و ghost بی‌تغییرند [ ] axe در /dev/ui سبز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن (و pnpm test:e2e برای UI)، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UI-02 — اندازه‌های فونت بیرون از مقیاس: ۱۰ و ۱۱ پیکسل زیر حداقل، و مقیاس موازی ۱۳/۱۵

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/ui/shell/AppShell.module.css:81,225`، `apps/web/src/ui/preview/AccountViews.module.css:101`، `apps/web/src/ui/styles/vendor/tokens.css:16-23`، و حدود ۳۰ فایل CSS Module دیگر
- **شاهد:**
  - `tokens.css:17` می‌گوید `--rc-text-xs: 12px; /* … min size */`.
  - `.navCaption` اندازهٔ `font-size: 11px` دارد، و در عرض تبلت `10px` با `uppercase`.
  - شمارش اندازه‌های خام در CSS Moduleها:

    | اندازه | تعداد |
    |---|---|
    | 13px | ۳۵ |
    | 15px | ۲۰ |
    | 18px | ۶ |

    در مقابل، حدود ۸۶ بار از token استفاده شده است.
- **چرا مهم است:** متن ۱۰ پیکسلی ناوبری برای کاربران کم‌بینا خوانا نیست. مقیاس موازی هم قاعدهٔ «اندازه بیرون از token اضافه نکن» را نقض می‌کند و صفحه‌ها را ناهمگون نشان می‌دهد.
- **راهکار:** ۱۰ و ۱۱ را به `var(--rc-text-xs)` برسان. ۱۳ و ۱۵ و ۱۸ را با تأیید طراح یا مالک به tokenهای موجود نگاشت کن، یا آن‌ها را یک بار در `app.css` به‌عنوان token لایهٔ بازطراحی ثبت کن.
- **معیار پذیرش:** `grep -rnE 'font-size:\s*(10|11)px' apps/web/src --include=*.css` بیرون از vendor خالی باشد. مقادیر خام باقی‌مانده مستند باشند. screenshotهای ۳۹۰ و ۱۴۴۰ با طرح بخوانند.

```text
یافتهٔ UI-02 — اندازه‌های فونت را به مقیاس token برگردان.
مشکل: apps/web/src/ui/shell/AppShell.module.css:81,225 (۱۱px و در تبلت ۱۰px برای .navCaption) و apps/web/src/ui/preview/AccountViews.module.css:101 زیر حداقل --rc-text-xs (۱۲px در apps/web/src/ui/styles/vendor/tokens.css:17) هستند؛ حدود ۶۰ مقدار خام 13/15/18px در CSS Moduleها مقیاس موازی ساخته‌اند.
هدف: (۱) 10/11px → var(--rc-text-xs)؛ برای .navCaption تبلت به‌جای کوچک‌کردن، letter-spacing را صفر یا متن را کوتاه کن؛ (۲) برای 13/15/18 جدول نگاشت به tokenهای موجود (--rc-text-xs/sm/md/read/lg) آماده کن و پیش از اعمال تأیید بگیر؛ اگر مالک محصول نگه‌داشتن 13/15 را می‌خواهد، آن‌ها را یک بار در app.css به‌عنوان token لایهٔ بازطراحی ثبت کن و ارجاع بده.
محدودیت‌ها: vendor تغییر نکند؛ اندازهٔ تازه‌ای بیرون از tokenها اضافه نکن؛ ظاهر کلی تا حد امکان ثابت بماند؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول جدول نگاشت را نشان بده و منتظر تأیید بمان. screenshot قبل و بعد پوسته، /today، /sessions/<id>، /review و /me در عرض ۳۷۵ (و ۷۶۸ برای تبلت) و ۱۴۴۰.
معیار پذیرش: [ ] grep font-size: (10|11)px بیرون از vendor خالی است [ ] مقادیر خام باقی‌مانده در یک فهرست مستند آمده‌اند [ ] pnpm test:e2e و axe سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UI-03 — دکمه‌های ضبط ۵۲ پیکسلی‌اند، نه `--rc-target-lg` (۷۲ پیکسل)

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/ui/recording/RecordingView.tsx:268-284`، `apps/web/src/ui/styles/vendor/tokens.css:32`
- **شاهد:** Stop و Pause با `Button` عمومی و `rc-btn-lg` (۵۲px) ساخته شده‌اند. `--rc-target-lg: 72px /* recording controls */` در هیچ فایل غیر vendor استفاده نشده است.
- **چرا مهم است:** در کلاس، Stop را با یک دست و بی‌نگاه می‌زنند. طرح مرجع هدف ۷۲ پیکسل را برای همین تعیین کرده است.
- **راهکار:** برای Stop، Pause و Resume در `Recording.module.css` یک کلاس با `min-block-size` و `min-inline-size` برابر `var(--rc-target-lg)` بساز. تایمر از `--rc-text-timer` استفاده کند.
- **معیار پذیرش:** دکمه‌های ضبط در ۳۹۰ پیکسل دست‌کم ۷۲ پیکسل باشند.

```text
یافتهٔ UI-03 — اندازهٔ دکمه‌های ضبط را به token طرح برسان.
مشکل: Stop/Pause/Resume در apps/web/src/ui/recording/RecordingView.tsx:268-284 با Button عمومی ۵۲px هستند و --rc-target-lg (۷۲px، apps/web/src/ui/styles/vendor/tokens.css:32، «recording controls») استفاده نشده است.
هدف: یک کلاس در apps/web/src/ui/recording/Recording.module.css با min-block-size و min-inline-size برابر var(--rc-target-lg) برای این دکمه‌ها؛ تایمر با var(--rc-text-timer) اگر هنوز نیست.
محدودیت‌ها: فقط token موجود؛ رفتار ضبط (PRD-REC-02) تغییر نکند؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. screenshot قبل و بعد صفحهٔ ضبط در ۳۷۵ و ۱۴۴۰ و مقایسه با قاب .dc.html طرح.
معیار پذیرش: [ ] اندازهٔ دکمه‌ها دست‌کم ۷۲px در ۳۹۰px [ ] recording.spec و recording-capture.spec سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UI-04 — انحراف از token: سایه و رنگ خام، خواص فیزیکی، حلقهٔ focus ناهمسان و breakpointهای پراکنده

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/ui/workspace/NoteView.module.css:243`، `apps/web/src/ui/recording/Recording.module.css:10`، `apps/web/src/ui/components/Sheet.module.css:119`، `apps/web/src/ui/components/LegalDocument.module.css:37`، `apps/web/src/ui/preview/preview.css:294,302-305`، `apps/web/src/ui/styles/vendor/tokens.css:144`، `apps/web/src/ui/shell/AppShell.module.css:178-246`
- **شاهد:**
  - `box-shadow: 0 12px 36px rgb(0 0 0 / 10%)` به‌جای `--shadow-md` آمده است.
  - `padding-left: 20px` برای فهرست‌های متن حقوقی آمده است.
  - حلقهٔ focus در پایه `2px` است و در لایهٔ «preview-root» که کل اپ را می‌پوشاند `3px`.
  - ۱۸ الگوی `@media` مختلف هست، در برابر سه نقطهٔ پوسته.
- **چرا مهم است:** سایهٔ سیاه ثابت در تم تیره با سایه‌های تم‌دار نمی‌خواند. فهرست‌های داخل متن RTL تورفتگی سمت اشتباه می‌گیرند. ناهمسانی، نگهداری را کند می‌کند.
- **راهکار:**
  - به‌جای سایهٔ خام، `var(--shadow-md|lg)` بگذار.
  - به‌جای `padding-left`، `padding-inline-start` بگذار.
  - یک حلقهٔ focus واحد از token بساز.
  - breakpointها را به نقاط پوسته محدود کن، مگر استثنای مستند.
- **معیار پذیرش:** `grep -rn 'rgb(0 0 0\|padding-left\|margin-left' apps/web/src --include=*.css` بیرون از vendor و ایمیل ادمین خالی باشد. screenshotها بی‌تغییر بمانند.

```text
یافتهٔ UI-04 — انحراف‌های کوچک از token و logical properties را اصلاح کن.
مشکل: سایه‌های خام rgb(0 0 0 / …) در apps/web/src/ui/workspace/NoteView.module.css:243، apps/web/src/ui/recording/Recording.module.css:10 و apps/web/src/ui/preview/LearningViews.module.css:169؛ padding-left در apps/web/src/ui/components/Sheet.module.css:119 و LegalDocument.module.css:37؛ حلقهٔ focus 3px در apps/web/src/ui/preview/preview.css:302-305 در برابر 2px پایه (tokens.css:144)؛ ۱۸ الگوی @media.
هدف: var(--shadow-md|lg) به‌جای سایهٔ خام؛ padding-inline-start/margin-inline-start به‌جای left؛ یک حلقهٔ focus (همان پایه) در کل اپ؛ breakpointها فقط 767/768/1023/1024 پوسته، مگر استثنای مستند در کامنت.
محدودیت‌ها: رنگ، اندازه یا سایهٔ تازه اضافه نکن؛ vendor تغییر نکند؛ قالب‌های ایمیل ادمین و recovery.module.css (عمداً مستقل) را دست نزن؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول فهرست تغییرات را بگو و منتظر تأیید بمان. screenshot قبل و بعد صفحه‌های متأثر در ۳۷۵ و ۱۴۴۰، تم روشن و تیره، و یک متن RTL در Sheet.
معیار پذیرش: [ ] grep بالا خالی است [ ] screenshotها جز موارد هدف یکسان‌اند [ ] pnpm test:e2e و axe سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UI-05 — دکمه‌های حذف ظاهر primary دارند؛ variant `danger` استفاده نشده

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/ui/workspace/ClassForm.tsx:286-290`، `apps/web/src/ui/workspace/PrivacyView.tsx:258-260`، `apps/web/src/ui/workspace/CourseManager.tsx:292-298`، `apps/web/src/ui/components/Button.tsx:14`
- **شاهد:** در Sheet «Delete this session?»، دکمهٔ «Delete session» primary سبز است، همان رنگ «Continue» و «Record». `danger: "btn-secondary rc-btn-danger"` فقط در `/dev/ui` استفاده شده است.
- **چرا مهم است:** دکمهٔ حذف شبیه CTA مثبت است، و حذف عجولانهٔ جلسه، واحد یا حساب محتمل‌تر می‌شود.
- **راهکار:** همهٔ دکمه‌های تأیید حذف از `variant="danger"` استفاده کنند، طبق `components.md` طرح.
- **معیار پذیرش:** هیچ دکمهٔ حذفی کلاس `btn-primary` نداشته باشد، و آزمون واحد variant را بسنجد.

```text
یافتهٔ UI-05 — دکمه‌های تأیید حذف را با variant danger نمایش بده.
مشکل: دکمه‌های Delete session/unit/account در apps/web/src/ui/workspace/ClassForm.tsx:286-290، CourseManager.tsx:292-298 و PrivacyView.tsx:258-260 primary هستند؛ variant danger (apps/web/src/ui/components/Button.tsx:14) فقط در /dev/ui استفاده شده است.
هدف: همهٔ دکمه‌های تأیید حذف variant="danger" بگیرند، مطابق docs/design/handoff-r1 (components.md).
محدودیت‌ها: متن دکمه‌ها تغییر نکند؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول فهرست دکمه‌ها را بگو و منتظر تأیید بمان. screenshot قبل و بعد Sheetهای حذف در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] هیچ دکمهٔ حذف btn-primary ندارد [ ] axe و e2e مربوط سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UI-06 — گزینهٔ SegmentedControl در اندازهٔ کوچک ۴۰ پیکسل است

- **سطح:** Info | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/ui/components/SegmentedControl.module.css:22-25`
- **شاهد:** `.small .option { min-height: 40px; }` زیر `--rc-target` (۴۴px) است. اندازهٔ `sm` بیرون از `/dev` استفاده نشده است.
- **راهکار:** گزینه از `min-height: var(--rc-target)` استفاده کند.
- **معیار پذیرش:** ارتفاع گزینه دست‌کم ۴۴ پیکسل باشد.

```text
یافتهٔ UI-06 — حداقل اندازهٔ لمسی SegmentedControl کوچک را به token برسان.
مشکل: apps/web/src/ui/components/SegmentedControl.module.css:22-25 برای .small .option min-height: 40px دارد، زیر --rc-target (۴۴px).
هدف: min-height: var(--rc-target) برای گزینه‌ها.
محدودیت‌ها: کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. screenshot /dev/ui قبل و بعد در ۳۷۵.
معیار پذیرش: [ ] ارتفاع گزینه ≥ ۴۴px [ ] /dev/ui و axe سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```
### تجربهٔ کاربری — `UX`

#### UX-01 — متن کهنهٔ «coming next in the pilot» روی صفحهٔ ورود

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/app/SignIn.tsx:54-57`، `apps/web/src/ui/experience-copy.ts:13`، `apps/web/src/ui/study-copy.ts:11,45,51`
- **شاهد:** `pilotNote: "Class capture, notes and reviews are coming next in the pilot."` روی `/` رندر می‌شود، در حالی که ضبط، جزوه و مرور ساخته شده‌اند. سه متن مشابه در `study-copy.ts` فقط در `StudyOverview` مصرف می‌شوند که در production استفاده نشده است.
- **چرا مهم است:** اولین جمله‌ای که هر شرکت‌کنندهٔ پایلوت می‌خواند، می‌گوید قابلیت اصلی هنوز نیست. این انتظار و اعتماد را از همان ابتدا غلط شکل می‌دهد (Nielsen: تطابق سیستم با واقعیت).
- **راهکار:** `pilotNote` را حذف یا با متن تأییدشدهٔ مالک جایگزین کن و آن را در `UI_COPY_PENDING.md` ثبت کن. متن‌های مردهٔ `study-copy` را حذف کن.
- **معیار پذیرش:** grep برای «coming next» در `ui/` و `app/` بیرون از preview خالی باشد، و `signin.spec` متن تازه را بسنجد.

```text
یافتهٔ UX-01 — متن کهنهٔ «coming next in the pilot» را از صفحهٔ ورود بردار.
مشکل: apps/web/src/app/SignIn.tsx:54-57 متن experienceCopy.pilotNote («Class capture, notes and reviews are coming next in the pilot.»، apps/web/src/ui/experience-copy.ts:13) را نشان می‌دهد در حالی که این قابلیت‌ها ساخته شده‌اند؛ apps/web/src/ui/study-copy.ts:11,45,51 متن‌های مشابه بی‌مصرف دارد.
هدف: pilotNote حذف شود یا با متنی که مالک محصول تأیید کرده جایگزین شود (اگر متن تأییدشده‌ای نیست، حذف کن و پیشنهاد متن را در docs/design/UI_COPY_PENDING.md ثبت کن)؛ متن‌های مردهٔ study-copy و StudyOverview بی‌مصرف حذف شوند اگر جز /dev و /preview مصرفی ندارند.
محدودیت‌ها: متن تازه از خودت روی رابط نگذار؛ قاعدهٔ «متن رابط کلمه‌به‌کلمه از handoff copy.md» و آزمون strings.test.ts رعایت شود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. screenshot قبل و بعد / در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] grep "coming next" در apps/web/src بیرون از preview خالی است [ ] signin.spec و strings.test.ts سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن (و pnpm test:e2e)، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-02 — صفحهٔ ضبط داخل پوستهٔ اپ و با ناوبری است، برخلاف طرح «full-screen focus mode»

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/app/(app)/sessions/[id]/record/page.tsx:8-16`، `docs/design/handoff-r1/HANDOFF.md:59`، `apps/web/src/ui/shell/AppShell.tsx:37`
- **شاهد:** صفحه به این شکل است: `<LearnerShell … header={<PageHeader title="Record a session" …/>}><RecordingView …/></LearnerShell>`. HANDOFF می‌گوید «Recording = full-screen focus mode, no nav.» و توضیح خود AppShell می‌گوید «Recording screens use no shell.»
- **چرا مهم است:** در کلاس، چهار لینک ناوبری و «New session» در دسترس است. یک لمس اشتباه روی موبایل کاربر را از صفحهٔ ضبط بیرون می‌برد. ضبط ادامه دارد، ولی تایمر و دکمهٔ Stop از دید می‌روند.
- **راهکار:** `RecordingView` را بدون AppShell رندر کن، یا ناوبری را هنگام ضبط فعال پنهان کن. پس از Stop هم یک دکمهٔ بازگشت صریح بگذار.
- **معیار پذیرش:** در ۳۹۰ پیکسل هنگام ضبط، bottom nav و «New session» نباشند و «Stop and save» همیشه در viewport باشد. `recording.spec` این را بسنجد.

```text
یافتهٔ UX-02 — صفحهٔ ضبط را مطابق طرح به حالت تمرکز تمام‌صفحه ببر.
مشکل: apps/web/src/app/(app)/sessions/[id]/record/page.tsx:8-16 RecordingView را داخل LearnerShell با ناوبری کامل رندر می‌کند؛ docs/design/handoff-r1/HANDOFF.md:59 «Recording = full-screen focus mode, no nav» و کامنت apps/web/src/ui/shell/AppShell.tsx:37 «Recording screens use no shell» می‌گویند.
هدف: هنگام ضبط فعال (و paused) هیچ ناوبری پوسته نمایش داده نشود؛ Stop and save همیشه در viewport باشد؛ پس از Stop یک بازگشت صریح (کامپوننت موجود) باشد؛ ساختار با قاب .dc.html صفحهٔ ضبط در docs/design/handoff-r1 بخواند.
محدودیت‌ها: PRD-REC-02 (هیچ قطع، پنجره یا هشدار حین ضبط) و منطق controller تغییر نکند؛ فقط کامپوننت‌ها و tokenهای موجود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر. HANDOFF.md بخش ۰ و docs/design/HANDOFF_R1_REVIEW.md را پیش از شروع بخوان.
روش: اول برنامه را بگو و منتظر تأیید بمان. screenshot قبل و بعد صفحهٔ ضبط (آماده، در حال ضبط، paused، saved) در ۳۷۵ و ۱۴۴۰ کنار قاب طرح.
معیار پذیرش: [ ] هنگام ضبط bottom nav، sidebar و New session نیستند [ ] Stop and save در ۳۹۰×۶۶۴ بدون اسکرول دیده می‌شود [ ] recording.spec و recording-capture.spec سبزند و حالت تازه را می‌سنجند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-03 — حذف و رد کارت یک‌ضربه‌ای، بی‌تأیید و بی‌Undo

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/ui/workspace/CardEditor.tsx:186-195`، `apps/web/src/ui/workspace/CardsView.tsx:137-146`، `apps/web/src/ui/components/Snackbar.tsx:60-62`
- **شاهد:**
  - «Delete card» داخل یک `<details>` است. با یک کلیک، کارت از همهٔ جلسه‌ها و مرور حذف می‌شود.
  - «Reject» در فهرست، `POST /api/cards/{id}/actions` را فوری می‌فرستد و فقط فهرست را به‌روز می‌کند، بی‌پیام و بی‌Undo.
  - حذف جلسه، واحد و حساب Sheet تأیید دارند.
  - Snackbar با Undo فقط در `/dev` و `/preview` استفاده شده است.
- **چرا مهم است:** در مسیر کارت‌ها، یک لمس اشتباه کارت و تاریخچهٔ مرورش را از بین می‌برد. «Undo last card change» حذف را برنمی‌گرداند (Nielsen: پیشگیری از خطا، کنترل و آزادی کاربر).
- **راهکار:**
  - برای حذف کارت، همان الگوی Sheet تأیید را به کار ببر.
  - برای Reject، Snackbar موجود با Undo چندثانیه‌ای بگذار. اقدام idempotent است.
- **معیار پذیرش:** حذف کارت دو مرحله‌ای شود. Reject قابل بازگشت باشد. آزمون‌ها لغو و Undo را بسنجند.

```text
یافتهٔ UX-03 — برای حذف و رد کارت تأیید یا Undo اضافه کن.
مشکل: «Delete card» در apps/web/src/ui/workspace/CardEditor.tsx:186-195 یک‌کلیکی است و «Reject» در apps/web/src/ui/workspace/CardsView.tsx:137-146 بی‌پیام و بی‌Undo اجرا می‌شود؛ حذف جلسه/واحد/حساب Sheet تأیید دارند و Snackbar با Undo (apps/web/src/ui/components/Snackbar.tsx) در production استفاده نشده است.
هدف: حذف کارت با همان الگوی Sheet تأیید (مثل ClassForm.tsx:272-292) و دکمهٔ variant danger؛ Reject با Snackbar موجود و دکمهٔ Undo که اقدام معکوس idempotent را صدا بزند (اگر API معکوس نیست، اول بپرس).
محدودیت‌ها: فقط کامپوننت‌ها و متن‌های موجود در handoff copy.md یا ثبت‌شده در UI_COPY_PENDING؛ رفتار سرور تغییر نکند مگر پس از تأیید؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون واحد CardEditor (لغو حذف) و CardsView (Undo رد) بنویس. screenshot قبل و بعد در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] حذف کارت بدون تأیید انجام نمی‌شود [ ] Reject در چند ثانیهٔ نخست قابل بازگشت است [ ] study.spec و reference-study.spec سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-04 — پیام خام استثنا و شبکه به زبان‌آموز نمایش داده می‌شود

- **سطح:** Medium | **اطمینان:** متوسط | **تلاش:** M
- **محل:** `apps/web/src/ui/workspace/api.ts:53-66`، `apps/web/src/ui/workspace/ClassForm.tsx:72,103,125`، `CardsView.tsx:73`، `ReviewSettings.tsx:24`، `CardMedia.tsx:90,116`، `ReviewView.tsx:187`، `AutomaticLearningView.tsx:135`، `apps/web/src/ui/workspace/upload-problems.ts:57-58`
- **شاهد:**
  - `workspaceRequest` خطای `fetch` را نمی‌گیرد.
  - حدود ۳۵ محل `failure instanceof Error ? failure.message : "…"` دارند. پس هنگام قطع شبکه، «Failed to fetch» نمایش داده می‌شود.
  - پیام `idempotency_mismatch` («…with the same key») از مسیر آپلود به کاربر می‌رسد.
- **چرا مهم است:** زبان‌آموز غیرفنی هنگام ساخت جلسه، ذخیرهٔ کارت یا تنظیم مرور پیامی می‌بیند که نه می‌فهمد و نه گام بعدی دارد (Nielsen: پیام خطای قابل‌فهم و راه‌حل).
- **راهکار:**
  - در `workspaceRequest`، خطای شبکه را به `accountCopy.error.connection` نگاشت کن.
  - کدهای خطای سرور را به متن انسانی ترجمه کن.
  - به‌جای `failure.message`، یک تابع `userMessage(failure)` بساز.
- **معیار پذیرش:** شبیه‌سازی offline در Playwright پیام اتصال را نشان دهد، نه «Failed to fetch». هیچ متن کاربری شامل «key» یا «idempotency» نباشد.

```text
یافتهٔ UX-04 — پیام‌های خطای خام را به متن انسانی با گام بعدی تبدیل کن.
مشکل: apps/web/src/ui/workspace/api.ts:53-66 (workspaceRequest) خطای شبکه را نمی‌گیرد و حدود ۳۵ محل در apps/web/src/ui/workspace با failure.message متن خام (مثل «Failed to fetch» یا پیام idempotency) را نشان می‌دهند؛ apps/web/src/ui/workspace/upload-problems.ts:57-58 هم پیام سرور را عبور می‌دهد.
هدف: یک تابع userMessage(failure) در apps/web/src/ui/workspace که خطای شبکه را به accountCopy.error.connection و کدهای شناخته‌شدهٔ سرور را به متن‌های موجود نگاشت کند و برای ناشناخته یک متن عمومی موجود بدهد؛ همهٔ محل‌های failure.message از آن استفاده کنند.
محدودیت‌ها: فقط متن‌های موجود در strings/copy یا ثبت‌شده در UI_COPY_PENDING؛ رفتار retry و وضعیت‌ها تغییر نکند؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول فهرست محل‌ها و جدول نگاشت کد → متن را نشان بده و منتظر تأیید بمان. آزمون واحد برای userMessage و یک آزمون Playwright با page.context().setOffline(true).
معیار پذیرش: [ ] offline پیام اتصال نشان می‌دهد [ ] grep -rn "failure.message\|error.message" در apps/web/src/ui (بیرون از admin و dev) خالی یا مستند است [ ] e2e سبز است.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-05 — اصطلاحات داخلی و enumهای خام در رابط زبان‌آموز

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/ui/workspace/CardsView.tsx:107-111,129-131`، `apps/web/src/ui/workspace/ReviewView.tsx:110,210-213,243-248`، `apps/web/src/ui/workspace/PrivacyView.tsx:111-112`، `apps/web/src/ui/workspace/session-state.ts:403-407`، `apps/web/src/ui/workspace/api.ts:114-115`
- **شاهد:**
  - `{card.status} · {card.direction} · {card.template}` به شکل «candidate · forward · basic» نمایش داده می‌شود.
  - `… · {queue.timezone}` به شکل «Europe/London» نمایش داده می‌شود.
  - «Core · production» و «Supplementary · recognition» نمایش داده می‌شوند.
  - پیام‌های «Server cleanup has been queued.»، «View processing review» و «A provider result is still being checked.» هم به کاربر می‌رسند.
- **چرا مهم است:** زبان‌آموز سطح ESOL با واژه‌های فنی مواجه می‌شود که برای او معنایی ندارند. این بار شناختی مسیر کارت و مرور را بالا می‌برد.
- **راهکار:**
  - برچسب انسانی بگذار یا خط را حذف کن.
  - از «Core cards» و «Extra cards» استفاده کن، که در `learning-memory-copy` هستند.
  - نام شهر را به‌جای IANA نمایش بده.
  - متن‌های PrivacyView و processing را بازنویسی کن، با تأیید مالک.
- **معیار پذیرش:** هیچ متن رابط زبان‌آموز مقدار خام `status`، `direction`، `template`، timezone یا واژه‌های provider، queued و server cleanup نداشته باشد.

```text
یافتهٔ UX-05 — enumهای خام و اصطلاحات داخلی را از رابط زبان‌آموز بردار.
مشکل: apps/web/src/ui/workspace/CardsView.tsx:129-131 «{status} · {direction} · {template}» و ReviewView.tsx:210-213 نام IANA منطقهٔ زمانی را نشان می‌دهند؛ ReviewView.tsx:243-248 «Core · production»؛ PrivacyView.tsx:111-112 «Server cleanup has been queued.»؛ session-state.ts:403-407 و api.ts:114-115 واژه‌های processing review و provider دارند.
هدف: برچسب‌های انسانی از copy موجود (مثل setProduction/setRecognition در learning-memory-copy، نام شهر مثل ProfileSettings) یا حذف خط؛ متن‌های تازه فقط پس از تأیید مالک محصول و ثبت در docs/design/UI_COPY_PENDING.md.
محدودیت‌ها: قاعدهٔ متن رابط کلمه‌به‌کلمه از handoff copy.md و آزمون strings.test.ts؛ هیچ متن تازه‌ای بدون تأیید روی رابط نرود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول جدول «محل، متن فعلی، متن پیشنهادی، منشأ متن» را نشان بده و منتظر تأیید بمان. screenshot قبل و بعد /sessions/<id>/cards و /review در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] grep enumهای خام و واژه‌های provider|queued|server cleanup|processing review در apps/web/src/ui بیرون از admin خالی است [ ] strings.test.ts و e2e سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-06 — نام‌گذاری ناوبری و اصطلاحات ناسازگار: Courses، session، class، lesson و material

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** M
- **محل:** `apps/web/src/app/(app)/LearnerShell.tsx:51-56`، `apps/web/src/app/(app)/sessions/page.tsx:74`، `apps/web/src/app/(app)/me/ProfileSettings.tsx:92-97`، `apps/web/src/app/(app)/courses/page.tsx:26-31`، `apps/web/src/ui/workspace/ClassDirectory.tsx:252-254`، `apps/web/src/app/(app)/me/quota/page.tsx:313`، `apps/web/src/app/(app)/sessions/organize/page.tsx:616-619`، `apps/web/src/app/(app)/sessions/[id]/options/page.tsx:478-482`، `apps/web/src/ui/allowance-copy.ts:9,16`، `apps/web/src/ui/voice/voice-copy.ts:65-72`
- **شاهد:**
  - تب «Courses» به `/sessions` می‌رود و صفحه «No sessions yet» می‌گوید. سطر «Courses» در `/me` به `/courses` با عنوان «Manage courses» می‌رود.
  - دو لینک «View courses» به دو مقصد مختلف می‌روند.
  - دو صفحهٔ مختلف عنوان یکسان «Keep your sessions organised» دارند.
  - «this class needs more allowance» کنار «Delete session» آمده است.
  - شمارش در متن‌های کاربری:

    | واژه | تعداد |
    |---|---|
    | class | ۶۴ |
    | session | ۸۸ |
    | lesson | ۲۴ |
    | material | ۴۳ |
    | source | ۳۲ |
- **چرا مهم است:** زبان‌آموز باید خودش بفهمد class، session و lesson یک چیزند، و material و sources هم یک چیز. در مسیر پردازش گم می‌شود (Nielsen: consistency and standards).
- **راهکار:** تصمیم ۷. یک واژه‌نامهٔ کوتاه با تصویب مالک بساز، پیشنهاد session، course و material. بعد آن را یکدست در copy و عنوان‌ها اعمال کن. برچسب لینکی که به `/courses` می‌رود «Manage courses» شود.
- **معیار پذیرش:**
  - هر برچسب به `/courses` «Manage courses» باشد.
  - هیچ دو صفحه‌ای PageHeader یکسان نداشته باشند.
  - «class» فقط برای کلاس درس واقعی بماند.

```text
یافتهٔ UX-06 — نام‌گذاری ناوبری و اصطلاحات را مطابق واژه‌نامهٔ مصوب یکدست کن.
مشکل: تب Courses به /sessions می‌رود ولی سطر Courses در /me به /courses (Manage courses)؛ دو «View courses» به دو مقصد؛ دو صفحه با عنوان «Keep your sessions organised» (apps/web/src/app/(app)/sessions/organize/page.tsx:616-619 و sessions/[id]/options/page.tsx:478-482)؛ class/session/lesson و material/sources به‌جای هم (apps/web/src/ui/allowance-copy.ts:9,16، apps/web/src/ui/voice/voice-copy.ts:65-72 و دیگر copyها).
هدف: اگر مالک محصول واژه‌نامه را تصویب کرده (تصمیم ۷ گزارش ممیزی؛ پیشنهاد: session برای جلسه، course برای درس، material برای همهٔ فایل‌ها)، همان را اعمال کن؛ مستقل از آن: هر لینک به /courses برچسب «Manage courses»، عنوان صفحهٔ options برابر برچسب لینکش («Session options»)، و «← Back to courses» به مقصد واقعی.
محدودیت‌ها: واژه‌نامه را خودت تصویب نکن؛ اگر تصمیم ثبت نشده، فقط بخش «مستقل» را انجام بده و برای بقیه جدول پیشنهادی در docs/design/UI_COPY_PENDING.md بنویس؛ strings.test.ts و منشأ متن‌ها رعایت شود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول جدول تغییرات را نشان بده و منتظر تأیید بمان. screenshot قبل و بعد صفحه‌های متأثر در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] هیچ دو صفحه PageHeader یکسان ندارند (آزمون) [ ] برچسب‌های /courses یکسان‌اند [ ] e2e session-navigation و course-materials سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-07 — Terms و Privacy Notice پس از ورود در دسترس نیستند

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/app/page.tsx:22-30`، `apps/web/src/app/(app)/LearnerShell.tsx:54-63`، `apps/web/src/app/(app)/me/ProfileSettings.tsx:66-93`
- **شاهد:** `LegalDocument` فقط در Sheet صفحهٔ ورود و در `TermsNotice` رندر می‌شود، و `TermsNotice` فقط وقتی نسخهٔ تازه منتظر پذیرش است ظاهر می‌شود. ردیف‌های `/me` ورودی‌ای برای Terms یا Privacy ندارند و مسیر `/terms` یا `/privacy` هم وجود ندارد.
- **چرا مهم است:** زبان‌آموزِ واردشده نمی‌تواند Privacy Notice را دوباره بخواند، در حالی که این نیاز حقوقی پایه است. پیوند دادن متن حقوقی از ایمیل پشتیبانی هم ممکن نیست.
- **راهکار:** در `/me` ردیف «Terms and Privacy Notice» اضافه کن که همان `Sheet variant="reading"` را باز کند. عنوان در `account-copy.ts` به‌عنوان `legal.title` هست.
- **معیار پذیرش:** از `/me` هر دو متن باز شوند، و `account.spec` این مسیر را بسنجد.

```text
یافتهٔ UX-07 — دسترسی به Terms و Privacy Notice را پس از ورود فراهم کن.
مشکل: LegalDocument فقط در صفحهٔ ورود (apps/web/src/app/page.tsx:22-30) و در TermsNotice هنگام pending.terms (apps/web/src/app/(app)/LearnerShell.tsx:54-63) رندر می‌شود؛ apps/web/src/app/(app)/me/ProfileSettings.tsx:66-93 ردیفی برای آن ندارد.
هدف: ردیفی در /me با عنوان موجود account-copy.ts (legal.title) که Sheet variant="reading" با LegalDocument نسخهٔ فعلی Terms و Privacy را باز کند.
محدودیت‌ها: فقط کامپوننت‌ها و متن‌های موجود؛ متن حقوقی تغییر نکند؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر. اگر قاب طرح /me ردیف مشابه ندارد، پیش از ساخت بپرس (قاعدهٔ CLAUDE.md).
روش: اول برنامه را بگو و منتظر تأیید بمان. screenshot قبل و بعد /me و Sheet باز در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] از /me هر دو متن باز و قابل بستن‌اند [ ] account.spec و axe سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-08 — هر ناوبری کل صفحه و منو را با loading تمام‌صفحه جایگزین می‌کند

- **سطح:** Medium | **اطمینان:** متوسط | **تلاش:** M
- **محل:** `apps/web/src/app/loading.tsx:1-20`، `apps/web/src/app/(app)/layout.tsx:11-29`، `apps/web/src/app/(app)/LearnerShell.tsx:40-50`
- **شاهد:** پوسته در هر صفحه از طریق `LearnerShell` رندر می‌شود، نه در `(app)/layout.tsx`. تنها `loading.tsx` در ریشه است. پس در جابه‌جایی بین Today، Courses، Review و Me، مرز loading ریشه ناوبری را برمی‌دارد و «Loading your learning space…» را نشان می‌دهد.
- **چرا مهم است:** روی موبایل با شبکهٔ ضعیف، منوی پایین با هر لمس «می‌پرد» و کاربر حس از دست دادن جایگاه دارد.
- **راهکار:** AppShell را به `(app)/layout.tsx` منتقل کن، با `current` از segment. یا یک `loading.tsx` در `(app)/` بگذار که پوسته را نگه دارد و فقط محتوا را skeleton کند.
- **معیار پذیرش:** در شبیه‌سازی شبکهٔ کند، منو ثابت بماند و axe روی حالت loading سبز باشد.

```text
یافتهٔ UX-08 — پوستهٔ اپ را هنگام ناوبری ثابت نگه دار.
مشکل: پوسته در هر صفحه از LearnerShell (apps/web/src/app/(app)/LearnerShell.tsx:40-50) رندر می‌شود و تنها loading.tsx در apps/web/src/app/ است؛ هر ناوبری بین تب‌ها کل صفحه و منو را با loading تمام‌صفحه جایگزین می‌کند.
هدف: یا AppShell به apps/web/src/app/(app)/layout.tsx منتقل شود (current از segment فعال) یا loading.tsx در (app)/ فقط ناحیهٔ محتوا را با کامپوننت‌های موجود skeleton کند و پوسته بماند؛ گزینهٔ کم‌تغییرتر را پیشنهاد بده.
محدودیت‌ها: مستندات Next نصب‌شده در node_modules/next/dist/docs را دربارهٔ layout و loading بخوان (apps/web/AGENTS.md)؛ redirectهای requireLearner رفتارشان تغییر نکند؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول دو گزینه و پیشنهادت را بگو و منتظر تأیید بمان. آزمون Playwright با شبکهٔ کند (route با تأخیر) که ثبات nav را بسنجد؛ screenshot قبل و بعد در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] هنگام ناوبری bottom nav و sidebar ثابت می‌مانند [ ] shell.spec و redesign.spec سبزند [ ] axe روی حالت loading سبز است.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-09 — اقدام «Review account setup» برای پذیرش Terms تازه به حلقه می‌افتد

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `packages/core/src/proc/runs.ts:350-351`، `apps/web/src/ui/workspace/session-state.ts:402`، `apps/web/src/ui/workspace/AutomaticLearningView.tsx:62`، `apps/web/src/ui/workspace/learning-progress.ts:251`، `apps/web/src/app/setup/page.tsx:19`
- **شاهد:** زنجیرهٔ زیر رخ می‌دهد:
  1. `runs.ts` اگر `pending.terms` باشد، `acceptance_required` می‌دهد.
  2. `session-state.ts:402` برای این خطا دکمهٔ `{ label: "Review account setup", href: "/setup" }` می‌سازد.
  3. `setup/page.tsx:19` هم می‌گوید `if (learner.state.setupComplete) redirect("/today")`.
- **چرا مهم است:** وقتی نسخهٔ تازهٔ Terms منتشر شود، پردازش جلسه‌های کاربرِ قدیمی متوقف می‌شود. تنها دکمهٔ راهنما هم او را به Today برمی‌گرداند، بی‌آنکه بگوید چه باید بکند.
- **راهکار:** برای `pending.terms`، برچسب «Accept the updated Terms» بگذار که Sheet پذیرش (`TermsNotice`) را باز کند. `/setup` را فقط برای `setupComplete=false` نگه دار.
- **معیار پذیرش:** با `pending.terms=true`، دکمه Sheet پذیرش را باز کند. با `setupComplete=false` به `/setup` برود. `session-state.test.ts` هر دو حالت را بسنجد.

```text
یافتهٔ UX-09 — مسیر پذیرش Terms تازه را از کارت «Next step» درست کن.
مشکل: وقتی packages/core/src/proc/runs.ts:350-351 خطای acceptance_required می‌دهد، apps/web/src/ui/workspace/session-state.ts:402 دکمهٔ «Review account setup» به /setup می‌سازد و apps/web/src/app/setup/page.tsx:19 کاربر setupComplete را فوراً به /today برمی‌گرداند.
هدف: اگر pending.terms است، کارت Next step و AutomaticLearningView (apps/web/src/ui/workspace/AutomaticLearningView.tsx:62) اقدامی نشان دهند که Sheet پذیرش TermsNotice را باز کند (مثلاً /me?accept=terms یا رویداد مستقیم)؛ /setup فقط برای setupComplete=false بماند؛ متن learning-progress.ts:251 هم‌خوان شود.
محدودیت‌ها: متن دکمهٔ تازه باید از copy موجود یا تأییدشده باشد (در غیر این صورت پیشنهاد را در UI_COPY_PENDING ثبت کن و بپرس)؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون session-state.test.ts برای دو حالت بنویس.
معیار پذیرش: [ ] با pending.terms=true دکمه Sheet پذیرش را باز می‌کند [ ] با setupComplete=false به /setup می‌رود [ ] setup.spec و automatic-learning.spec سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-10 — پس از حذف حساب، «Return to Recalino» گاهی پنل «Finish account deletion» را نشان می‌دهد

- **سطح:** Low | **اطمینان:** متوسط | **تلاش:** S
- **محل:** `apps/web/src/ui/workspace/PrivacyView.tsx:137-157`، `apps/web/src/app/page.tsx:21`، `apps/web/src/server/auth/learner.ts:27-44`، `apps/web/src/app/deletion/page.tsx`
- **شاهد:** تا وقتی job پاک‌سازی نشست را نبسته یا درخواست را `completed` نکرده، `/` به `/deletion` می‌رود. آنجا پیام «Confirm the request to finish deletion on this browser» و دکمهٔ «Finish deletion» نمایش داده می‌شود و Sign out نیست. دو منتقد مستقل سطح را از High به Low رساندند. دلیلشان این بود که job با `after()` بلافاصله اجرا می‌شود و گام `revoke_auth` ظرف ثانیه‌ها تا حداکثر حدود ۵ دقیقه نشست را می‌بندد.
- **چرا مهم است:** در همان پنجرهٔ کوتاه، کاربر فکر می‌کند حذف ناتمام است. اگر درخواست به `needs_operator` بیفتد، این پیام ماندگار می‌شود.
- **راهکار:** در `pendingAccountDeletion`، رسیدی را که journal آن ذخیره شده «در حال انجام» بشمار، نه «نیازمند تأیید». در `/deletion` برای این حالت متن «در حال انجام» و دکمهٔ Sign out نشان بده.
- **معیار پذیرش:** پس از حذف موفق، «Finish deletion» دیده نشود. `/deletion` دکمهٔ Sign out داشته باشد. سناریوی شکست ذخیرهٔ journal همچنان «Finish deletion» را نشان دهد.

```text
یافتهٔ UX-10 — پیام صفحهٔ /deletion را برای حذفِ ثبت‌شده و در حال انجام اصلاح کن.
مشکل: تا پایان job پاک‌سازی، / به /deletion می‌رود و apps/web/src/ui/workspace/PrivacyView.tsx:140-157 برای initialPending پیام «Confirm the request to finish deletion» و دکمهٔ Finish deletion نشان می‌دهد؛ /deletion (apps/web/src/app/deletion/page.tsx) Sign out ندارد؛ apps/web/src/server/auth/learner.ts:27-44 هر رسید غیر completed را pending می‌شمارد.
هدف: اگر journal رسید ذخیره شده و پاک‌سازی در صف یا در حال اجراست، /deletion متن «در حال انجام» از copy موجود یا تأییدشده و یک دکمهٔ Sign out نشان دهد؛ فقط وقتی journal ذخیره نشده، Finish deletion بماند؛ وضعیت needs_operator متن راهنمای تماس با اپراتور داشته باشد.
محدودیت‌ها: منطق حذف و ترتیب گام‌های priv.cleanup تغییر نکند؛ متن تازه فقط پس از تأیید؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون واحد pendingAccountDeletion برای سه حالت (journal ناموجود، journal موجود و pending، needs_operator).
معیار پذیرش: [ ] سه حالت پیام درست دارند [ ] Sign out در /deletion کار می‌کند [ ] learning-privacy.spec و deletion-recovery.int.test.ts سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-11 — نویز فنی و `role="alert"` حین ضبط

- **سطح:** Low | **اطمینان:** متوسط | **تلاش:** S
- **محل:** `apps/web/src/ui/recording/RecordingView.tsx:341-366`
- **شاهد:**
  - حین ضبط، پنل «Adding recorded parts to your session» با `role={syncState.phase === "failed" ? "alert" : "status"}` و دکمهٔ «Retry adding session sources» ظاهر می‌شود.
  - فهرست «Saved and recoverable recordings» تاریخ را با `toLocaleString()` خام و اندازه را به KB نشان می‌دهد.
- **چرا مهم است:** PRD-REC-02 پیام‌ها را به بعد از Stop محدود می‌کند. شکست همگام‌سازی آپلود، خرابی ضبط نیست، و alert در میانهٔ کلاس کاربر را مضطرب می‌کند. KB هم برای زبان‌آموز بی‌معناست.
- **راهکار:** خطای sync را تا بعد از Stop صف کن، چون ضبط روی دستگاه امن است. به‌جای KB مدت نشان بده، و تاریخ را با `Intl.DateTimeFormat` کوتاه کن.
- **معیار پذیرش:** حین ضبط فعال، هیچ `role="alert"` جز خطای واقعی ضبط رندر نشود. `recording.spec` این را بسنجد.

```text
یافتهٔ UX-11 — پیام‌های همگام‌سازی و جزئیات فنی را از صفحهٔ ضبطِ فعال بردار.
مشکل: apps/web/src/ui/recording/RecordingView.tsx:341-366 حین ضبط پنل همگام‌سازی با role="alert" در حالت failed و فهرست ضبط‌ها با toLocaleString خام و KB نشان می‌دهد؛ PRD-REC-02 پیام‌ها را به پس از Stop محدود می‌کند (خرابی واقعی ضبط استثناست).
هدف: هنگام phase فعال یا paused، شکست sync فقط در state نگه داشته و پس از Stop نمایش داده شود؛ خطای واقعی ضبط مثل قبل فوراً دیده شود؛ فهرست ضبط‌ها مدت (نه KB) و تاریخ کوتاه با Intl.DateTimeFormat نشان دهد.
محدودیت‌ها: هیچ خرابی واقعی ضبط پنهان نشود؛ «ذخیره شد» فقط پس از ثبت معتبر؛ منطق controller و upload تغییر نکند؛ متن تازه فقط از copy موجود یا تأییدشده؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. آزمون Playwright که شکست sync حین ضبط را شبیه‌سازی کند و نبود alert را بسنجد؛ screenshot قبل و بعد در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] حین ضبط فعال هیچ role="alert" غیر از خطای ضبط نیست [ ] پس از Stop پیام sync دیده می‌شود [ ] recording.spec و recording-capture.spec سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-12 — ناهمخوانی متن‌ها با رفتار واقعی: سهمیه، نشان «due»، حالت خالی مرور و برچسب منشأ

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/app/(app)/me/quota/page.tsx:283-303`، `apps/web/src/ui/workspace/api.ts:116-121`، `apps/web/src/ui/shell/AppShell.tsx:28,46`، `apps/web/src/app/(app)/LearnerShell.tsx:76`، `apps/web/src/ui/workspace/ReviewView.tsx:339`، `apps/web/src/ui/strings.ts:55-58,118`، `apps/web/src/ui/workspace/NoteView.tsx:50,69`
- **شاهد:**
  - صفحهٔ سهمیه می‌گوید «Processing starts only after you confirm its estimate.»، در حالی که پردازش خودکار است.
  - `reviewDue` هرگز به AppShell داده نمی‌شود، پس نشان «{count} due» در اپ واقعی نیست.
  - «No cards are due right now.» برای هر دو حالت «کارت نداری» و «امروز تمام شد» نمایش داده می‌شود. `strings.empty.review` استفاده نشده است.
  - NoteView «AI expansion» می‌گوید، در حالی که `strings.ts` و متن شرایط «AI explanation» می‌گویند.
- **چرا مهم است:** متن نادرست، کاربر را دربارهٔ رفتار سیستم گمراه می‌کند. برچسب منشأ هم بخشی از قرارداد شرایط استفاده است (PRD-CORE-03).
- **راهکار:**
  - متن‌های سهمیه را با پردازش خودکار هم‌خوان کن.
  - `reviewDue` را از Today به پوسته برسان.
  - دو حالت خالی مرور را جدا کن.
  - در NoteView از `strings.provenance` استفاده کن.
- **معیار پذیرش:** grep برای «confirm its estimate» خالی باشد. نشان due در `/today` دیده شود. NoteView از `strings.provenance` بخواند.

```text
یافتهٔ UX-12 — متن‌های ناهمخوان با رفتار واقعی را اصلاح کن.
مشکل: (۱) apps/web/src/app/(app)/me/quota/page.tsx:283-303 و apps/web/src/ui/workspace/api.ts:116-121 از «تأیید برآورد» می‌گویند ولی پردازش خودکار است؛ (۲) apps/web/src/app/(app)/LearnerShell.tsx:76 reviewDue را به AppShell نمی‌دهد و نشان «{count} due» (AppShell.tsx:46) هرگز دیده نمی‌شود؛ (۳) apps/web/src/ui/workspace/ReviewView.tsx:339 برای دو حالت متفاوت یک متن دارد و strings.empty.review (strings.ts:118) بی‌مصرف است؛ (۴) apps/web/src/ui/workspace/NoteView.tsx:50,69 «AI expansion» دارد ولی strings.provenance (strings.ts:55-58) و متن شرایط «AI explanation».
هدف: متن‌های سهمیه با پردازش خودکار هم‌خوان (متن تازه فقط پس از تأیید)؛ reviewDue از شمار صف مرور به LearnerShell برسد؛ ReviewView دو حالت «هیچ کارتی نیست» (strings.empty.review) و «برای امروز تمام شد» را جدا کند؛ NoteView از strings.provenance استفاده کند.
محدودیت‌ها: قاعدهٔ منشأ متن و strings.test.ts؛ کوئری اضافی سنگین برای reviewDue نزن (از دادهٔ موجود Today یا یک شمارش سبک)؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و جدول متن‌ها را بگو و منتظر تأیید بمان. screenshot قبل و بعد /me/quota، پوسته و /review خالی در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] grep "confirm its estimate" خالی [ ] نشان due دیده می‌شود [ ] دو حالت خالی مرور جدا هستند [ ] NoteView برچسب strings.provenance را دارد [ ] e2e study و redesign سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-13 — انتظار پردازش بی‌برآورد زمانی؛ دروازهٔ دوم حقوق مواد و صفحهٔ بلند material

- **سطح:** Low | **اطمینان:** متوسط | **تلاش:** M
- **محل:** `apps/web/src/ui/workspace/learning-progress.ts:365-370`، `apps/web/src/ui/workspace/SessionNextStep.tsx:192-239`، `apps/web/src/ui/workspace/SourcesView.tsx:488-505`، `apps/web/src/app/(app)/sessions/[id]/sources/material-page.tsx:30-45`، `apps/web/src/ui/workspace/ProcessingView.tsx:405-420`
- **شاهد:**
  - «Waiting to process» و «Creating notes and flashcards» هیچ برآورد زمانی ندارند. دعوت به اعلان push هم آنجا نیست.
  - بعد از consent ضبط در setup، صفحهٔ material با تیک دوم «I have the right to use these materials…» قفل است.
  - `AutomaticLearningView` با ۵۲۴ خط و `SourcesView` با ۱٬۲۲۵ خط و پنج پنل پشت سر هم رندر می‌شوند. «Next step» در میانهٔ صفحه است.
- **چرا مهم است:** در مسیر ضبط، Stop، پردازش و جزوه، کاربر بلافاصله پس از Stop دوباره متوقف می‌شود و باید گام بعدی را در صفحه‌ای بلند پیدا کند. این بزرگ‌ترین اصطکاک مسیر رسیدن به اولین ارزش است.
- **راهکار:**
  - پنل «Next step» همیشه اول بیاید.
  - تیک حقوق، که الزام قراردادی است، بالای صفحه باشد و فقط با تغییر نسخه دوباره پرسیده شود.
  - برای انتظار، یک بازهٔ زمانی تقریبی و دعوت به اعلان push را از copy تأییدشده اضافه کن.
- **معیار پذیرش:** در ۳۹۰ پیکسل «Next step» بدون اسکرول دیده شود. تیک حقوق فقط یک بار در هر نسخه پرسیده شود.

```text
یافتهٔ UX-13 — اصطکاک پس از Stop را در صفحهٔ material کم کن.
مشکل: پس از Stop، صفحهٔ material (apps/web/src/app/(app)/sessions/[id]/sources/material-page.tsx:30-45) پشت تیک حقوق مواد (apps/web/src/ui/workspace/SourcesView.tsx:488-505) قفل است و AutomaticLearningView و SourcesView را پشت سر هم با پنل «Next step» در میانه نشان می‌دهد؛ انتظار پردازش (apps/web/src/ui/workspace/learning-progress.ts:365-370) برآورد زمانی و دعوت به اعلان ندارد.
هدف: پنل Next step همیشه اول؛ تیک حقوق بالای صفحه و فقط وقتی نسخهٔ notice تغییر کرده؛ متن انتظار با بازهٔ تقریبی و دعوت به فعال‌کردن اعلان (کامپوننت موجود apps/web/src/ui/notifications) از copy تأییدشده.
محدودیت‌ها: الزام قراردادی تیک حقوق حذف نشود؛ برآورد زمانی را از دادهٔ واقعی NFR-07 (stage times) بگیر یا اگر نیست، متن بدون عدد بگذار؛ متن تازه فقط پس از تأیید؛ اگر چیدمان در قاب طرح نیست، پیش از ساخت بپرس؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. screenshot قبل و بعد صفحهٔ material پس از Stop در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] در ۳۹۰×۶۶۴ «Next step» بدون اسکرول دیده می‌شود [ ] تیک حقوق در نسخهٔ ثابت فقط یک بار پرسیده می‌شود [ ] automatic-learning.spec، processing-review.spec و audio-upload.spec سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### UX-14 — دانلود جزوه و کارت از صفحهٔ «Your data» قابل کشف نیست

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/app/(app)/me/data/page.tsx:12`، `apps/web/src/ui/workspace/PrivacyView.tsx:178-200`، `apps/web/src/app/(app)/sessions/[id]/page.tsx:223-246`
- **شاهد:** `/me/data` فقط حذف را توضیح می‌دهد. دانلود فقط درون `<details>` «More session tools» در صفحهٔ هر جلسه است.
- **چرا مهم است:** کاربری که پیش از حذف حساب می‌خواهد نسخه‌ای بردارد، در صفحهٔ داده راهی نمی‌بیند.
- **راهکار:** در بالای `PrivacyView` یک پاراگراف و پیوند به فهرست جلسه‌ها یا export بگذار. قابلیت تازه‌ای لازم نیست.
- **معیار پذیرش:** از `/me/data` به export دسترسی باشد، و `learning-privacy.spec` پیوند را بسنجد.

```text
یافتهٔ UX-14 — از صفحهٔ «Your data» به دانلود جزوه و کارت پیوند بده.
مشکل: apps/web/src/app/(app)/me/data/page.tsx:12 و apps/web/src/ui/workspace/PrivacyView.tsx:178-200 فقط حذف را نشان می‌دهند؛ دانلود در apps/web/src/app/(app)/sessions/[id]/page.tsx:223-246 زیر «More session tools» پنهان است.
هدف: پاراگراف کوتاه و پیوند «Download a session» (متن از copy موجود یا تأییدشده) بالای PrivacyView به فهرست جلسه‌ها یا export.
محدودیت‌ها: قابلیت تازه نساز؛ متن تازه فقط پس از تأیید؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. screenshot قبل و بعد /me/data در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] پیوند از /me/data به export کار می‌کند [ ] learning-privacy.spec آن را می‌سنجد و سبز است.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### دسترس‌پذیری — `A11Y`

#### A11Y-01 — مرز کنترل‌های فرم در تم روشن کنتراست کمتر از ۳:۱ دارد (WCAG 1.4.11)

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S (پس از تصمیم)
- **محل:** `apps/web/src/ui/styles/app.css:10-11`، `apps/web/src/ui/styles/vendor/nocturne-base.css:167-171`، `apps/web/src/ui/components/Checkbox.module.css:20`، `apps/web/src/ui/components/RadioCards.module.css:30`، `apps/web/src/ui/components/Switch.module.css:23,42`
- **شاهد:** کنتراست‌ها از روی hex محاسبه شده‌اند:

  | مرز | پس‌زمینه | کنتراست |
  |---|---|---|
  | `--rc-border-strong: #8c9c91` (چک‌باکس و رادیو) | `#f6f7f2` | ۲٫۶۸:۱ |
  | `--rc-border-strong: #8c9c91` | `#ffffff` | ۲٫۸۸:۱ |
  | `--color-divider: #dce3d9` (`.input`) | `#ffffff` | ۱٫۳۱:۱ |

  تم تیره حدود ۵٫۵:۱ است. axe این معیار را خودکار نمی‌سنجد.
- **چرا مهم است:** در تم روشن، فیلدها و چک‌باکس‌های رضایت، از جمله «I am 18 or older» و پذیرش Terms، برای کاربران کم‌بینا عملاً بی‌مرز دیده می‌شوند.
- **راهکار:** تصمیم ۸. چون token طراحی است، تغییرش تأیید طراح یا مالک را لازم دارد. در `app.css` برای تم روشن، `--rc-border-strong` را به رنگی با کنتراست دست‌کم ۳:۱ روی هر دو پس‌زمینه برسان. `.input` هم از همان token استفاده کند.
- **معیار پذیرش:** کنتراست مرز input، checkbox، radio و switch در هر دو تم دست‌کم ۳:۱ باشد. `vendor.test.ts` سبز بماند، یعنی تغییر فقط در `app.css` باشد.

```text
یافتهٔ A11Y-01 — کنتراست مرز کنترل‌های فرم در تم روشن را به ۳:۱ برسان.
مشکل: --rc-border-strong (#8c9c91) روی #f6f7f2 و #ffffff فقط ۲٫۶۸ و ۲٫۸۸ به ۱ و مرز .input (--color-divider #dce3d9) روی #ffffff ۱٫۳۱ به ۱ است — محل: apps/web/src/ui/styles/app.css:10-11، apps/web/src/ui/styles/vendor/nocturne-base.css:167-171، apps/web/src/ui/components/Checkbox.module.css:20، RadioCards.module.css:30، Switch.module.css:23,42.
هدف: فقط در app.css و فقط برای تم روشن، مقدار --rc-border-strong به رنگی که مالک محصول یا طراح تأیید کرده (کنتراست ≥۳:۱ روی #f6f7f2، #ffffff و #edf1e9) و مرز .input از همان token؛ تم تیره بی‌تغییر.
محدودیت‌ها: token طراحی است؛ بدون تأیید صریح مالک محصول مقدار را انتخاب نکن، دو سه گزینه با کنتراست محاسبه‌شده پیشنهاد بده؛ vendor تغییر نکند (vendor.test.ts)؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول گزینه‌ها و جدول کنتراست را نشان بده و منتظر تأیید بمان. screenshot قبل و بعد صفحهٔ ورود، setup و /dev/ui در ۳۷۵ و ۱۴۴۰، تم روشن.
معیار پذیرش: [ ] کنتراست مرزها در هر دو تم ≥۳:۱ (محاسبه در گزارش) [ ] vendor.test.ts و axe سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### A11Y-02 — جهت و زبان محتوای زبان‌آموز: textareaهای کارت بی‌`dir="auto"`، بلوک‌های انگلیسی جزوهٔ فارسی بی‌`lang`

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/ui/workspace/CardEditor.tsx:117-132`، `apps/web/src/ui/workspace/ReviewView.tsx:308`، `packages/core/src/lkm/study-render.ts:46-56`، `apps/web/src/ui/workspace/CardFace.tsx:60,77,81`
- **شاهد:**
  - دو `<textarea>` پرسش و پاسخ کارت `dir` ندارند. در مقابل، `TextInput` و `TextArea` در `Field.tsx` با `dir="auto"` ساخته شده‌اند.
  - `<p style={{ whiteSpace: "pre-wrap" }}>{current.card.back}</p>` هم بی‌`dir` است.
  - در `study-render.ts`: ``englishAttrs: `dir="ltr"${locale.isPersian ? "" : ' lang="en"'}` ``. پس در جزوهٔ فارسی، بلوک‌های انگلیسی `lang` نمی‌گیرند. کانتینر کارت هم فقط `dir="auto"` دارد، بی‌`lang`، در حالی که `html` برابر `lang="en"` است.
- **چرا مهم است:** زبان‌آموز فارسی‌زبان هنگام ویرایش، متن را چپ‌چین و با علائم جابه‌جا می‌بیند (FR-PLT-011). صفحه‌خوان هم متن فارسی را با تلفظ انگلیسی می‌خواند و برعکس.
- **راهکار:**
  - در CardEditor از `TextArea` کامپوننت Field استفاده کن، یا `dir="auto"` بگذار.
  - پاسخ listening هم `dir="auto"` بگیرد.
  - در `study-render`، `lang="en"` و `lang` زبان توضیح را همیشه بنویس. آزمون `study-render.test.ts:173` را به‌روز کن. اگر دلیلی برای حذف بوده، مثل فونت iOS، آن را مستند کن.
- **معیار پذیرش:** متن فارسی در ویرایشگر راست‌چین و انگلیسی چپ‌چین باشد. در DOM `/review`، متن فارسی زیر `lang="fa"` و متن انگلیسی زیر `lang="en"` باشد.

```text
یافتهٔ A11Y-02 — جهت و زبان محتوای زبان‌آموز را در کارت و جزوه درست کن.
مشکل: apps/web/src/ui/workspace/CardEditor.tsx:117-132 دو textarea بدون dir؛ apps/web/src/ui/workspace/ReviewView.tsx:308 پاسخ listening بدون dir؛ packages/core/src/lkm/study-render.ts:46-56 برای زبان توضیح فارسی lang="en" بلوک‌های انگلیسی و lang بلوک‌های توضیحی را حذف می‌کند؛ apps/web/src/ui/workspace/CardFace.tsx:60,77,81 کانتینر کارت lang ندارد.
هدف: textareaهای CardEditor از TextArea در Field.tsx (یا dir="auto")؛ پاسخ listening با dir="auto"؛ study-render همیشه lang="en" برای بلوک انگلیسی و lang زبان توضیح برای بلوک توضیحی بنویسد؛ اگر حذف عمدی بود (مثلاً مسئلهٔ فونت)، دلیل را بیاب و راه جایگزین (lang روی کانتینر کارت در CardFace با زبان model.language.explanation) را پیشنهاد کن.
محدودیت‌ها: ظاهر کارت و جزوه تغییر نکند؛ آزمون study-render.test.ts:173 را آگاهانه به‌روز کن؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون‌ها: واحد برای خروجی renderer و CardEditor؛ Playwright برای lang در DOM /review. screenshot قبل و بعد کارت فارسی و انگلیسی در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] متن فارسی در ویرایشگر راست‌چین است [ ] هر متن فارسی کارت زیر lang="fa" و انگلیسی زیر lang="en" است [ ] multilingual-study.spec و reference-study.spec سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### A11Y-03 — با «Show answer» فوکوس کیبورد از دست می‌رود

- **سطح:** Medium | **اطمینان:** متوسط | **تلاش:** S
- **محل:** `apps/web/src/ui/workspace/ReviewView.tsx:279-283,312-330`
- **شاهد:** `{!shown ? (<Button … onClick={() => setShown(true)}>Show answer</Button>) : (…)}`. دکمهٔ دارای فوکوس unmount می‌شود و در فایل هیچ `.focus(` یا ref مدیریت فوکوس نیست. در مقابل، `CardsView.tsx:15-18` یک toggle پایدار با `aria-expanded` دارد.
- **چرا مهم است:** کاربر کیبورد یا صفحه‌خوان، در هر کارت مرور، که مسیر روزانهٔ اصلی است، بعد از آشکار شدن پاسخ به ابتدای صفحه پرت می‌شود و پاسخ اعلام نمی‌شود.
- **راهکار:** بعد از `setShown(true)` فوکوس را با ref به ناحیهٔ پاسخ (`tabIndex={-1}`) یا اولین دکمهٔ نمره ببر. پاسخ را در ناحیهٔ `aria-live` اعلام کن. با رفتن به کارت بعد، فوکوس روی «Show answer» تازه برگردد.
- **معیار پذیرش:** بعد از Enter روی «Show answer»، `document.activeElement` روی پاسخ یا اولین نمره باشد. Playwright با کیبورد آن را بسنجد.

```text
یافتهٔ A11Y-03 — مدیریت فوکوس را در مرور کارت پیاده کن.
مشکل: در apps/web/src/ui/workspace/ReviewView.tsx:279-283 دکمهٔ «Show answer» با فشرده‌شدن unmount می‌شود و فوکوس به body می‌رود؛ هیچ ref یا .focus() در فایل نیست.
هدف: پس از نمایش پاسخ، فوکوس روی ناحیهٔ پاسخ (div با tabIndex={-1} و عنوان مناسب) یا اولین دکمهٔ نمره‌دهی برود و پاسخ در ناحیهٔ aria-live موجود اعلام شود؛ پس از ثبت نمره و رفتن به کارت بعد، فوکوس روی «Show answer» تازه قرار گیرد.
محدودیت‌ها: ظاهر و رفتار نمره‌دهی و idempotency رخداد مرور تغییر نکند؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون Playwright فقط با کیبورد در study.spec.ts بنویس و شکستش را ببین.
معیار پذیرش: [ ] activeElement پس از Show answer روی پاسخ یا اولین نمره است [ ] پس از نمره روی Show answer کارت بعد است [ ] study.spec، lesson-review.spec و axe سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### A11Y-04 — ترتیب سرفصل‌ها در چند قاب نمونه، و پوشش axe فقط در تم روشن

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/ui/preview/LearningViews.tsx` (صفحه‌های cards و card-types)، `apps/web/src/ui/preview/AccountViews.tsx` (legal)، `apps/web/e2e/helpers.ts:7-13`، `apps/web/e2e/admin.spec.ts:166`
- **شاهد:**
  - آزمون زندهٔ ۴۹ صفحهٔ `/preview` در ۳۷۵ و ۱۴۴۰، فقط `heading-order` (moderate) را روی `cards`، `card-types` و `legal` نشان داد. صفحه‌های واقعی app ترتیب درست دارند.
  - از ۶۵ فراخوانی axe در e2e، فقط `admin.spec.ts` تم تیره را می‌سنجد.
- **چرا مهم است:** قاب‌های نمونه مرجع طراحی‌اند، و خطای آن‌ها به پیاده‌سازی‌های بعدی منتقل می‌شود. کنتراست تم تیره هم در e2e سنجیده نمی‌شود.
- **راهکار:** سطح سرفصل‌های آن سه قاب را درست کن. در `expectNoAxeViolations` یک پارامتر تم اضافه کن و برای صفحه‌های کلیدی، یعنی today، review، notes و me، تم تیره را هم بسنج.
- **معیار پذیرش:** axe روی هر ۴۹ قاب بی‌خطا باشد، و دست‌کم چهار صفحهٔ زبان‌آموز در تم تیره سنجیده شوند.

```text
یافتهٔ A11Y-04 — ترتیب سرفصل‌ها در قاب‌های نمونه و پوشش axe در تم تیره را کامل کن.
مشکل: axe روی /preview/cards، /preview/card-types و /preview/legal خطای heading-order می‌دهد (apps/web/src/ui/preview/LearningViews.tsx و AccountViews.tsx)؛ در apps/web/e2e فقط admin.spec.ts:166 axe را در تم تیره اجرا می‌کند (helper در apps/web/e2e/helpers.ts:7-13).
هدف: سطح سرفصل‌های آن سه قاب بدون تغییر ظاهر (کلاس‌های موجود) اصلاح شود؛ expectNoAxeViolations پارامتر اختیاری colorScheme بگیرد و specهای today، review، notes و me یک بار در تم تیره هم axe اجرا کنند.
محدودیت‌ها: ظاهر تغییر نکند؛ مصرف دقیقهٔ CI را بی‌دلیل بالا نبر (فقط چهار صفحه)؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. screenshot قبل و بعد سه قاب در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] e2e-preview screens.spec با axe روی هر ۴۹ قاب سبز است [ ] چهار spec تم تیره را می‌سنجند و سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### A11Y-05 — متن `alt` عمومی برای رسانهٔ کارت

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/ui/workspace/ReviewView.tsx:118-122`، `apps/web/src/ui/workspace/CardMedia.tsx:211-215`
- **شاهد:** `alt="Card learning material"` و `alt="Selected session material"` برای همهٔ تصاویر به کار رفته‌اند. عکس‌های تخته در `RecordingView` به‌درستی `alt={label(photo)}` دارند.
- **چرا مهم است:** کاربر صفحه‌خوان در مرور نمی‌فهمد تصویر چه چیزی نشان می‌دهد.
- **راهکار:** `alt` را از جلوی کارت یا `displayName` منبع بساز. اگر تصویر تزئینی است، `alt=""` بگذار.
- **معیار پذیرش:** `alt` هر تصویر کارت شامل متن کارت یا نام فایل باشد.

```text
یافتهٔ A11Y-05 — alt معنادار برای تصاویر کارت و جلسه بگذار.
مشکل: apps/web/src/ui/workspace/ReviewView.tsx:118-122 و CardMedia.tsx:211-215 alt ثابت و عمومی دارند.
هدف: alt از متن جلوی کارت (کوتاه‌شده) یا displayName منبع و زمان؛ تصویر تزئینی alt="".
محدودیت‌ها: متن alt دادهٔ زبان‌آموز است و ممکن است RTL باشد؛ HTML اجرا نشود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. آزمون واحد برای تابع ساخت alt.
معیار پذیرش: [ ] alt تصاویر کارت متن کارت یا نام فایل دارد [ ] axe و study.spec سبزند.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### آمادگی محصول و انتشار — `PRD`

#### PRD-01 — متن‌های حقوقی زنده هنوز «Draft for development only» هستند و هیچ گارد build جلوی انتشارشان را نمی‌گیرد

- **سطح:** Medium | **اطمینان:** بالا | **تلاش:** S (گارد) / L (متن نهایی، G11)
- **محل:** `apps/web/src/legal/texts.generated.ts`، `apps/web/src/server/legal.ts:11-12`، `apps/web/src/ui/components/LegalDocument.tsx`، `docs/legal/README.md:4,14`، `docs/plans/M5_MVP_COMPLETION.md:23`، `docs/legal/G11_REVIEW.md:3,79`
- **شاهد:**
  - متن تولیدشده «Version 0.1 · Draft» و «Version 0.2 · Draft» را دارد، جملهٔ «Draft for development only…» را دو بار دارد، و هفت نشانگر «⟨Before the pilot: …⟩» دارد.
  - `LegalDocument` فقط heading سطح ۱ را حذف می‌کند، پس زبان‌آموز در Sheet ورود و TermsNotice همهٔ این‌ها را می‌بیند.
  - پرچم `draft: true` تولید می‌شود، ولی هیچ build یا آزمونی آن را مسدود نمی‌کند. «قاعدهٔ پیشنهادی» README پیاده نشده است.
  - اسناد با هم تناقض دارند. `README:14` می‌گوید «این بسته برای پایلوت اولیهٔ حداکثر هشت حساب آماده است»، و M5 می‌گوید شروع پایلوت واقعی به بسته شدن G11 نیاز دارد.
- **چرا مهم است:** G11 دروازهٔ باز و شناخته‌شده است و امروز فقط مالک محصول کاربر است. دو منتقد مستقل به همین دلیل سطح را از High به Medium و Low رساندند. ولی اگر مالک پیش از بستن G11 زبان‌آموزی را به test users گوگل اضافه کند، هیچ مانع فنی‌ای پذیرش شرایط پیش‌نویس را متوقف نمی‌کند. این **شرط انتشار** است.
- **راهکار:**
  - گارد build را پیاده کن. اگر `VERCEL_ENV === "production"` و `RECALINO_ALLOW_DRAFT_LEGAL` صریحاً `1` نباشد، متن `draft`، نشانگر `⟨…⟩` یا placeholder باید build را بشکند.
  - تناقض README و M5 را با تصمیم مالک رفع کن.
  - متن ۱٫۰ را با بستن G11 آماده کن. این کار مالک محصول و مشاور حقوقی است.
- **معیار پذیرش:**
  - آزمون واحد: با `draft` در production، گارد شکست بخورد و با پرچم صریح بگذرد.
  - README و M5 هم‌خوان باشند.

```text
یافتهٔ PRD-01 — گارد انتشار متن حقوقی پیش‌نویس را پیاده کن.
مشکل: apps/web/src/legal/texts.generated.ts نسخه‌های 0.1/0.2 Draft، جملهٔ «Draft for development only» و هفت نشانگر «⟨Before the pilot⟩» دارد و apps/web/src/ui/components/LegalDocument.tsx همه را نمایش می‌دهد؛ پرچم draft: true مصرفی ندارد و قاعدهٔ پیشنهادی docs/legal/README.md («build production با متن ۰٫x یا ⟨…⟩ شکست می‌خورد») پیاده نشده؛ README:14 با docs/plans/M5_MVP_COMPLETION.md:23 تناقض دارد.
هدف: (۱) یک بررسی در tools/legal/build.ts یا گام prebuild که اگر VERCEL_ENV === "production" و RECALINO_ALLOW_DRAFT_LEGAL !== "1"، با هر متن draft، نشانگر ⟨…⟩ یا placeholder اپراتور، build را با پیام روشن متوقف کند؛ (۲) .env.example نام RECALINO_ALLOW_DRAFT_LEGAL را با توضیح داشته باشد؛ (۳) پیشنهاد اصلاح جملهٔ README:14 برای هم‌خوانی با M5 در گزارش.
محدودیت‌ها: متن حقوقی را تغییر نده (کار G11 و مالک)؛ build production فعلی نباید ناگهان بشکند: در گزارش پایانی به مالک بگو پیش از ادغام، RECALINO_ALLOW_DRAFT_LEGAL=1 را آگاهانه در Vercel تنظیم کند یا G11 را ببندد؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. اول آزمون واحد برای گارد (draft+production → خطا؛ draft+پرچم → عبور؛ نهایی → عبور؛ غیر production → عبور).
معیار پذیرش: [ ] چهار حالت آزمون سبز [ ] pnpm legal:build و pnpm build محلی سبز [ ] گزارش گام لازم در Vercel را دارد.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PRD-02 — Run پردازشی که job آن با `lease_expired` شکست بخورد، برای همیشه «processing» می‌ماند و رزرو سهمیه آزاد نمی‌شود

- **سطح:** Medium | **اطمینان:** متوسط | **تلاش:** M
- **محل:** `packages/core/src/plt/jobs.ts:285-292`، `packages/core/src/proc/worker.ts:2219-2232`، `packages/core/src/proc/runs.ts:~352,~597`، `apps/web/src/server/automatic-learning.ts:362-368`، `apps/web/src/ui/workspace/ProcessingView.tsx:~436`
- **شاهد:**
  - `sweepJobs` وقتی lease تمام شود، job را بی‌اجرای handler به `failed` می‌برد (`last_error = 'lease_expired'`). این مثلاً وقتی رخ می‌دهد که Function در `maxDuration` کشته شود.
  - Run و رزرو فقط در catch داخل worker یا در `cancelRun` تسویه می‌شوند. هیچ hook یا تطبیق دوره‌ای وضعیت job را برای Run نمی‌خواند، و reservation انقضا ندارد.
  - منتقد مستقل دو چیز را تأیید کرد. دکمهٔ «Cancel processing» در `ProcessingView` در هیچ صفحهٔ production نصب نشده است. `createProcessingRun` هم برای Run فعال conflict می‌دهد، پس Run گیرکرده پردازش دوبارهٔ همان جلسه را مسدود می‌کند.
- **چرا مهم است:** اگر پردازش یک کلاس طولانی در هر تلاش از سقف زمان بگذرد، زبان‌آموز برای همیشه «Creating notes…» می‌بیند. سهمیه‌اش هم در رزرو می‌ماند و نمی‌تواند دوباره پردازش کند. راه بازگشت فقط دخالت دستی اپراتور در دیتابیس است.
- **راهکار:** یک تطبیق دوره‌ای بساز، یا یک hook `onFinalFailure` در runner، که Runهای `processing` با job در وضعیت `failed` را با همان مسیر شکست worker ببندد، یعنی `settleAllowance` با مقدار صفر. همچنین برای Run گیرکرده اقدام «Retry» یا «Cancel» را در صفحهٔ material نمایش بده.
- **معیار پذیرش:**
  - آزمون integration: job پردازش با lease منقضی در آخرین تلاش، ظرف یک دورهٔ تطبیق به Run `failed`، رزرو آزاد و اعلان به کاربر برسد.
  - پردازش دوبارهٔ همان جلسه ممکن باشد.

```text
یافتهٔ PRD-02 — Runهای پردازشی گیرکرده پس از lease_expired را ببند و رزروشان را آزاد کن.
مشکل: packages/core/src/plt/jobs.ts:285-292 (sweepJobs) jobهای lease-منقضی را در آخرین تلاش بدون اجرای handler failed می‌کند؛ Run (proc.processing_run) و رزرو سهمیه فقط در catch داخل worker (packages/core/src/proc/worker.ts:2219-2232) یا cancelRun (packages/core/src/proc/runs.ts حدود ۵۹۷) تسویه می‌شوند؛ هیچ تطبیقی نیست، reservation انقضا ندارد، دکمهٔ Cancel در apps/web/src/ui/workspace/ProcessingView.tsx در هیچ صفحهٔ production نصب نشده و createProcessingRun (runs.ts حدود ۳۵۲) برای Run فعال conflict می‌دهد.
هدف: یک job دوره‌ای (مثلاً proc.reconcile_failed_runs، الگوی packages/core/src/proc/maintenance.ts) یا hook شکست نهایی در runner که هر Run با state processing یا queued که job آن failed یا cancelled است را با همان مسیر شکست worker ببندد (settleAllowance با مقدار صفر، وضعیت failed با کد خطای ثابت، اعلان پردازش مطابق processing-notifications)؛ idempotent و امن در اجرای هم‌زمان.
محدودیت‌ها: مسیر پولی است: هیچ کسر سهمیه‌ای رخ ندهد و رزرو فقط آزاد شود؛ idempotency (PRD-COST-02) حفظ شود؛ تغییر schema فقط با migration؛ اگر نمایش اقدام Retry/Cancel در UI لازم است و در قاب طرح نیست، بپرس؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. اول آزمون integration: job پردازش با attempt = max_attempts و lease منقضی → sweep → reconcile → Run failed، reservation آزاد، اعلان ثبت؛ اجرای دوبارهٔ reconcile اثر دوباره ندارد؛ پردازش تازهٔ همان جلسه ممکن است.
معیار پذیرش: [ ] آزمون‌های بالا سبز [ ] آزمون‌های quota/ledger و proc موجود سبز [ ] e2e automatic-learning و processing-review سبز.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PRD-03 — اپراتور پیشرفت پایلوت را نمی‌بیند: رویدادهای قیف و سلامت runner ثبت یا نمایش نمی‌شوند

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** M
- **محل:** `supabase/migrations/20261005195848_admin_metadata_projections.sql:5,50`، `packages/core/src/ops/admin-read.ts:463-470`، `apps/web/src/server/auth/flow.ts`، `apps/web/src/ui/admin/SystemScreens.tsx:223`
- **شاهد:**
  - view `ops.admin_user` فقط `id`، `created_at`، `pilot` و `welcome_state` را می‌دهد.
  - overview فقط `users`، `pending_feedback`، `queued_runs` و `failed_emails` را می‌شمارد.
  - هیچ رویداد نام‌داری برای ورود، پایان setup، اولین ضبط، اولین پردازش یا اولین مرور ثبت نمی‌شود.
  - درخواست حذف در وضعیت `needs_operator` در فهرست وظایف ادمین نیست.
- **چرا مهم است:** هدف پایلوت سنجیدن «زمان تا اولین کارت مرورشده» و ریزش هر گام است. بدون این داده، ارزیابی پایلوت دستی و ناقص می‌شود، و گیر کردن یک زبان‌آموز در حذف حساب دیده نمی‌شود.
- **راهکار:** تصمیم ۹. یک projection فقط‌شمارشی بساز که برای هر کاربر تاریخ اولین بار هر گام را از جدول‌های موجود بخواند، بی‌محتوای کلاس و بی‌analytics شخص ثالث. ستون‌ها را در پنل ادمین نشان بده. شاخهٔ `priv.deletion_request` در وضعیت `needs_operator` را به `ops.admin_task` اضافه کن.
- **معیار پذیرش:** پنل ادمین برای هر کاربر تاریخ گام‌ها را نشان دهد، و درخواست `needs_operator` در وظایف دیده شود.

```text
یافتهٔ PRD-03 — نمای پیشرفت پایلوت و وظیفهٔ حذف گیرکرده را به پنل ادمین اضافه کن.
مشکل: ops.admin_user و overview ادمین (supabase/migrations/20261005195848_admin_metadata_projections.sql، packages/core/src/ops/admin-read.ts:463-470) هیچ نشانه‌ای از گام‌های قیف (ورود، پایان setup، اولین ضبط، اولین پردازش موفق، اولین مرور) ندارند و ops.admin_task شاخهٔ priv.deletion_request در وضعیت needs_operator ندارد.
هدف: (۱) یک view فقط‌شمارشی با migration که برای هر کاربر تاریخ نخستین رخداد هر گام را از جدول‌های موجود (acc، org، src، proc، srs) استخراج کند، بدون هیچ متن کلاس یا داده‌ای جز تاریخ و شمار؛ (۲) ستون‌های آن در صفحهٔ کاربران پنل ادمین با کامپوننت‌های موجود؛ (۳) شاخهٔ needs_operator در ops.admin_task.
محدودیت‌ها: هیچ analytics یا سرویس شخص ثالث؛ PRD-PRIV-06؛ اگر مالک محصول تصمیم ۹ را رد کرده، فقط بخش (۳) را انجام بده؛ تغییر schema فقط با migration و pnpm db:types؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. آزمون integration برای view و برای وظیفهٔ needs_operator؛ screenshot پنل ادمین در ۱۴۴۰ و ۳۷۵.
معیار پذیرش: [ ] view فقط تاریخ و شمار برمی‌گرداند [ ] پنل ستون‌ها را نشان می‌دهد [ ] needs_operator در وظایف دیده می‌شود [ ] admin.spec سبز است.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PRD-04 — صفحهٔ ورود پایلوت خصوصی قابل ایندکس است

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `apps/web/src/app/layout.tsx:10-21`، `apps/web/src/app/page.tsx:15`
- **شاهد:** metadata ریشه `robots` ندارد، و `robots.ts` یا `robots.txt` وجود ندارد. فقط `/dev`، `/preview` و `/deletion` حالت `noindex` دارند.
- **چرا مهم است:** پایلوت هشت‌نفرهٔ خصوصی است. ایندکس شدن `/` جست‌وجوگران تصادفی را به صفحهٔ ورود Google می‌آورد، بی‌آنکه سودی داشته باشد.
- **راهکار:** تا پایان پایلوت، در metadata ریشه `robots: { index: false, follow: false }` بگذار. افزودن `app/robots.ts` با Disallow هم ممکن است.
- **معیار پذیرش:** پاسخ `/` شامل `<meta name="robots" content="noindex, nofollow">` باشد.

```text
یافتهٔ PRD-04 — صفحه‌های پایلوت خصوصی را از ایندکس موتورهای جست‌وجو خارج کن.
مشکل: apps/web/src/app/layout.tsx:10-21 در metadata ریشه robots ندارد و robots.ts یا robots.txt وجود ندارد؛ / عمومی و قابل ایندکس است.
هدف: robots: { index: false, follow: false } در metadata ریشه (تا پایان پایلوت، با کامنت ارجاع به تصمیم) و apps/web/src/app/robots.ts با Disallow: /.
محدودیت‌ها: مستندات Metadata در node_modules/next/dist/docs را بخوان؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. آزمون Playwright که meta robots و /robots.txt را بسنجد.
معیار پذیرش: [ ] / دارای meta robots noindex, nofollow [ ] /robots.txt همه را Disallow می‌کند [ ] signin.spec سبز است.
پایان: lint، typecheck، تست‌ها و pnpm test:e2e را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PRD-05 — ناهم‌خوانی اسناد با پیکربندی زنده: مدل پیش‌فرض و دورهٔ پاک‌سازی صوت

- **سطح:** Low | **اطمینان:** بالا | **تلاش:** S
- **محل:** `docs/plans/M5_MVP_COMPLETION.md:51`، `config/openrouter-defaults.json:3`، `docs/legal/privacy-notice.md:122`، `packages/core/src/src/audio.ts:26`
- **شاهد:**
  - M5 مدل پیش‌فرض را `anthropic/claude-haiku-4.5` می‌نویسد، در حالی که `openrouter-defaults.json` مقدار `"llmModel": "google/gemini-3.8-flash"` دارد (D56).
  - اطلاعیه می‌گوید «An hourly cleanup job removes expired copies»، در حالی که `TEMPORARY_AUDIO_SWEEP_SECONDS = 300` است، یعنی هر ۵ دقیقه.
- **چرا مهم است:** سند مرجع وضعیت (CLAUDE.md به M5 ارجاع می‌دهد) و متن حقوقی باید با رفتار واقعی بخوانند. پردازشگر AI بخشی از اطلاعیهٔ حریم خصوصی است.
- **راهکار:** M5 و PILOT_TECHNICAL_FACTS را با D56 هم‌خوان کن. در پیش‌نویس اطلاعیه «at least hourly» یا «every few minutes» بنویس، با تأیید مالک.
- **معیار پذیرش:** grep مدل‌ها و دوره در اسناد با کد بخواند.

```text
یافتهٔ PRD-05 — اسناد را با پیکربندی زنده هم‌خوان کن.
مشکل: docs/plans/M5_MVP_COMPLETION.md:51 مدل پیش‌فرض را anthropic/claude-haiku-4.5 می‌نویسد ولی config/openrouter-defaults.json:3 google/gemini-3.8-flash است (D56)؛ docs/legal/privacy-notice.md:122 پاک‌سازی ساعتی می‌گوید ولی packages/core/src/src/audio.ts:26 هر ۳۰۰ ثانیه.
هدف: M5 و docs/legal/PILOT_TECHNICAL_FACTS.md (در صورت نیاز) مدل‌ها را مطابق D56 و فایل config ثبت کنند؛ برای privacy-notice.md یک تغییر پیشنهادی («at least every hour» یا مشابه) آماده و پس از تأیید مالک اعمال شود، سپس pnpm legal:build.
محدودیت‌ها: متن حقوقی را بدون تأیید صریح مالک تغییر نده و وعدهٔ تازه اضافه نکن؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول diff پیشنهادی را نشان بده و منتظر تأیید بمان.
معیار پذیرش: [ ] اسناد و config یک مدل می‌گویند [ ] اگر متن حقوقی تغییر کرد، pnpm legal:build و آزمونش سبزند.
پایان: lint و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

#### PRD-06 — نکته‌های بدون ریسک فوری: ایمیل‌های تراکنشی دستی‌اند و PWA صفحهٔ آفلاین ندارد

- **سطح:** Info | **اطمینان:** بالا | **تلاش:** S
- **محل:** `packages/core/src/support/contracts.ts:8-18`، `apps/web/src/server/privacy-routes.ts`، `apps/web/public/sw.js:1-2`، `apps/web/src/app/manifest.ts`
- **شاهد:**
  - قالب‌های ایمیل همه دستی و اپراتوری‌اند. هیچ ایمیل خودکار «درخواست حذف ثبت شد» یا «حذف کامل شد» نیست.
  - `sw.js` فقط push است و صفحهٔ fallback آفلاین ندارد. این با تصمیم «بدون مرور کاملاً آفلاین» سازگار است.
- **راهکار:** کد لازم نیست. در راهنمای پایلوت، `docs/PILOT_SETUP.md`، این دو محدودیت را ثبت کن و تصمیم دربارهٔ ایمیل تأیید حذف را بگیر.
- **معیار پذیرش:** هر دو محدودیت در راهنمای پایلوت ثبت شده باشند.

```text
یافتهٔ PRD-06 — دو محدودیت پایلوت را در راهنمای پایلوت ثبت کن.
مشکل: هیچ ایمیل تراکنشی خودکار (مثلاً تأیید ثبت یا تکمیل حذف حساب) نیست — packages/core/src/support/contracts.ts:8-18، apps/web/src/server/privacy-routes.ts؛ و PWA (apps/web/public/sw.js) صفحهٔ آفلاین ندارد.
هدف: بخشی کوتاه در docs/PILOT_SETUP.md که این دو را محدودیت شناخته‌شده اعلام کند، رفتار کاربر را توضیح دهد و پرسش «ایمیل تأیید حذف لازم است؟» را برای مالک محصول ثبت کند.
محدودیت‌ها: فقط سند؛ قابلیت تازه نساز؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول متن را نشان بده و منتظر تأیید بمان.
معیار پذیرش: [ ] بخش اضافه شده و با رفتار کد می‌خواند.
پایان: نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```
## ۸. برنامهٔ اصلاح دسته‌ای

هر دسته یک branch و یک PR است. ترتیب پیشنهادی همان شمارهٔ دسته‌هاست. دسته‌هایی که فایل مشترک ندارند، می‌توانند هم‌زمان اجرا شوند. طبق سیاست CI کم‌مصرف، پیش از PR باید `pnpm verify` اجرا شود، و برای UI هم `pnpm test:e2e`. CI روی شاخهٔ کاری اجرا نمی‌شود.

| دسته | یافته‌ها | فایل‌های احتمالی | وابستگی و هم‌زمانی |
|---|---|---|---|
| ۱. پشتیبان و بازیابی | OPS-01، PRD-02، OPS-07 | `packages/core/src/ops/backups.ts`، `packages/core/src/proc/*`، `apps/web/src/server/jobs.ts`، `docs/runbooks/BACKUP_RESTORE.md` | فوری. با دستهٔ ۲ در `jobs.ts` مشترک است، پس اول این ادغام شود. |
| ۲. سخت‌سازی امنیتی | SEC-01، SEC-02، SEC-03، SEC-06، SEC-09، SEC-10 | `apps/web/src/server/auth/return-path.ts`، `api.ts`، `next.config.ts`، فایل‌های spike، `routes.ts`، `jobs.ts`، `pdf-preparer.ts`، `help/[id]/page.tsx`، `workspace.ts` | پس از دستهٔ ۱. با ۴ تا ۹ هم‌زمان‌پذیر است. |
| ۳. پایش و ایمنی انتشار | OPS-02، OPS-05، PERF-05، PRD-01، PRD-03 | `packages/core/src/plt/log.ts`، `plt/jobs.ts`، `api/health/route.ts`، `ops/admin-read.ts`، `ui/admin/SystemScreens.tsx`، `tools/legal/build.ts`، migration تازه | پس از دستهٔ ۱، چون از سازوکار هشدار آن استفاده می‌کند. |
| ۴. مسیر زبان‌آموز | UX-01، UX-02، UX-03، UX-07، UX-09، UX-10، UX-11، UX-12، UX-13، UX-14، UI-05، A11Y-03، PRD-04 | `SignIn.tsx`، `record/page.tsx`، `RecordingView.tsx`، `CardEditor.tsx`، `CardsView.tsx`، `ReviewView.tsx`، `ProfileSettings.tsx`، `session-state.ts`، `PrivacyView.tsx`، `deletion/page.tsx`، `me/quota/page.tsx`، `NoteView.tsx`، `material-page.tsx`، `layout.tsx` | متن تازه تأیید مالک را لازم دارد. با دسته‌های ۲، ۳ و ۸ هم‌زمان‌پذیر است. |
| ۵. متن و اصطلاحات | UX-04، UX-05، UX-06 | `apps/web/src/ui/workspace/*`، `strings.ts`، `*-copy.ts`، صفحه‌های `sessions`، `courses` و `me` | پس از تصمیم ۷ و پس از دستهٔ ۴، چون فایل‌ها مشترک‌اند. |
| ۶. token و دسترس‌پذیری | UI-01، UI-02، UI-03، UI-04، UI-06، A11Y-01، A11Y-02، A11Y-04، A11Y-05، UX-08، QUA-08 | `app.css`، CSS Moduleها، `AppShell`، `(app)/layout.tsx`، `CardEditor.tsx`، `study-render.ts`، `e2e/helpers.ts` | پس از دستهٔ ۴ (`RecordingView` و `ReviewView`). A11Y-01 تصمیم ۸ را لازم دارد. |
| ۷. کارایی | PERF-01، PERF-02، PERF-03، PERF-04، PERF-06، PERF-07 | `automatic-learning.ts`، `processing-jobs.ts`، `next.config.ts`، `srs/review.ts`، `auth/gateway.ts`، `today/page.tsx`، `exports.ts`، `quota/costs.ts`، migration index | PERF-06 پس از دستهٔ ۵ (`strings.ts`). بقیه با دسته‌های ۴ و ۶ هم‌زمان‌پذیرند. |
| ۸. build و ابزار | OPS-06، OPS-08، OPS-12، QUA-02، QUA-03، OPS-09، OPS-11 | `tools/voice/*`، `apps/web/tools/*`، `tools/db-apply/plan.ts`، `pnpm-workspace.yaml`، `.env.example`، `README.md`، `docs/runbooks/*`، `docs/ops/*` | مستقل است و با همه هم‌زمان‌پذیر. |
| ۹. تصمیم‌محور | SEC-04، SEC-05، OPS-03، OPS-04، OPS-10، SEC-07، SEC-08، PRD-05، PRD-06 | `CardFace.tsx`، `study-render.ts`، `.claude/settings.json`، runbookها، `ci.yml`، migration نگهداری، اسناد حقوقی | هر مورد فقط پس از تصمیم مربوط در بخش ۱۰ اجرا شود. |
| ۱۰. بازآرایی | QUA-01، QUA-04، QUA-05، QUA-06، QUA-07، QUA-09 | `packages/core/src/proc/worker.ts` و `proc/steps/*`، `*-routes.ts`، exportهای core، `artifacts/` | آخر از همه، بعد از دسته‌های ۱ و ۷، چون فایل‌های proc مشترک‌اند. |

### پرامپت دستهٔ ۱ — پشتیبان و بازیابی

```text
یافته‌های OPS-01، PRD-02 و OPS-07 (ممیزی 2026-10-18) را در یک دسته رفع کن.
روی branch تازهٔ fix/audit-backup-recovery کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- OPS-01: پشتیبان روزانه فقط با Task Scheduler روی لپ‌تاپ مالک ساخته می‌شود و از 2026-10-16 سه روز پیاپی شکست خورده؛ هیچ هشداری نیست و maintainDatabaseBackups در packages/core/src/ops/backups.ts:273-290 هر نسخهٔ منقضی، حتی آخرین ready، را حذف می‌کند.
- PRD-02: sweepJobs در packages/core/src/plt/jobs.ts:285-292 job پردازش lease-منقضی را در آخرین تلاش بی‌اجرای handler failed می‌کند؛ Run در proc.processing_run و رزرو سهمیه هرگز تسویه نمی‌شوند؛ Cancel در ProcessingView در production نصب نشده و createProcessingRun برای Run فعال conflict می‌دهد.
- OPS-07: docs/runbooks/BACKUP_RESTORE.md با محل واقعی کلید پشتیبان (Vercel production و DPAPI) و نبود نسخهٔ مستقل آفلاین ناسازگار است.
هدف: (۱) نگه‌داشتن همیشگی آخرین ۳ پشتیبان ready؛ (۲) هشدار کهنگی بیش از ۳۰ ساعت با لاگ backup_stale و وظیفهٔ ادمین بدون تکرار؛ (۳) job تطبیق که Runهای processing/queued با job failed را با مسیر شکست worker ببندد (settleAllowance صفر، اعلان)، idempotent؛ (۴) runbook با RPO پایلوت، روال بررسی هفتگی، محل کلیدها و مدل تهدید.
محدودیت‌ها: هیچ سرویس یا پلن پولی تازه (ADR-0001)؛ مسیر پولی: هیچ کسر سهمیه‌ای، فقط آزادسازی؛ تغییر schema فقط با migration و pnpm db:types؛ روی دیتابیس ابری چیزی ننویس؛ کمترین تغییر لازم؛ پیروی از الگوی jobهای موجود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. برای هر بخش اول آزمون integration بنویس که مشکل را نشان دهد.
معیار پذیرش: [ ] ۳ نسخهٔ ready آخر پاک نمی‌شوند [ ] هشدار کهنگی یک بار ساخته می‌شود [ ] Run گیرکرده بسته و رزروش آزاد می‌شود و پردازش دوباره ممکن است [ ] runbook به‌روز است [ ] pnpm verify سبز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن، فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن و به مالک محصول یادآوری کن علت شکست task ویندوز را بررسی و یک پشتیبان دستی و تمرین بازیابی اجرا کند.
```

### پرامپت دستهٔ ۲ — سخت‌سازی امنیتی

```text
یافته‌های SEC-01، SEC-02، SEC-03، SEC-06، SEC-09 و SEC-10 (ممیزی 2026-10-18) را در یک دسته رفع کن.
روی branch تازهٔ fix/audit-security-hardening کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- SEC-01: safeReturnPath (apps/web/src/server/auth/return-path.ts:5-16) ورودی "/..//evil.com" را به "//evil.com" تبدیل می‌کند و redirect پس از ورود به دامنهٔ خارجی می‌رود.
- SEC-02: مسیر SPIKE-05 (apps/web/src/app/dev/spike/[action]، apps/web/src/server/spike.ts، spike-jobs.ts، packages/core/src/plt/spike.ts، ROUTES.spike، spikeJobDefinitions، ورودی "/dev/spike/**" در next.config.ts) با actor "system" در build تولید مانده؛ T6 انجام نشده.
- SEC-03: هیچ X-Frame-Options/frame-ancestors، Referrer-Policy، Permissions-Policy و nosniff فرستاده نمی‌شود (apps/web/next.config.ts).
- SEC-06: getDocument در apps/web/src/server/pdf-preparer.ts:146-158 بدون isEvalSupported: false.
- SEC-09: apps/web/src/app/(app)/help/[id]/page.tsx:18 شناسه را اعتبارسنجی نمی‌کند (۵۰۰ به‌جای ۴۰۴) و found() در apps/web/src/server/workspace.ts:31-38 سیگنال ownership_denied را ثبت نمی‌کند.
- SEC-10: pnpm audit یک High در source-map-js (<1.2.2) دارد؛ S1 در docs/plans/RELEASE_SECURITY_REVIEW_2026-10-12.md رفع شده ولی باز نشان داده می‌شود.
هدف: next پس از نرمال‌سازی فقط مسیر داخلی؛ redirectTo فقط هم‌origin برای مسیر نسبی؛ حذف کامل spike (بررسی voice-runtime در صورت نیاز به route کوچک مستقل منتقل شود)؛ هدرهای X-Frame-Options: DENY، CSP frame-ancestors 'none'; object-src 'none'; base-uri 'self'، Referrer-Policy: strict-origin-when-cross-origin، X-Content-Type-Options: nosniff، Permissions-Policy: camera=(), geolocation=(), microphone=(self)؛ isEvalSupported: false؛ ۴۰۴ و ثبت رخداد امنیتی در صفحه‌ها؛ source-map-js ≥1.2.2 با pnpm.overrides؛ بستن S1 در سند.
محدودیت‌ها: ضبط با میکروفون، فریم جزوه با sandbox و ورود Google سالم بمانند؛ تنظیمات Vercel را تغییر نده (حذف env های RECALINO_SPIKE و SPIKE_TOKEN را در گزارش به مالک یادآوری کن)؛ نسخهٔ next را بدون تأیید ارتقا نده؛ کمترین تغییر لازم؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه و فهرست فایل‌هایی را که حذف یا تغییر می‌کنند بگو و منتظر تأیید بمان. برای هر یافته اول آزمون شکست‌خورده بنویس. برای هدرها screenshot صفحهٔ ضبط و جزوه در ۳۷۵ و ۱۴۴۰ قبل و بعد.
معیار پذیرش: [ ] آزمون‌های return-path با /..//evil.com و مشابه‌ها /today می‌دهند [ ] grep spike در apps و packages جز route جایگزین خالی است [ ] هدرها روی /، /today، /admin و /api/health هستند [ ] pnpm audit --prod بدون High [ ] /help/abc → 404 [ ] pnpm verify، pnpm build و pnpm test:e2e سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته، حذف یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### پرامپت دستهٔ ۳ — پایش و ایمنی انتشار

```text
یافته‌های OPS-02، OPS-05، PERF-05، PRD-01 و PRD-03 (ممیزی 2026-10-18) را در یک دسته رفع کن.
روی branch تازهٔ fix/audit-observability کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- OPS-02: /api/health ثابت است، خطای 500 فقط error_name لاگ می‌شود (apps/web/src/server/api.ts:144-151، packages/core/src/plt/log.ts)، شکست job و کهنگی runner هشدار ندارند و پنل ادمین سلامت را نشان نمی‌دهد.
- OPS-05: کد با ادغام زنده می‌شود و migration بعداً؛ runner روی schema عقب‌افتاده job اجرا می‌کند.
- PERF-05: فراخوانی‌های Vercel Blob در packages/core/src/plt/storage-vercel-blob.ts:64,85,94,140 timeout ندارند.
- PRD-01: متن‌های حقوقی draft (apps/web/src/legal/texts.generated.ts) بی‌گارد build در production منتشر می‌شوند.
- PRD-03: پنل ادمین گام‌های قیف پایلوت و درخواست حذف needs_operator را نشان نمی‌دهد (packages/core/src/ops/admin-read.ts:463-470، ops.admin_task).
هدف: error_location و cause_code مجاز در لاگ (بدون متن)؛ job ساعتی ops.health_check با اندازهٔ دیتابیس، jobهای failed، قدیمی‌ترین صف و سن runner و ساخت وظیفهٔ ادمین بی‌تکرار؛ /api/health?deep=1 با bearer CRON_SECRET؛ runner با schema عقب‌افتاده claim نکند و schema_behind لاگ کند (ثابت نسخه در build)؛ timeout قابل تنظیم Blob و خطای retryable storage_timeout؛ گارد build برای متن حقوقی draft در production مگر RECALINO_ALLOW_DRAFT_LEGAL=1؛ view فقط‌تاریخ/شمار برای گام‌های قیف (فقط اگر مالک تصمیم ۹ را تأیید کرده) و شاخهٔ needs_operator در ops.admin_task.
محدودیت‌ها: هیچ سرویس پولی یا analytics شخص ثالث؛ PRD-PRIV-06 (بدون متن کلاس، ایمیل یا کلید در لاگ)؛ تغییر schema فقط با migration؛ build production فعلی نشکند: در گزارش به مالک بگو پیش از ادغام RECALINO_ALLOW_DRAFT_LEGAL=1 را آگاهانه تنظیم کند یا G11 را ببندد؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. برای هر بخش اول آزمون بنویس. screenshot کارت سلامت و ستون‌های قیف در پنل ادمین در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] آزمون‌های لاگ، health، schema_behind، storage_timeout، گارد حقوقی و view سبز [ ] /api/health بی‌پارامتر همان پاسخ قبلی [ ] pnpm verify و pnpm test:e2e سبز.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### پرامپت دستهٔ ۴ — مسیر زبان‌آموز

```text
یافته‌های UX-01، UX-02، UX-03، UX-07، UX-09، UX-10، UX-11، UX-12، UX-13، UX-14، UI-05، A11Y-03 و PRD-04 (ممیزی 2026-10-18) را در یک دسته رفع کن.
روی branch تازهٔ fix/audit-learner-flow کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- UX-01: apps/web/src/app/SignIn.tsx:54-57 متن کهنهٔ «coming next in the pilot» دارد.
- UX-02: صفحهٔ ضبط (apps/web/src/app/(app)/sessions/[id]/record/page.tsx:8-16) داخل پوسته با ناوبری است؛ طرح «full-screen focus mode, no nav» می‌خواهد.
- UX-03: Delete card (apps/web/src/ui/workspace/CardEditor.tsx:186-195) و Reject (CardsView.tsx:137-146) بی‌تأیید و بی‌Undo هستند.
- UX-07: Terms و Privacy پس از ورود در /me در دسترس نیستند (apps/web/src/app/(app)/me/ProfileSettings.tsx:66-93).
- UX-09: «Review account setup» برای acceptance_required به /setup می‌رود که به /today برمی‌گرداند (apps/web/src/ui/workspace/session-state.ts:402).
- UX-10: /deletion پس از حذف موفق «Finish deletion» نشان می‌دهد و Sign out ندارد (apps/web/src/server/auth/learner.ts:27-44، PrivacyView.tsx:140-157).
- UX-11: حین ضبط role="alert" برای شکست sync و KB/تاریخ خام نمایش داده می‌شود (apps/web/src/ui/recording/RecordingView.tsx:341-366).
- UX-12: متن سهمیه از تأیید برآورد می‌گوید؛ نشان due هرگز داده نمی‌شود (LearnerShell.tsx:76)؛ حالت خالی مرور یکی است؛ NoteView «AI expansion» به‌جای strings.provenance.
- UX-13: پس از Stop، Next step وسط صفحهٔ material و تیک حقوق قفل است؛ انتظار پردازش برآورد ندارد.
- UX-14: /me/data به دانلود پیوند ندارد.
- UI-05: دکمه‌های تأیید حذف primary هستند به‌جای variant danger.
- A11Y-03: «Show answer» در apps/web/src/ui/workspace/ReviewView.tsx:279-283 unmount می‌شود و فوکوس گم می‌شود.
- PRD-04: صفحهٔ ورود noindex ندارد (apps/web/src/app/layout.tsx:10-21).
هدف: هر مشکل با کامپوننت‌ها و tokenهای موجود و مطابق قاب‌های docs/design/handoff-r1 رفع شود؛ متن تازه فقط از handoff copy.md یا پس از تأیید مالک و ثبت در docs/design/UI_COPY_PENDING.md.
محدودیت‌ها: PRD-REC-02 (هیچ قطع یا هشدار حین ضبط جز خرابی واقعی؛ «ذخیره شد» فقط پس از ثبت معتبر)؛ منطق حذف حساب و پردازش تغییر نکند؛ اگر صفحه یا حالتی در طرح نیست، پیش از ساخت بپرس؛ پیش از کار UI، docs/design/handoff-r1/HANDOFF.md بخش ۰ و docs/design/HANDOFF_R1_REVIEW.md را بخوان؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه، فهرست فایل‌ها و جدول متن‌های تازه را بگو و منتظر تأیید بمان. برای هر یافته اول آزمون (واحد یا Playwright) بنویس. screenshot قبل و بعد هر صفحهٔ متأثر در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] معیار پذیرش هر یافته برقرار است [ ] strings.test.ts، vendor.test.ts و axe سبزند [ ] pnpm verify و pnpm test:e2e سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### پرامپت دستهٔ ۵ — متن و اصطلاحات

```text
یافته‌های UX-04، UX-05 و UX-06 (ممیزی 2026-10-18) را در یک دسته رفع کن.
روی branch تازهٔ fix/audit-copy-terminology کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- UX-04: apps/web/src/ui/workspace/api.ts:53-66 خطای شبکه را نمی‌گیرد و حدود ۳۵ محل در apps/web/src/ui/workspace failure.message خام (مثل «Failed to fetch» یا پیام idempotency) نشان می‌دهند.
- UX-05: enumهای خام و اصطلاحات داخلی در رابط: CardsView.tsx:129-131، ReviewView.tsx:210-213,243-248، PrivacyView.tsx:111-112، session-state.ts:403-407، api.ts:114-115.
- UX-06: تب Courses به /sessions و سطر Courses در /me به /courses؛ دو «View courses» به دو مقصد؛ دو صفحه با عنوان یکسان «Keep your sessions organised»؛ class/session/lesson و material/sources به‌جای هم.
هدف: تابع userMessage(failure) با نگاشت کد به متن‌های موجود و پیام اتصال برای خطای شبکه؛ برچسب‌های انسانی به‌جای enum؛ اعمال واژه‌نامهٔ مصوب مالک محصول (تصمیم ۷ گزارش؛ اگر تصویب نشده فقط بخش‌های مستقل از واژه‌نامه و جدول پیشنهادی در UI_COPY_PENDING).
محدودیت‌ها: هیچ متن تازه بدون تأیید روی رابط نرود؛ strings.test.ts و منشأ متن رعایت شود؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول جدول «محل، متن فعلی، متن پیشنهادی، منشأ» را نشان بده و منتظر تأیید بمان. آزمون واحد userMessage و Playwright offline؛ screenshot قبل و بعد صفحه‌های متأثر در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] offline پیام اتصال نشان می‌دهد [ ] grep enum خام و واژه‌های provider|queued|server cleanup در ui بیرون از admin خالی است [ ] هیچ دو صفحه PageHeader یکسان ندارند [ ] pnpm verify و pnpm test:e2e سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### پرامپت دستهٔ ۶ — token و دسترس‌پذیری

```text
یافته‌های UI-01، UI-02، UI-03، UI-04، UI-06، A11Y-01، A11Y-02، A11Y-04، A11Y-05، UX-08 و QUA-08 (ممیزی 2026-10-18) را در یک دسته رفع کن.
روی branch تازهٔ fix/audit-ui-a11y کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- UI-01: [data-theme] .btn-secondary در apps/web/src/ui/styles/app.css:71-74 hover و active لایهٔ پایه را خنثی می‌کند.
- UI-02: font-size 10/11px در apps/web/src/ui/shell/AppShell.module.css:81,225 زیر --rc-text-xs و حدود ۶۰ مقدار خام 13/15/18px.
- UI-03: دکمه‌های ضبط ۵۲px به‌جای --rc-target-lg (۷۲px).
- UI-04: سایهٔ خام rgb(0 0 0 / …)، padding-left در Sheet و LegalDocument، حلقهٔ focus 3px در preview.css، ۱۸ الگوی @media.
- UI-06: SegmentedControl کوچک ۴۰px.
- A11Y-01: --rc-border-strong #8c9c91 و مرز .input کمتر از ۳:۱ در تم روشن (فقط با رنگ مصوب مالک؛ تصمیم ۸).
- A11Y-02: textareaهای CardEditor.tsx:117-132 و پاسخ listening بی‌dir؛ packages/core/src/lkm/study-render.ts:46-56 در جزوهٔ فارسی lang بلوک‌ها را حذف می‌کند.
- A11Y-04: heading-order در /preview/cards، card-types و legal؛ axe e2e فقط تم روشن.
- A11Y-05: alt عمومی در ReviewView.tsx:118-122 و CardMedia.tsx:211-215.
- UX-08: پوسته در هر صفحه رندر می‌شود و loading ریشه کل صفحه و منو را برمی‌دارد.
- QUA-08: کد production از ui/preview/preview.css، primitiveهای ui/preview و کلاس preview-* استفاده می‌کند.
هدف: رفع هر مورد فقط با tokenهای موجود (یا tokenهای لایهٔ بازطراحی که یک بار در app.css ثبت و تأیید شوند)؛ پوستهٔ ثابت هنگام ناوبری؛ جداسازی استایل workspace از preview بدون تغییر ظاهر.
محدودیت‌ها: vendor و token‌های پایه کپی‌شده تغییر نکنند (vendor.test.ts)؛ رنگ، فونت، سایه یا انیمیشن تازه اضافه نکن؛ هرگز web font اضافه نکن؛ مقدار A11Y-01 بدون تأیید صریح مالک انتخاب نشود؛ مستندات Next در node_modules/next/dist/docs را برای layout/loading بخوان؛ پیش از هر جابه‌جایی یا تغییر نام فایل، فهرست را نشان بده و تأیید بگیر.
روش: اول برنامه و جدول نگاشت‌ها را بگو و منتظر تأیید بمان. screenshot قبل و بعد پوسته، /today، /review، /sessions/<id>، /me، صفحهٔ ضبط و /dev/ui در ۳۷۵، ۷۶۸ و ۱۴۴۰، تم روشن و تیره.
معیار پذیرش: [ ] معیار پذیرش هر یافته برقرار است [ ] screenshotها جز موارد هدف یکسان‌اند [ ] axe روی ۴۹ قاب preview و چهار صفحهٔ تم تیره سبز است [ ] pnpm verify و pnpm test:e2e سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته، جابه‌جاشده یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### پرامپت دستهٔ ۷ — کارایی

```text
یافته‌های PERF-01، PERF-02، PERF-03، PERF-04، PERF-06 و PERF-07 (ممیزی 2026-10-18) را در یک دسته رفع کن.
روی branch تازهٔ fix/audit-performance کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- PERF-01: today/page.tsx از راه automatic-learning.ts:61 به processing-jobs، audio-preparer (ffmpeg-static) و pdf-preparer (canvas) ایستا import می‌کند؛ الگوی "/*" در next.config.ts منابع بومی را به تقریباً همهٔ Functionها می‌برد.
- PERF-02: packages/core/src/srs/review.ts:277-278 برای هر کارت listening یک کوئری سریالی media.asset می‌زند.
- PERF-03: apps/web/src/server/auth/gateway.ts:50-52 در هر درخواست getUser (HTTP به Supabase Auth) بی‌timeout اجرا می‌کند.
- PERF-04: Today حدود ۴۰ کوئری؛ N+1 در html/anki exports و پیوند منابع؛ جمع هزینه در JS (quota/costs.ts:120-131).
- PERF-06: zod کامل و کل strings.ts در chunk مشترک (app)/today.
- PERF-07: FKهای پرمصرف بی‌index (advisor) و سقف هم‌زمانی ثبت‌نشدهٔ runner.
هدف: import پویای preparerها و محدودکردن tracing به /api/jobs/run و مسیرهای پردازش؛ بارگذاری دسته‌ای media؛ getClaims با بررسی امضا به‌جای getUser و fetch با timeout ۵ ثانیه؛ readerهای تجمعی و aggregate؛ zod/mini و شکستن strings.ts به ماژول‌های حوزه؛ migration index برای FKهای داغ و ثبت سقف هم‌زمانی در ADR.
محدودیت‌ها: رفتار و خطاها تغییر نکنند؛ مالکیت در همهٔ کوئری‌ها؛ امنیت نشست کم نشود؛ هیچ متن رابط تغییر نکند؛ تغییر schema فقط با migration و pnpm db:types؛ هر بخش در commit جدا؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. پیش و پس از هر بخش اندازه‌گیری کن (شمارش ورودی‌های بومی در .nft.json، شمار کوئری با log Kysely، اندازهٔ chunkها) و جدول مقایسه بده.
معیار پذیرش: [ ] trace صفحه‌های (app) بدون ffmpeg/sherpa/canvas [ ] شمار کوئری صف مرور مستقل از تعداد کارت و Today با ۱۰ جلسه ≤ ۸ [ ] بدون فراخوانی /auth/v1/user در مسیر عادی [ ] کاهش ≥۱۰۰KB در chunk مشترک [ ] pnpm verify، pnpm build و pnpm test:e2e سبز.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### پرامپت دستهٔ ۸ — build و ابزار

```text
یافته‌های OPS-06، OPS-08، OPS-12، QUA-02، QUA-03، OPS-09 و OPS-11 (ممیزی 2026-10-18) را در یک دسته رفع کن.
روی branch تازهٔ fix/audit-build-tooling کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- OPS-06: tools/voice/fetch-models.mjs:25-28 مدل‌ها را بی‌timeout و retry دانلود می‌کند و نگهبان اندازهٔ Function (نزدیک ۲۵۰MB) نیست.
- OPS-08: tools/db-apply/plan.ts:37 اسکن data-loss داخل do $$ … $$ را نمی‌بیند.
- OPS-12: pnpm-workspace.yaml minimumReleaseAgeExclude دارد ولی minimumReleaseAge ندارد.
- QUA-02: .env.example حدود ۱۲ نام خوانده‌شده در کد و docs/runbooks/SECRETS.md بیشتر اسرار تولید را ندارند.
- QUA-03: README ریشه نیست و apps/web/AGENTS.md فقط بلوک خودکار Next را دارد.
- OPS-09: setup script در docs/ops/CLOUD_ENVIRONMENT_FA.md خطا را با || true پنهان می‌کند و checksum ندارد.
- OPS-11: پیکربندی Auth ابری فقط در داشبورد است و supabase/config.toml مقادیر localhost دارد.
هدف: timeout ۱۲۰ ثانیه و ۳ تلاش با backoff و cache مدل‌ها؛ نگهبان اندازه با آستانهٔ ۲۲۵MB؛ اسکن dollar-quoted؛ cooldown فعال یا حذف فهرست (طبق تصمیم مالک؛ پیش‌فرض فعال‌سازی 1440)؛ .env.example کامل با آزمون مقایسهٔ process.env؛ SECRETS.md با روال چرخش هر secret؛ README کوتاه؛ script سخت‌گیر با sha256 و corepack؛ سند CLOUD_AUTH_CONFIG.md و هشدار «supabase config push فقط با اجازه».
محدودیت‌ها: هیچ مقدار secret ننویس؛ manifest و checksum مدل‌ها را تغییر نده؛ lockfile تغییر نکند مگر لازم و توضیح‌داده‌شده؛ تنظیمات ابری و environment را خودت تغییر نده؛ CI را تغییر نده؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول برنامه را بگو و منتظر تأیید بمان. آزمون node:test یا vitest برای retry/timeout، نگهبان اندازه، اسکن data-loss و مقایسهٔ env.
معیار پذیرش: [ ] آزمون‌های تازه سبز [ ] pnpm install --frozen-lockfile، pnpm build و pnpm verify سبز [ ] اسناد بدون secret.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### پرامپت دستهٔ ۹ — موارد وابسته به تصمیم

```text
یافته‌های SEC-04، SEC-05، OPS-03، OPS-04، OPS-10، SEC-07، SEC-08، PRD-05 و PRD-06 (ممیزی 2026-10-18) را فقط در حدی که مالک محصول تصمیمشان را گرفته رفع کن.
روی branch تازهٔ fix/audit-decisions کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- SEC-04: کارت‌های lesson_html و جزوه فونت را از fonts.googleapis.com می‌گیرند (apps/web/src/ui/workspace/CardFace.tsx:61-64، packages/core/src/lkm/study-render.ts:59-69، CSP در class-notes-pronunciation.ts:188) و متن حقوقی آن را اعلام نمی‌کند.
- SEC-05: .claude/settings.json اجرای execute_sql، db push و pnpm db:apply با هر آرگومان را بی‌پرسش مجاز می‌کند.
- OPS-03: Preview در Vercel همان اسرار پایلوت را دارد؛ CLOUD_SETUP.md:90 و SECRETS.md:48 با Q-SPEC-1 (PROJECT_SPEC.md:214) تناقض دارند.
- OPS-04: استقرار production بی‌توجه به CI است.
- OPS-10: build تکراری در ci.yml:80,112 و نبود dependabot.
- SEC-07: نبود نگهداری محدود برای plt.security_event و plt.audit_event.
- SEC-08: رویهٔ پاسخ به درخواست دسترسی به داده مستند نیست.
- PRD-05: M5_MVP_COMPLETION.md:51 و privacy-notice.md:122 با config و کد نمی‌خوانند.
- PRD-06: ایمیل تراکنشی خودکار و صفحهٔ آفلاین PWA نیست.
هدف: برای هر مورد فقط گزینه‌ای که مالک محصول در بخش «تصمیم‌های لازم» گزارش ممیزی یا در گفت‌وگو تأیید کرده؛ برای موردی که تصمیم ندارد، هیچ تغییری نده و در گزارش پایانی بنویس منتظر کدام تصمیم است.
محدودیت‌ها: تنظیمات Vercel، GitHub و Supabase را خودت تغییر نده (فقط سند و چک‌لیست)؛ .claude/settings.json و ci.yml فقط با تأیید صریح؛ متن حقوقی بدون تأیید صریح و بدون وعدهٔ تازه تغییر نکند؛ هرگز web font اضافه نکن؛ پیش از حذف، بازنویسی یا تغییر نام هر فایل موجود، تغییر را نشان بده و تأیید بگیر.
روش: اول بپرس برای هر مورد کدام گزینه تأیید شده، سپس برنامه و فهرست فایل‌ها را بگو و منتظر تأیید بمان. برای کد، اول آزمون؛ برای UI، screenshot قبل و بعد در ۳۷۵ و ۱۴۴۰.
معیار پذیرش: [ ] معیار پذیرش هر یافتهٔ اجراشده برقرار است [ ] موارد بی‌تصمیم دست نخورده و فهرست شده‌اند [ ] pnpm verify (و برای UI pnpm test:e2e) سبز است.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

### پرامپت دستهٔ ۱۰ — بازآرایی

```text
یافته‌های QUA-01، QUA-04، QUA-05، QUA-06، QUA-07 و QUA-09 (ممیزی 2026-10-18) را بدون تغییر رفتار در یک دسته رفع کن.
روی branch تازهٔ fix/audit-refactor کار کن و پیش از باز کردن PR همهٔ بررسی‌ها را محلی اجرا کن.
مشکل‌ها:
- QUA-01: packages/core/src/proc/worker.ts:864-2250 یک closure حدوداً ۱٬۴۰۰ خطی همهٔ مراحل پردازش را دارد.
- QUA-04: helperهای actor و key در ۱۱ فایل apps/web/src/server/*-routes.ts کپی شده‌اند، با دو رفتار متفاوت برای کلید.
- QUA-05: snapshotهای JSONB در html/exports.ts، anki/exports.ts، card/cards.ts:604 و srs/review.ts:346,498 با as unknown as خوانده می‌شوند.
- QUA-06: هفت تابع export‌شده بی‌مصرف‌اند (automatic-learning-notifications.ts:33، quota/ledger.ts:403، org/sessions.ts:181,384، priv/deletion.ts:93، support/email.ts:394,575).
- QUA-07: پوشهٔ «claude promps/» با نام غلط و artifacts/recalino-presentation/.build/ در ردیابی git.
- QUA-09: lockAccount پارامتر Database | Tx می‌گیرد؛ pricing.ts:120-123 تقسیم را پیش از ضرب انجام می‌دهد.
هدف: مراحل proc در packages/core/src/proc/steps/* با امضای یکسان و run به‌عنوان orchestrator کوتاه؛ learnerActor و idempotencyKey مشترک در api.ts؛ schemaهای zod برای snapshotها؛ حذف یا مستندسازی توابع بی‌مصرف؛ انتقال پوشهٔ مرجع به docs/design/reference-output/ و حذف .build از ردیابی؛ محدودکردن lockAccount به Tx و گردکردن integer در pricing.
محدودیت‌ها: صفر تغییر رفتار در پردازش، checkpointها، idempotency و تسویهٔ سهمیه؛ هر استخراج در commit جدا با آزمون سبز؛ اگر pricing نتیجهٔ آزمونی را تغییر داد، توقف و پرسش (اثر مالی)؛ تاریخچهٔ git بازنویسی نشود؛ پیش از هر حذف، git mv یا git rm --cached فهرست را نشان بده و تأیید بگیر.
روش: اول نقشهٔ مراحل worker.ts و ترتیب کار را بگو و منتظر تأیید بمان. پیش از هر استخراج، آزمون characterization اگر نیست.
معیار پذیرش: [ ] هیچ تابع proc بیش از حدود ۳۰۰ خط نیست [ ] هیچ as unknown as روی ستون DB در core نیست [ ] grep "claude promps" خالی است [ ] pnpm verify، check:boundaries و e2e پردازش سبزند.
پایان: lint، typecheck و تست‌ها را محلی اجرا کن، نتیجه را خلاصه کن و فایل‌های ساخته، حذف، جابه‌جا یا تغییرداده‌شده را با مسیرشان فهرست کن.
```

## ۹. نقاط قوت

- **کنترل دسترسی سمت سرور یکپارچه است.** همهٔ ۷۰ route در یک registry ثبت‌اند، و آزمون پوشش برای هر route زبان‌آموز آزمون عبور از حساب را اجباری می‌کند. در دو گذر مستقل هیچ IDOR پیدا نشد.
- **RLS به شکل «deny-all» پیاده شده است.** هیچ schema جز `public` در PostgREST نیست، و نقش‌های مرورگر هیچ دسترسی‌ای ندارند.
- **wrapper مشترک `defineRoute` چند کنترل را یکجا اعمال می‌کند:** CSRF با `Sec-Fetch-Site`، rate limit با IP هش‌شده، idempotency، کش `private, no-store` و لاگ allow-list.
- **خروجی AI همیشه با `json_schema strict` و zod اعتبارسنجی می‌شود.** prompt منبع کلاس را «untrusted DATA» اعلام می‌کند. جزوه در iframe با sandbox و CSP nonce رندر می‌شود و HTML کارت allowlist سخت دارد.
- **Blob خصوصی است** و لینک‌ها ۳۰۰ ثانیه عمر دارند. آرگومان‌های ffmpeg ثابت‌اند، و sharp با `limitInputPixels` اجرا می‌شود.
- **هیچ secret واقعی در کد یا تاریخچهٔ git نیست**، و `check:client-bundle` سبز است.
- **کیفیت پایهٔ کد بالاست:**
  - صفر `any` و صفر `@ts-ignore`؛
  - ۳٬۵۳۲ آزمون واحد سبز؛
  - مرز ماژول‌ها با dependency-cruiser؛
  - نسخه‌های دقیق و actionهای pin‌شده به SHA.
- **CI دقیقاً با سیاست کم‌مصرف مالک می‌خواند:** trigger، e2e با برچسب، concurrency و paths-ignore.
- **رابط در ۴۹ صفحهٔ نمونه، در ۳۷۵ و ۱۴۴۰ پیکسل، سالم بود:** بی‌اسکرول افقی، بی‌خطای console، تم تیره سالم، حلقهٔ focus پیدا، skip link موجود، و فقط یک قاعدهٔ axe از نوع moderate.
- **migrationهای ابری دقیقاً با مخزن برابرند** (۵۱ مورد).

## ۱۰. تصمیم‌های لازم از مالک محصول

1. **راهبرد پشتیبان** (OPS-01 و OPS-07)
   - **A:** لپ‌تاپ بماند و هشدار کهنگی سرور و نگهداری ۳ نسخهٔ آخر اضافه شود. هزینه ندارد و ریسک وابستگی به PC می‌ماند.
   - **B:** workflow زمان‌بندی‌شدهٔ GitHub Actions برای `pg_dump` رمزشده به Blob. دقیقهٔ Actions مصرف می‌کند و بیرون از الگوی CI کم‌مصرف است.
   - **C:** Supabase Pro با پشتیبان خودکار. هزینهٔ ماهانه دارد و ADR-0001 را تغییر می‌دهد.
   - **پیشنهاد:** A همین حالا، و B یا C پیش از ورود اولین زبان‌آموز غیرمالک.
2. **فونت جزوه و کارت** (SEC-04)
   - **A:** حذف فونت Google و استفاده از فونت سیستم. با CLAUDE.md و D-log سازگار است، ولی ظاهر کمی با نمونهٔ مرجع فرق می‌کند.
   - **B:** self-host زیرمجموعهٔ Vazirmatn و Lora. حریم خصوصی حفظ می‌شود، ولی قاعدهٔ «هرگز web font» نقض می‌شود و ثبت تصمیم نسخه‌دار لازم است.
   - **C:** نگه داشتن و اعلام Google در متن حقوقی و دفتر پردازشگران.
   - **پیشنهاد:** A.
3. **مجوزهای Claude Code** (SEC-05)
   - **A:** `execute_sql`، `db push` و `db:apply --apply` به ask بروند.
   - **B:** allow بماند، به‌علاوهٔ hook `PreToolUse` که SQL مخرب را به پرسش ببرد و `--approve-data-loss` را رد کند.
   - **C:** بی‌تغییر، با پذیرش ریسک.
   - **پیشنهاد:** B. سرعت کار خواندنی حفظ می‌شود و قاعدهٔ «اجازهٔ صریح» در هارنس اعمال می‌شود.
4. **محیط Preview** (OPS-03)
   - **A:** اسرار پایلوت فقط Production باشند و preview فقط در حالت fixture ساخته شود.
   - **B:** پروژهٔ Supabase جدا برای preview. پلن رایگان دو پروژه دارد و یکی را fitness-coach گرفته است.
   - **C:** بی‌تغییر، با اصلاح Q-SPEC-1.
   - **پیشنهاد:** A، همراه چرخش و Sensitive کردن `BLOB_READ_WRITE_TOKEN`.
5. **دروازهٔ CI پیش از production** (OPS-04)
   - **A:** ruleset برای `main` با PR اجباری و check الزامی، به‌علاوهٔ Vercel Deployment Checks.
   - **B:** بی‌تغییر، با انضباط دستی.
   - **پیشنهاد:** A. با الگوی CI کم‌مصرف سازگار است، چون CI روی PR به `main` اجرا می‌شود.
6. **تغییرهای CI** (OPS-10)
   - **A:** حذف build تکراری e2e با artifact، و Dependabot فقط برای security updates.
   - **B:** فقط حذف build تکراری.
   - **C:** هیچ، و `pnpm audit` دستی ماهانه.
   - **پیشنهاد:** A. Dependabot دقیقهٔ Actions مصرف نمی‌کند و PRهایش CI می‌خورند.
7. **واژه‌نامهٔ رابط** (UX-06)
   - **A:** «session» برای جلسه، «course» برای درس و «material» برای همهٔ فایل‌ها.
   - **B:** «class» به‌جای «session».
   - **C:** وضع موجود، فقط با رفع تکرار عنوان‌ها.
   - **پیشنهاد:** A، چون با D50 و D51 و مسیر `/sessions` سازگار است.
8. **رنگ مرز کنترل‌ها** (A11Y-01)
   - **A:** تیره‌تر کردن `--rc-border-strong` در تم روشن تا دست‌کم ۳:۱.
   - **B:** فقط مرز پررنگ‌تر برای checkbox و radio، و `.input` بی‌تغییر.
   - **پیشنهاد:** A، با تأیید طراح.
9. **دیدن پیشرفت پایلوت** (PRD-03)
   - **A:** view فقط‌تاریخ و شمار در پنل ادمین، بی‌analytics.
   - **B:** گزارش دستی SQL.
   - **پیشنهاد:** A.
10. **بستن G11 و متن حقوقی ۱٫۰** (PRD-01)
    - **پیشنهاد:** پیش از دعوت اولین زبان‌آموز غیرمالک، G11 بسته شود. تا آن زمان، گارد build با پرچم صریح `RECALINO_ALLOW_DRAFT_LEGAL` فعال باشد.

## ۱۱. پیوست — پوشش

| بررسی | دستور یا روش | نتیجه |
|---|---|---|
| نصب | `pnpm install --frozen-lockfile` | موفق (Node 24.21.0، pnpm 12.4.2، env درست؛ هیچ `SUPABASE_*` در env سشن) |
| lint | `pnpm lint` | ۱٬۲۲۶ فایل، بی‌خطا |
| typecheck | `pnpm typecheck` | بی‌خطا |
| مرز ماژول‌ها | `pnpm check:boundaries` | ۱٬۳۰۵ ماژول، بی‌تخلف |
| آزمون واحد | `pnpm test:unit` | ۲۱۳ فایل و ۳٬۵۳۲ آزمون، همه سبز |
| build | `pnpm build` | موفق |
| اسرار در bundle | `pnpm check:client-bundle` | «No secrets in the client-visible build output.» |
| آسیب‌پذیری وابستگی | `pnpm audit --prod` | یک High transitive در زمان build (SEC-10) |
| وابستگی قدیمی | `pnpm outdated -r` | فقط به‌روزرسانی‌های patch و minor، مثل react 19.3.1، zod 4.6.7 و kysely 0.29.7 |
| secret در فایل‌ها و تاریخچه | `git grep` و `git log -p` با الگوهای کلید (فقط مسیر و خط) | فقط رشته‌های ساختگی آزمون و placeholder اسناد؛ هیچ `.env` commitشده‌ای نیست |
| Supabase | `list_projects`، `get_advisors` (امنیت و کارایی)، `list_migrations` و یک `select` تجمیعی روی `ops.database_backup` | پروژهٔ درست `twowhuzhvyuzjrpraikm`. هیچ نوشتنی انجام نشد |
| Vercel | `get_project`، `filter_project_envs` (فقط نام‌ها؛ هیچ مقداری decrypt نشد) و `list_deployments` | OPS-03 |
| GitHub | `search_repositories` | مخزن خصوصی |
| هدرهای production | `curl -I https://recalino.vercel.app/` | SEC-03 |
| آزمون زندهٔ UI | `next start` با `RECALINO_UI_PREVIEW=1` و Playwright با Chromium و axe 4.13 روی ۴۹ صفحه در ۳۷۵ و ۱۴۴۰، به‌علاوهٔ تم تیره و کیبورد | بی‌اسکرول افقی، بی‌خطای شبکه؛ ۲ هشدار preload CSS؛ heading-order در ۳ قاب. screenshotها در `docs/audit/2026-10-18-assets/` |
| بررسی دستی | سه reviewer و یک workflow هشت‌حوزه‌ای مستقل | ادغام‌شده در همین گزارش |
| تلاش برای رد | دو workflow با ۱۳ منتقد مستقل برای ۷ یافتهٔ High یا مرزی | High تأییدشده: ۱ (OPS-01). کاهش‌یافته: فونت Google، Preview، متن حقوقی و حلقهٔ حذف به Medium یا Low. spike در Medium ماند. Run گیرکرده Medium تأیید شد. هیچ یافته‌ای کامل رد نشد |

**بررسی‌های انجام‌نشده:**

- **آزمون‌های integration** (`pnpm test:int`) و **e2e** (`pnpm test:e2e`): Docker در این محیط ابری نیست، پس Supabase محلی بالا نمی‌آید.
- **آزمون زندهٔ مسیرهای واقعی با حساب:** حساب آزمون و Supabase محلی در دسترس نبود، و استفاده از حساب واقعی ممنوع است. UI و UX مسیرهای واقعی از روی کد سنجیده شدند، و نمونه‌های بصری از `/preview` آمدند.
- **Lighthouse:** نصب نیست.
- **gitleaks و trufflehog:** نصب نیستند. جست‌وجوی هدفمند الگوها جایگزین آن‌ها شد.
- **تنظیمات GitHub** (branch protection و rulesets): ابزار خواندنی آن در این سشن بارگذاری نشد. OPS-04 بر پایهٔ runbook است.
- **S2 و S3 بازبینی امنیتی 2026-10-12:** دوباره سنجیده نشدند.
