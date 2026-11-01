# Recalino — فهرست پیشنهادی Taskهای فاز ۱ ‏L3

- Task Card: `PM-1` · نقش: project-manager · حالت: audit (فقط‌خواندنی، D13)
- پایهٔ اجرا: `a31cce4` · اسناد مرجع: `docs/aeo/as-is/*` (پایهٔ آن‌ها `a1d559b`، #79) · تاریخ: 2026-10-31
- **این فهرست پیشنهاد است. انتخاب نهایی با مالک است (D2، E49).** هر Task پیش از اجرا یک `TaskCard` v1 جدا و تأیید Tech Lead لازم دارد.
- برچسب‌ها: **[M]** = Observed by model (در همین Job از مخزن خوانده شد)؛ **[NV]** = Not Verified. URL عمداً نیامده است (AC-8).
- هیچ کد، تست، اسکریپت یا hook اجرا نشد. فقط فایل خوانده شد.

## ۰. قیدهای به‌کاررفته

1. **write_paths پیشنهادی L3:** `apps/web/src`، `apps/web/e2e`، `packages/core`، `packages/ops-cli` و `tools/test`. هیچ `owns_paths`ی به `.claude/**`، `.github/**`، `CLAUDE.md`، `AGENTS.md`، `supabase/migrations/**`، `docs/adr/**`، `.dependency-cruiser.cjs`، `tools/boundaries/**` یا `package.json` ریشه نمی‌رسد.
2. **محل تست:**
   - پروژهٔ `unit` در `vitest.config.ts` خط ۱۸ فقط این الگوها را می‌گیرد: `packages/*/src/**/*.test.ts`، `apps/*/src/**/*.test.ts` و `tools/**/*.test.ts`.
   - پس آزمون تازه در `packages/core/test/` اجرا نمی‌شود. آزمون‌های سراسری مخزن به `tools/test/` می‌روند. [M]
3. **ریسک:** هر Task که auth، پرداخت، DB یا Storage را لمس کند `high` است (AC-3). در این فهرست Task پرداخت وجود ندارد.
4. **hypothesis:** H-01 تا H-05 به Task تبدیل نشده‌اند (AC-2).
5. **اندازه:** S یعنی حداکثر نیم روز عامل، M یعنی حداکثر یک روز عامل. Task با اندازهٔ L در فهرست نیست.
6. **هم‌پوشانی:** `owns_paths` هیچ دو Taskی با هم هم‌پوشانی ندارد (جدول بخش ۳).

## ۱. ترتیب پیشنهادی اجرا (یک Implementer، D5)

| ترتیب | شناسه | عنوان | اندازه | ریسک | وابستگی | ارجاع | دلیل جایگاه |
|---|---|---|---|---|---|---|---|
| 1 | P1-01 | import نوع‌های admin در server مستقیم از `@recalino/core/ops` | S | low | — | RR-30، R-29 | فقط یک خط import نوع (type-only) تغییر می‌کند. اثر runtime ندارد. |
| 2 | P1-02 | آزمون هم‌خوانی جدول capability سند FR با `tools/capability-map.json` | S | low | — | RR-23، R-25 | فقط تست تازه است و کد تولیدی را لمس نمی‌کند. |
| 3 | P1-03 | آزمون فهرست ثابت `exports` بستهٔ core | S | low | — | RR-26، R-27 | فقط تست تازه است و کد تولیدی را لمس نمی‌کند. |
| 4 | P1-04 | انتقال قرارداد `captureDiagnosticsSchema` به `apps/web/src/shared/` | M | low | — | RR-30، R-29 | جابه‌جایی بدون تغییر رفتار است و تست موجود آن را می‌پوشاند. |
| 5 | P1-05 | انتقال متن‌های UI مصرفی `automatic-learning.ts` به `apps/web/src/shared/` | M | low | — | RR-30، RR-22، R-29 | جابه‌جایی بدون تغییر رفتار است و تست پیام موجود آن را می‌پوشاند. |
| 6 | P1-06 | آزمون نگهبان «server از ui مقدار import نمی‌کند» | S | low | P1-01، P1-04، P1-05 | RR-30، R-29 | خودش کم‌ریسک است، ولی به سه Task پیشین وابسته است. برای همین بیرون از پنج Task نخست آمده است. |
| 7 | P1-07 | پارامتر `module` برای `composeOwnedObjects` (حذف `"src"` ثابت از plt) | S | high | — | RR-28، R-28 | Storage است. کوچک و مستقل است، پس در میان Taskهای high اول می‌آید. |
| 8 | P1-08 | حذف import ‏`core/test/auth-users` از `packages/ops-cli/src/evaluate.ts` | S | high | — | RR-25، R-26 | با auth و DB محلی کار دارد. کوچک است. |
| 9 | P1-09 | سیگنال سلامت `failed_runs` برای Run شکست‌خورده | M | high | — | RR-10، R-10 | خواندن DB و تغییر قرارداد admin را دارد. بزرگ‌ترین Task فاز است. |
| 10 | P1-10 | آزمون ایستای جهت FK بین schemaها نسبت به capability map | M | high | P1-02 (فقط الگوی خواندن capability map) | RR-32، R-24 | migrationها را فقط می‌خواند و تغییر نمی‌دهد، ولی به DB مربوط است. احتمال کشف تخلف هم هست (بخش ۲). |

پنج Task نخست (P1-01 تا P1-05) همه `low` و بی‌وابستگی‌اند. هر کدام جدا merge می‌شود.

## ۲. کارت هر Task

### P1-01 — import نوع‌های admin در server مستقیم از `@recalino/core/ops`

- **هدف:** خط ۴۷ `apps/web/src/server/admin-routes.ts` نوع‌های `AdminResult`، `AdminView` و `EmailPresentationPreview` را از `../ui/admin/contracts` می‌گیرد. ولی `apps/web/src/ui/admin/contracts.ts` فقط همین نوع‌ها را از `@recalino/core/ops` دوباره export می‌کند. import باید مستقیم از `@recalino/core/ops` بیاید تا server دیگر به `ui` وابسته نباشد. [M]
- **اندازه:** S
- **ریسک:** low. فقط import نوع است و در خروجی JS اثری ندارد. typecheck آن را می‌سنجد.
- **owns_paths:** `apps/web/src/server/admin-routes.ts`
- **پوشهٔ تست:** `apps/web/src/server/` (تست‌های موجود `admin-*`)
- **TestPlan:** `pass_to_pass`. `pnpm typecheck` و تست‌های unit موجود `apps/web/src/server/admin*.test.ts` سبز می‌مانند.
- **وابستگی‌ها:** ندارد.
- **ارجاع:** RR-30 (ARCH-F-11)، R-29

### P1-02 — آزمون هم‌خوانی جدول capability سند FR با `tools/capability-map.json`

- **هدف:** آزمونی که ستون «وابسته به» جدول بخش ۳ سند `docs/MVP_FUNCTIONAL_REQUIREMENTS_FA.md` را parse کند و با `modules` در `tools/capability-map.json` مقایسه کند. «همه ماژول‌های داده» معادل `*` است.
  - روی base، جدول (خط ۵۳ تا ۷۳) و فایل JSON با هم می‌خوانند. [M]
  - تصمیم سیاست گذرا (ADR گام R-25) در این Task نیست. آن تصمیم با Architect است.
- **اندازه:** S
- **ریسک:** low. فقط تست تازه است که دو فایل را می‌خواند.
- **owns_paths:** `tools/test/capability-map-doc-sync.test.ts`
- **پوشهٔ تست:** `tools/test/`
- **TestPlan:** `pass_to_pass`. آزمون روی base سبز است. یک case داخلی هم با جدول دست‌کاری‌شده در حافظه باید شکست بخورد، تا ثابت شود آزمون اختلاف را می‌گیرد.
- **وابستگی‌ها:** ندارد.
- **ارجاع:** RR-23 (ARCH-F-3)، R-25 (بخش آزمون `capability-map-doc-sync`)

### P1-03 — آزمون فهرست ثابت `exports` بستهٔ core

- **هدف:** آزمونی که کلیدهای `exports` در `packages/core/package.json` را با فهرست صریح فعلی مقایسه کند. فهرست فعلی ۲۸ کلید دارد: خط ۷ تا ۳۴ [M].
  - برای هر subpath غیر index (`./config`، `./study-render`، `./study-target`، `./card-html`، `./study-export`، `./voice-contracts` و `./plt/vercel-blob`) یک خط دلیل در خود آزمون می‌آید.
  - افزودن کلید تازه بدون به‌روزکردن فهرست، آزمون را می‌شکند.
  - ADR «نقطه‌های ورود browser-safe» (R-27) و قاعدهٔ depcruise ‏`client-safe-no-server-deps` در این Task نیستند.
- **اندازه:** S
- **ریسک:** low. فقط تست تازه است.
- **owns_paths:** `tools/test/core-exports-allowlist.test.ts`
- **پوشهٔ تست:** `tools/test/`. `packages/core/test/` در include ‏vitest نیست و `packages/core/src/` هم فایل ریشه ندارد. [M]
- **TestPlan:** `pass_to_pass`. روی base سبز است. یک case داخلی با کلید اضافهٔ ساختگی باید شکست بخورد.
- **وابستگی‌ها:** ندارد. اگر ADR گام R-27 بعداً فهرست را تغییر دهد، فقط فهرست آزمون به‌روز می‌شود.
- **ارجاع:** RR-26 (ARCH-F-6)، R-27 (بخش آزمون `exports-allowlist`)

### P1-04 — انتقال قرارداد `captureDiagnosticsSchema` به `apps/web/src/shared/`

- **هدف:** خط ۶ `apps/web/src/server/recording-routes.ts` مقدار `captureDiagnosticsSchema` را از `ui/recording/capture-diagnostics` می‌گیرد. [M]
  - schema و ثابت‌های لازمش (`PLATFORMS`، `BROWSERS`، `GAP_CAUSES` و `PHOTO_VERDICTS`) به `apps/web/src/shared/capture-diagnostics-contract.ts` منتقل شوند.
  - فایل‌های `ui` همان نام‌ها را از shared دوباره export کنند.
  - server از shared بخواند.
  - schema باید عیناً همان بماند (zod/mini، PERF-06).
- **اندازه:** M
- **ریسک:** low. فقط کد جابه‌جا می‌شود و رفتار validation تغییری نمی‌کند. auth، DB یا Storage را لمس نمی‌کند.
- **owns_paths:** `apps/web/src/shared/capture-diagnostics-contract.ts`، `apps/web/src/ui/recording/capture-diagnostics.ts`، `apps/web/src/ui/recording/capture-meter.ts`، `apps/web/src/ui/recording/photo-quality.ts`، `apps/web/src/server/recording-routes.ts`
- **پوشهٔ تست:** `apps/web/src/ui/recording/` (`capture-diagnostics.test.ts`) و `apps/web/src/server/` (`recording-routes.test.ts`)
- **TestPlan:** `pass_to_pass`. دو تست موجود بدون تغییر انتظار سبز می‌مانند. `pnpm check:client-bundle` هم در CI سبز می‌ماند.
- **وابستگی‌ها:** ندارد.
- **ارجاع:** RR-30 (ARCH-F-11)، R-29 (انتقال `captureDiagnosticsSchema` به پوشهٔ خنثی)

### P1-05 — انتقال متن‌های UI مصرفی `automatic-learning.ts` به `apps/web/src/shared/`

- **هدف:** `apps/web/src/server/automatic-learning.ts` در خط ۶۲ تا ۶۴ این مقدارها را از `ui` import می‌کند: `allowanceCopy`، `allowanceLabels`، `allowanceUnits` و `uploadCopy`. مصرف آن‌ها در خط ۱۳۶ تا ۱۴۷ و ۱۹۲ تا ۱۹۴ است. [M]
  - این متن‌ها به `apps/web/src/shared/` منتقل شوند.
  - فایل‌های `ui` همان نام‌ها را دوباره export کنند تا مصرف‌کنندگان client بی‌تغییر بمانند.
  - منطق orchestration (RR-22) دست نمی‌خورد.
- **اندازه:** M
- **ریسک:** low. فقط ثابت‌های متنی جابه‌جا می‌شوند و رفتار تغییری نمی‌کند.
- **owns_paths:** `apps/web/src/shared/allowance-copy.ts`، `apps/web/src/shared/allowance-units.ts`، `apps/web/src/shared/upload-copy.ts`، `apps/web/src/ui/allowance-copy.ts`، `apps/web/src/ui/allowance-units.ts`، `apps/web/src/ui/workspace/upload-copy.ts`، `apps/web/src/server/automatic-learning.ts`
- **پوشهٔ تست:** `apps/web/src/server/` (`automatic-learning.test.ts`، `automatic-learning-message.test.ts`)
- **TestPlan:** `pass_to_pass`. تست‌های موجود پیام و `automatic-learning` بدون تغییر انتظار سبز می‌مانند.
- **وابستگی‌ها:** ندارد.
- **ارجاع:** RR-30 (ARCH-F-11)، RR-22 (ARCH-F-2)، R-29

### P1-06 — آزمون نگهبان «server از ui مقدار import نمی‌کند»

- **هدف:** آزمونی که همهٔ فایل‌های غیرآزمونی `apps/web/src/server/**` را بخواند و هر import مقداری (غیر `import type`) از `../ui/` یا `@/ui/` را خطا بگیرد.
  - فایل‌های `*.test.ts`، `*.int.test.ts` و پشتیبان آزمون (`*-support.ts`، `cross-account/**`) با فهرست صریح استثنا هستند.
  - این آزمون جای موقت قاعدهٔ depcruise ‏`web-server-not-to-ui` است، چون `.dependency-cruiser.cjs` بیرون از write_paths است.
- **اندازه:** S
- **ریسک:** low. فقط تست تازه است.
- **owns_paths:** `apps/web/src/server/server-ui-boundary.test.ts`
- **پوشهٔ تست:** `apps/web/src/server/`
- **TestPlan:** `fail_to_pass`. پیش از P1-01، P1-04 و P1-05 دست‌کم سه import مقداری را می‌گیرد: `recording-routes.ts` خط ۶ و `automatic-learning.ts` خط ۶۲ تا ۶۴. بعد از آن‌ها سبز است. [M]
- **وابستگی‌ها:** P1-01، P1-04، P1-05
- **ارجاع:** RR-30 (ARCH-F-11)، R-29 (معیار پایان: «server دیگر از ui مقدار import نکند»)

### P1-07 — پارامتر `module` برای `composeOwnedObjects`

- **هدف:** در `packages/core/src/plt/storage.ts` خط ۳۳۶، مقدار `module: "src"` ثابت است. پس plt نام ماژول بالادست را می‌داند. [M]
  - `module` پارامتر ورودی `composeOwnedObjects` شود.
  - دو فراخوان، `src/audio.ts` خط ۴۲۸ و `src/service.ts` خط ۶۹۴، مقدار `"src"` را صریح بدهند.
  - **بازنشستگی شاخهٔ `multipart` در این Task نیست.** آن کار به تصمیم ADR-0004 در گام R-08 وابسته است.
- **اندازه:** S
- **ریسک:** high. Storage است: مسیر ثبت `plt.storage_object` و compose را لمس می‌کند. خطا در مقدار `module` مالکیت و پاک‌سازی شیء را خراب می‌کند.
- **owns_paths:** `packages/core/src/plt/storage.ts`، `packages/core/src/src/audio.ts`، `packages/core/src/src/service.ts`
- **پوشهٔ تست:** `packages/core/src/plt/` (`storage.int.test.ts`)
- **TestPlan:** `pass_to_pass`. `storage.int.test.ts` و تست‌های موجود `src` سبز می‌مانند. یک case در `storage.int.test.ts` بررسی کند که `module` ثبت‌شده همان ورودی است.
- **وابستگی‌ها:** ندارد.
- **ارجاع:** RR-28 (ARCH-F-9)، R-28 (بند «`module` پارامتر ورودی `composeOwnedObjects` شود»)

### P1-08 — حذف import ‏`core/test/auth-users` از `packages/ops-cli/src/evaluate.ts`

- **هدف:** `packages/ops-cli/src/evaluate.ts` خط ۶۷ تابع `createAuthUser` را با مسیر نسبی از `../../core/test/auth-users` می‌گیرد و در خط ۲۴۷ صدا می‌زند. [M]
  - یک adapter محلی در `packages/ops-cli/src/` ساخته شود که فقط روی پایگاه محلی ارزیابی کار کند.
  - adapter پیش از کار باید `assertLocalEvaluationDatabase` را بگذراند.
  - subpath تازهٔ `@recalino/core/testing` در این Task نیست، چون ADR لازم دارد (R-26).
- **اندازه:** S
- **ریسک:** high. auth است: درج در `auth.users` با نقش superuser محلی انجام می‌شود. اگر نگهبان «فقط محلی» نباشد، روی پایگاه غیرمحلی خطرناک است.
- **owns_paths:** `packages/ops-cli/src/evaluate.ts`، `packages/ops-cli/src/synthetic-auth-user.ts`، `packages/ops-cli/src/synthetic-auth-user.test.ts`
- **پوشهٔ تست:** `packages/ops-cli/src/` (کنار `evaluation-config.test.ts`)
- **TestPlan:** `fail_to_pass`. آزمون unit تازه نشان می‌دهد adapter با نشانی پایگاه غیرمحلی خطا می‌دهد و هیچ اتصالی باز نمی‌کند. یک بررسی متنی هم نشان می‌دهد `evaluate.ts` دیگر `core/test/` را import نمی‌کند. هر دو پیش از تغییر شکست می‌خورند.
- **وابستگی‌ها:** ندارد.
- **ارجاع:** RR-25 (ARCH-F-5)، R-26 (بند `evaluate.ts`)

### P1-09 — سیگنال سلامت `failed_runs` برای Run شکست‌خورده

- **هدف:** در `packages/core/src/proc/worker.ts` خط ۷۸ تا ۸۱، `catch` تابع `failRun` را صدا می‌زند و بعد `return` می‌کند. پس Job موفق ثبت می‌شود و سیگنال `failed_jobs` (`ops/health.ts` خط ۸۴ تا ۸۸) Run شکست‌خورده را نمی‌شمارد. [M]
  - proc یک تابع عمومی شمارش Run شکست‌خورده در بازهٔ زمانی بدهد.
  - `ops/health.ts` آن را به‌صورت شرط تازهٔ `failed_runs` بسنجد. وابستگی `ops → proc` در capability map مجاز است.
  - نوع `HealthCondition` در `ops/admin-contracts.ts` خط ۲۱۰ گسترش یابد.
  - متن admin برای شرط تازه اضافه شود.
  - **ستون یا migration تازه در این Task نیست.** گزینهٔ «ثبت `outcome` روی Job» به migration نیاز دارد و بیرون از write_paths است.
- **اندازه:** M
- **ریسک:** high. DB است: پرس‌وجوی تازه روی جدول Run اجرا می‌شود و قرارداد سلامت admin تغییر می‌کند. نبودن constraint ‏DB برای شرط‌ها: `git grep "runner_stale"` در `supabase/` نتیجه نداد [M]. رفتار مقدار تازه در audit موجود: [NV].
- **owns_paths:** `packages/core/src/ops/health.ts`، `packages/core/src/ops/health.test.ts`، `packages/core/src/ops/health.int.test.ts`، `packages/core/src/ops/admin-contracts.ts`، `packages/core/src/proc/run-health.ts`، `packages/core/src/proc/index.ts`، `apps/web/src/ui/admin/copy.ts`، `apps/web/src/ui/admin/SystemHealthCard.test.ts`
- **پوشهٔ تست:** `packages/core/src/ops/`
- **TestPlan:** `fail_to_pass`. case تازه در `health.int.test.ts` یک Run شکست‌خورده می‌سازد و انتظار دارد `failed_runs` باز شود. پیش از تغییر این case شکست می‌خورد. تست‌های unit موجود سلامت با فهرست شرط به‌روزشده سبز می‌مانند.
- **وابستگی‌ها:** ندارد.
- **ارجاع:** RR-10 (DEBT-F-8)، R-10

### P1-10 — آزمون ایستای جهت FK بین schemaها

- **هدف:** آزمونی در `tools/test/` که فایل‌های `supabase/migrations/*.sql` را فقط بخواند و `references <schema>.<table>` را استخراج کند.
  - schema مقصد هر FK باید همان schema مبدأ باشد، یا در بستار `allowedModules(schema مبدأ)` از `tools/capability-map.json` باشد.
  - `auth.users` استثنای صریح است.
  - مالکیت `learning_item` میان LKM و CARD در این Task نیست. آن تصمیم با Architect است (R-24).
- **اندازه:** M
- **ریسک:** high. به DB مربوط است، با این‌که migrationها را تغییر نمی‌دهد و پایگاه را اجرا نمی‌کند. همهٔ FKها روی base سنجیده نشده‌اند (RR-32: Not Verified)، پس ممکن است آزمون تخلف واقعی پیدا کند.
- **owns_paths:** `tools/test/fk-follows-capability-map.test.ts`
- **پوشهٔ تست:** `tools/test/`
- **TestPlan:** `pass_to_pass`، به شرطی که روی base تخلفی نباشد. یک case با SQL ساختگی که FK خلاف جهت دارد باید شکست بخورد. اگر روی base تخلف پیدا شد، Implementer متوقف شود و `blocked` برگرداند. فهرست استثنا را خودش نسازد. تصمیم با Architect است.
- **وابستگی‌ها:** P1-02. این وابستگی نرم است: فقط برای هم‌شکل بودن خواندن capability map. اجرای مستقل هم ممکن است.
- **ارجاع:** RR-32 (ARCH-F-13)، R-24

## ۳. بررسی هم‌پوشانی `owns_paths`

- هر مسیر فقط در یک Task آمده است.
- P1-04 و P1-05 هر دو در `apps/web/src/shared/` فایل می‌سازند، ولی نام فایل‌هایشان جداست.
- P1-02، P1-03 و P1-10 هر کدام یک فایل جدا در `tools/test/` دارند.
- `packages/core/src/proc/index.ts` فقط در P1-09 آمده است.

## ۴. نامزدهای کنارگذاشته و دلیل

| گام Roadmap | دلیل کنار گذاشتن از فاز ۱ |
|---|---|
| R-01، R-02، R-03 (موج ۰) | به `.claude/**`، `CLAUDE.md`، تنظیمات GitHub یا کار مالک در Vercel نیاز دارند. همه بیرون از write_paths هستند. |
| R-04، R-07، R-08، R-14، R-22 (بخش ADR)، R-23، R-25 (بخش ADR)، R-27 (بخش ADR)، R-30، R-31 | کار سند، ADR یا میزبان است (`docs/**`، `policy/**`). بیرون از write_paths است یا تصمیم Architect یا مالک را لازم دارد. |
| R-05 | `tools/legal/guard.ts` بیرون از write_paths است (فقط `tools/test` مجاز است). |
| R-06 | `.github/workflows/ci.yml` ممنوع است. |
| R-09، R-17، R-18 | به `package.json` ریشه، lockfile یا `pnpm-workspace.yaml` نیاز دارند. |
| R-21 (بند ۱) | ۱۱ فایل `tools/eval/` بیرون از write_paths هستند. |
| R-12، R-20، R-26 (قاعده)، R-29 (قاعده) | قاعدهٔ depcruise در `.dependency-cruiser.cjs` و `tools/boundaries/` است. بخش اجراشدنی R-29 در P1-04 تا P1-06 آمده است. |
| R-13 | `apps/web/next.config.ts` بیرون از `apps/web/src` است. گزینهٔ `proxy.ts` با مسیر نشست auth درگیر است و Task ‏high بزرگ‌تری می‌شود. نامزد فاز ۲ است. |
| R-19 | به migration نیاز دارد (ممنوع). |
| R-28 (بازنشستگی `multipart`) | به تصمیم ADR-0004 در گام R-08 وابسته است. |

## ۵. Decision Request برای مالک

**موضوع: انحراف از ترتیب ریسک Roadmap.** write_paths فعلی L3 فقط ردیف‌های کم‌شدت را پوشش می‌دهد. پرریسک‌ترین گام‌ها بیرون از آن مانده‌اند: RR-01 (blocking)، RR-02 و RR-07. پس فاز ۱ ترتیب ریسک Roadmap را دنبال نمی‌کند و برای «آزمودن L3 با کار کم‌ریسک» مناسب است، نه برای کاهش ریسک اصلی.

1. همین ده Task را بپذیرید و گام‌های موج ۰ را جدا، با Task Card دستی بیرون از L3 پیش ببرید.
2. `tools/legal`، `tools/eval` و `.github/workflows/ci.yml` را برای فاز ۱ به write_paths اضافه کنید تا R-05، R-06 و R-21(۱) هم وارد فهرست شوند. هزینهٔ این گزینه: ریسک تغییر CI به دست عامل.
3. فاز ۱ را به پنج Task نخست (همه low) محدود کنید و پس از دیدن نتیجه، فاز ۲ را با Taskهای high ادامه دهید.

**پیشنهاد:** گزینهٔ ۱. Taskهای high (P1-07 تا P1-10) فقط پس از سبز شدن پنج Task نخست اجرا شوند.
