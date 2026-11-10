# برنامهٔ دستهٔ ۱۰ ‏L3 — Recalino (پیش‌نویس)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.3 (2026-11-10، E236‑R: کارت P10-03 ‏v2، §۸)؛ 0.2 (sha256 ‏`9379bd94…`؛ E228‑R: پاسخ شش پرسش، شرط‌ها؛ کارت‌ها و TestPlanها، §۶ و §۷)؛ 0.1 (sha256 ‏`d2a38af6…`؛ پذیرفته با شرط) |
| وضعیت | **0.1 با شرط پذیرفته شد (E228‑R).** کارت‌های P10-01 (audit، دفتری) و P10-02 تا P10-06 همراه TestPlan در دفتر، برای پیش‌سنجی بازبین. هیچ Job و PR تا پیش‌سنجی؛ سپس PR کارت (high ⇒ approve مالک) و فرمان قفل TestPlanها به مالک |
| پایه | Recalino ‏`main@6ff97eb047e6c848fc00873a985c96032576bbca` (پس از P9-06، #156)؛ aeo ‏`main@90964c2` |
| مرجع‌ها | `docs/l3/phase9-findings-candidates.md` (C9-1 تا C9-16، ستون «وضع»)؛ `docs/l3/phase8-findings-candidates.md` (C8-1 تا C8-10)؛ `docs/l3/phase9-closeout.md` ‏0.2؛ `docs/l3/phase9-plan.md` ‏0.10 §۴ (نامزدهای هسته)؛ `docs/l3/audit/P9-04.report.json` |
| قید X1 | متن کد Recalino خوانده نشد. نام فایل‌ها از `git ls-tree` روی `6ff97eb` است. مسیرها و شماره‌خط‌ها از خروجی Jobهاست. ریسک از `policy/risk-rules.yaml` در aeo ‏`90964c2` است |
| قاعدهٔ مالک | ‏E152: یافته‌ها فقط با منبع. ترتیب §۴ پیشنهاد L1 است و تصمیمش با بازبین |
| تاریخ‌ها | همه برآوردند (E172)، نه شرط |

برچسب‌ها: **Documented** (با منبع) / **Observed by model** / **Not Verified**.

## ۱. هدف و مرز
- مورد هدف: نامزدهای باز دستهٔ ۹ (C9-5 تا C9-16) و C8های بازی که Task نشدند، با منبع، و دسته‌بندی هر یک به «Task‌شدنی»، «کلاس ۱»، «کلاس ۳» یا «info».
- مورد بیرون از دسته:
  - P8-01 جداست (بلوک D، یا دستی از Q7 در 2026-11-13 ‏14:14 UK).
  - نامزدهای هسته به L-dev می‌روند، پس از ADR 0021.
  - policy، registry و `write_paths` بی‌تغییر می‌مانند، مگر با تصمیم مالک.
- مورد قاعدهٔ E192‑R: هر کارتی که `pnpm install` در apps/web دارد، `install_assets` ‏ffmpeg را دارد.
- مورد قاعدهٔ E198‑R: verify همان `pnpm test:unit` است، و شاهد آزمون int از لاگ CI روی head می‌آید.

## ۲. دسته‌بندی نامزدها (فقط با منبع)
| نامزد | منبع | دسته | یادداشت |
|---|---|---|---|
| ‏C9-2 (باقی‌مانده) | P9-04، F-2؛ E207‑R | کلاس ۱ | sweep زمانی و پاک‌سازی holdهای باز موجود؛ تصمیم مالک. بستن در اجرای دوباره در P9-05 انجام شد (E216) |
| ‏C9-3 | P9-04، F-3 | کلاس ۱ | پیامد holdهای موجود؛ مقدارهای production تأیید نشده‌اند (AQ-01) |
| ‏C9-5 | P9-04، F-5 | کلاس ۳ | `docs/architecture/04-risk-register.md` بیرون از `write_paths` است |
| ‏C9-6 | P9-04، F-6 | Task‌شدنی | پنل مدیر تلاش `started` را جزو نتیجهٔ نامعلوم نمی‌شمارد. بخش «آزمون‌ها بستن hold را نمی‌سنجند» را P9-05 تا حدی پوشاند (Documented، کارت P9-05) |
| ‏C9-7 | P9-04، F-7 | info | در مسیر speech قفل جلسهٔ AR-05 رخ نمی‌دهد |
| ‏C9-8 | P9-04، F-8 | info (پرسش مالک) | صورت‌حساب provider برای درخواست قطع‌شده؛ پاسخ از مستندات provider، بیرون از مخزن (AQ-06) |
| ‏C9-9 | review:security ‏P9-03 | Task‌شدنی، پس از investigate | TOCTOU ‏(CWE-367) در `media/assets.ts:597`؛ پیوند با C8-6 |
| ‏C9-10 | implement ‏P9-05 | Task‌شدنی (اختیاری) | نام برخی آزمون‌های int بیرونی با رفتار تازه ناهم‌خوان است. AC-3 ‏P9-05 تغییر نام را اجازه نداد |
| ‏C9-11 | review:code ‏P9-05 | Task‌شدنی | ارز `closeHoldAtMaximum` از تنظیمات کنونی، نه از hold (`runtime.ts:286`، `costs.ts:234`) |
| ‏C9-12 | review:security ‏P9-05 | Task‌شدنی، پس از investigate | ‏CWE-1023: امضای مشترک با شکست قطعیِ برآوردشده به بیشینه (`costs.ts:248-257`) |
| ‏C9-13 | review:security ‏P9-05 | investigate | ‏CWE-682، فرضیه: race با worker بازپس‌گرفته؛ AC-10 گزینهٔ no-op را مجاز دانست |
| ‏C9-14 | review:code ‏P9-06؛ E225‑R | info | deviation پذیرفته: قید `media.tts` درون تابع media است، نه proc |
| ‏C9-15 | بازبینی‌های P9-06 ‏(a2 و a3) | Task‌شدنی (پرسش کلاس ۱) | ‏CWE-459: `object_id` شیء pending پاک نمی‌شود (`assets.ts:694`). مسیر catch در `mediaTtsJob` دست‌کم `stagedObjectId` را حذف می‌کند (Documented، review:security ‏a3) |
| ‏C9-16 | review:security ‏P9-06، tests_missing | Task‌شدنی | آزمون جداسازی run و کاربر برای بند آخر AC-11 نیست |
| ‏C8-1 | P8-02، F-1 | info (سند دفتری) | ادعای نیمه‌دقیق در جمع‌بندی دستهٔ ۴. اصلاح متن سند دفتری است، نه Task ‏Recalino |
| ‏C8-6 | P8-02، F-6 | investigate | دو worker هم‌زمان پس از از دست رفتن lease (hypothesis) |
| ‏C8-7 | P8-02، F-7؛ E198‑R | کلاس ۱ | MP3 به‌صورت base64 در checkpoint ‏`proc.run_step` |
| نامزدهای هسته (۴) | `dev-to-L1-046.md`؛ برنامهٔ ۹ §۴ | L-dev | الگوی tunnel error، install بیش از ۶۰۰ ثانیه، ثبت سنجش نخست R80، postinstall در نصب دوبارهٔ R80؛ پس از ADR 0021 |

- مورد شمار: ۷ نامزد Task‌شدنی (C9-6، C9-9، C9-10، C9-11، C9-12، C9-15، C9-16)، ۲ investigate (C9-13، C8-6)، ۳ کلاس ۱ (C9-2 باقی‌مانده، C9-3، C8-7؛ و C9-15 با پرسش کلاس ۱ در §۵)، ۱ کلاس ۳ (C9-5)، ۴ info (C9-7، C9-8، C9-14، C8-1).
- مورد بسته‌ها (یادآوری): C9-1 و C9-4 با P9-05 و P9-06؛ C8-2، C8-3، C8-4، C8-5 و C8-9 با دستهٔ ۹؛ C8-8 با P8-05؛ C8-10 رد شد.

## ۳. Taskهای پیشنهادی
| کارت | منبع | نوع | ریسک کارت (برآورد) | ریسک gate (برآورد) | ‏owns_paths (برآورد؛ نام از ls-tree) | TP-1 (پیشنهاد) |
|---|---|---|---|---|---|---|
| ‏P10-01 | C8-6، C9-9، C9-12، C9-13 | investigate (audit، فقط‌خواندنی) | low | — | ندارد؛ خروجی `docs/l3/audit/P10-01.report.json` (دفتری) | ندارد (R92، audit معاف) |
| ‏P10-02 | C9-11 | bugfix | medium | medium | `packages/core/src/proc/steps/runtime.ts`، `packages/core/src/quota/costs.ts`، `packages/core/src/quota/costs.int.test.ts` | `packages/core/src/proc/steps/runtime.test.ts` ‏(pass_to_pass، قفل) |
| ‏P10-03 | C9-15 | bugfix | medium | medium، یا high اگر diff با `sql-destructive` جور شود | `packages/core/src/media/assets.ts`، `packages/core/src/priv/media.int.test.ts`؛ v2: + `apps/web/src/server/jobs.ts` (فقط wiring)، + `packages/core/src/media/index.ts` (مشروط، فقط export) | `packages/core/src/proc/maintenance.test.ts` ‏(pass_to_pass، قفل) |
| ‏P10-04 | C9-16 | test | low | medium | `packages/core/src/priv/media.int.test.ts` | `packages/core/src/proc/maintenance.test.ts` ‏(pass_to_pass، قفل) |
| ‏P10-05 | C9-6 | bugfix | low | medium | `packages/core/src/ops/admin-read.ts`، و آزمون تازه `admin-read.test.ts` یا `admin-read.int.test.ts` (هیچ‌کدام در ls-tree نیست) | `packages/core/src/ops/admin-tasks.test.ts` (§۶) |
| ‏P10-06 (اختیاری) | C9-10 | test (تغییر نام) | low | medium | آزمون‌های int بیرونی P9-05، مانند `proc/haiku55-worker.int.test.ts` و `proc/knowledge-repair.int.test.ts` | `packages/core/src/proc/maintenance.test.ts` |

- مورد شمار: ۵ Task، و ۱ Task اختیاری.
- مورد اندازهٔ هر Task:
  - P10-02: hold شاید ارز خودش را نگه ندارد. اگر اصلاح migration یا ستون تازه بخواهد، زیر `recalino-db` یا `migrations-schema` ‏(high) و کلاس ۱ (داده) می‌رود. در آن صورت Task نمی‌شود و به مالک می‌رود (Not Verified تا P10-01 یا خود Job).
  - P10-03: حذف شیء pending در بستن reconcile. قاعدهٔ `sql-destructive` با الگوی `delete from` در diff ‏high می‌شود (Observed by model، `risk-rules.yaml:132-135`).
  - P10-04 و P10-03 هر دو `priv/media.int.test.ts` را دارند، پس پشت سر هم‌اند.
  - P10-05: مسیر پنل مدیر از `apps/web` می‌خواند. اگر تغییر به `apps/web/src/app/api/**` برسد، `recalino-public-api` ‏(high) است. owns فقط `packages/core` پیشنهاد می‌شود.
- مورد برآورد هزینه (روند دستهٔ ۹): Task بی rework ‏1.9 تا 3.0 دلار؛ با rework تا 5.6 تا 8.4 دلار؛ investigate حدود 1.9 دلار. جمع ۵ Task: حدود 10 تا 20 دلار.

## ۴. ترتیب (پیشنهاد L1؛ تصمیم با بازبین)
1. P10-01 (investigate): فقط‌خواندنی است و دامنهٔ C9-9، C9-12 و C9-13 را روشن می‌کند. شاید P10-02 را هم تغییر دهد.
2. P10-02 (C9-11): به `runtime.ts` و `costs.ts`، پس از P10-01.
3. P10-03 (C9-15): به `assets.ts`.
4. P10-04 (C9-16): پس از P10-03، به‌خاطر فایل مشترک.
5. P10-05 (C9-6): مستقل است و هر جا می‌تواند بیاید.
6. P10-06 (اختیاری): پس از همه.

- مورد آغاز: پس از پذیرش این برنامه، PR کارت‌ها (approve مالک) و قفل TestPlanها (مالک، R92). یک Task در هر بلوک، بی date wait (E172).
- مورد بودجه (D8): هفتهٔ جاری از 2026-11-09 تا 2026-11-16: ‏24.631 از ۱۰۰ دلار. باقی‌مانده 75.37 دلار است؛ P8-01 جدا حدود ۲ تا ۳ دلار. اگر دسته به هفتهٔ بعد رسید، با هفتهٔ تازه ادامه دارد.

## ۵. پرسش‌ها برای بازبین
- مورد پرسش ۱: P10-01 جدا و نخست باشد، یا C9-9 و C9-12 مستقیم Task شوند؟
- مورد پرسش ۲ (کلاس ۱؟): پاک کردن شیء pending در P10-03 «حذف داده» است یا پاک‌سازی شیء ناتمام؟ مسیر catch همین کار را برای `stagedObjectId` می‌کند.
- مورد پرسش ۳: P10-06 (تغییر نام آزمون‌ها) در این دسته بیاید یا فقط ثبت بماند؟ AC-3 ‏P9-05 تغییر نام را منع کرده بود.
- مورد پرسش ۴: C8-1 (سند دفتری): L1 متن جمع‌بندی دستهٔ ۴ را با برچسب اصلاح ویرایش کند، یا فقط ثبت بماند؟
- مورد پرسش ۵: C9-8 ‏(AQ-06) و C9-3 ‏(AQ-01) به OWNER-QUEUE بروند؟
- مورد پرسش ۶: TP-1 پیشنهادی (آزمون unit موجود و قفل‌شده؛ شاهد int از CI) برای P10-02 تا P10-05 پذیرفته است؟

## ۶. تصمیم‌های 0.2 (E228‑R، ایست ۴۴۳)
- مورد پرسش ۱: P10-01 ‏investigate جدا و نخست است. خروجی دفتری `docs/l3/audit/P10-01.report.json` است، بی TestPlan، با max_turns ۸۰ (مانند P9-04).
- مورد پرسش ۲ (**E229**، با مالک): حذف شیء pending در تردید میان کلاس ۱ و ۵ است. P10-03 کارت می‌شود ولی تا پاسخ «شروع» نمی‌گیرد. اگر نوبتش رسید و پاسخ نبود، P10-05 جلو می‌افتد.
  - شکل الف: حذف شیء pending همان run، مانند مسیر catch. کارت کنونی P10-03 همین است.
  - شکل ب: بی Task؛ کارت کنار گذاشته می‌شود.
  - نسخهٔ نهایی پس از پاسخ مالک است.
- مورد پرسش ۳: P10-06 اختیاری می‌ماند: آخر دسته و فقط اگر باقی‌ماندهٔ هفته دست‌کم ۱۰ دلار باشد. TP-1 همان `maintenance.test.ts` قفل‌شده است.
- مورد پرسش ۴: C8-1 در سند دفتری `docs/l3/phase4-closeout.md` ‏0.3 با برچسب «اصلاح (E228‑R، C8-1)» ویرایش شد. نسخهٔ Recalino در PR پذیرش بعدی می‌آید.
- مورد پرسش ۵: C9-8 ‏(AQ-06) ⇒ **OQ-16**، و C9-3 ‏(AQ-01) ⇒ **OQ-17** در `docs/l3/OWNER-QUEUE.md`.
- مورد پرسش ۶، TP-1 (Observed by model، `git ls-tree` روی `6ff97eb`):
  - P10-02: `proc/steps/runtime.test.ts` (قفل).
  - P10-03 و P10-04: در `packages/core/src/media/` فقط `assets.ts` و `index.ts` هست و هیچ آزمون unit نیست ⇒ `proc/maintenance.test.ts`.
  - P10-05: در `packages/core/src/ops/` هیچ `admin-read*.test.ts` نیست. آزمون‌های unit موجود ops: `admin-tasks.test.ts`، `backup-crypto.test.ts`، `backups.test.ts`، `health.test.ts` و `stage-timings.test.ts`. نزدیک‌ترین به پنل مدیر ⇒ `admin-tasks.test.ts`.
  - P10-06: `proc/maintenance.test.ts`.
  - شاهد int از CI است (E198‑R).
- مورد شرط‌ها:
  - P10-02: اگر migration یا ستون تازه بخواهد ⇒ blocked با شواهد (کلاس ۱ ⇒ مالک).
  - P10-05: فقط `packages/core` (بی `apps/web/src/app/api/**`).
  - ترتیب ۰۱ ⇒ ۰۲ ⇒ ۰۳ ⇒ ۰۴ ⇒ ۰۵ ⇒ ۰۶ پذیرفته است.
  - هر کارت اجرایی `install_assets` ‏ffmpeg دارد (E192‑R)، و AC-8 و AC-9 معمول را.
  - limits: ‏max_turns ۶۰ (audit ۸۰) و max_rework_rounds ۱.
- مورد یادداشت برای P10-02 (Documented، خروجی P9-04، `quota/costs.ts:108` در شاهد Job): پرس‌وجوی رزرو `quota.cost_hold` را با `currency = ${currency}` فیلتر می‌کند. پس hold ستون ارز دارد، و اصلاح C9-11 احتمالاً migration نمی‌خواهد. P10-01 (AC-3) این را می‌سنجد.

## ۷. کارت‌ها و TestPlanها (0.2؛ Observed by model)
- مورد ساخت: با `scratchpad/b195/mkcards10.mjs`، و قالب‌بندی با `docs/l3/tools/fmt.mjs`. هر یازده فایل در برابر `task-card/v1` و `test-plan/v1` ‏(validate.ts در aeo ‏`90964c2`) VALID‌اند. اسکن نشانی ایمیل، URL و مسیر خانگی ۰ است.
- مورد پایه: هر پنج TestPlan روی `6ff97eb` است: `base_sha` و `commit_sha` برابر، فرمان `pnpm test:unit`. پیش از قفل هر Task، sha256 قفل‌ها از main همان روز دوباره سنجیده می‌شود.
- مورد قفل‌ها: هیچ فایل قفلی در owns هیچ کارت این دسته نیست. هیچ قفلی هم فایلی نیست که Task پیشین این دسته تغییرش دهد، پس قفل‌ها در طول دسته کهنه نمی‌شوند.
- مورد preflight (بی رویداد؛ ledger ‏6160):
  - P10-01: `run`، R92 ‏exempt، work ۸۰ (card).
  - P10-02 تا P10-06: `refused` فقط با R92 («no TestPlanLocked»)، work ۶۰ (card)، install ۴.

| فایل | sha256 | ریسک / نوع | owns | AC | limits |
|---|---|---|---|---|---|
| `P10-01.json` (دفتری) | `5ca69130…` | low / docs (audit) | `docs/aeo/audit/**` | AC-1 تا AC-4، AC-8، AC-9 | ۸۰ |
| `P10-02.json` | `112669c2…` | medium / bugfix | `proc/steps/runtime.ts`، `quota/costs.ts`، `quota/costs.int.test.ts` | AC-1 تا AC-4، AC-8، AC-9 | ۶۰، rework ۱ |
| `P10-02.test-plan.json` | `53644c60…` | TP-1 `proc/steps/runtime.test.ts` | قفل: `runtime.test.ts`، `plt/storage.ts`، `plt/jobs.ts` | TP-1 ⇒ AC-1، AC-2، AC-4 | — |
| `P10-03.json` (شکل الف، منتظر E229) | `6ae0025c…` | medium / bugfix | `media/assets.ts`، `priv/media.int.test.ts` | AC-1 تا AC-4، AC-8، AC-9 | ۶۰، rework ۱ |
| `P10-03.test-plan.json` | `c8089a1a…` | TP-1 `proc/maintenance.test.ts` | قفل: `maintenance.test.ts`، `plt/storage.ts`، `plt/jobs.ts` | TP-1 ⇒ AC-1، AC-4 | — |
| `P10-04.json` | `2550a5f5…` | low / test | `priv/media.int.test.ts` | AC-1 تا AC-4، AC-8، AC-9 | ۶۰، rework ۱ |
| `P10-04.test-plan.json` | `f2b2d5b4…` | TP-1 `proc/maintenance.test.ts` | قفل: همان سه فایل P10-03 | TP-1 ⇒ AC-1، AC-4 | — |
| `P10-05.json` | `87b9dec7…` | low / bugfix | `ops/admin-read.ts`، `ops/admin-read.test.ts`، `ops/admin-read.int.test.ts` | AC-1 تا AC-4، AC-8، AC-9 | ۶۰، rework ۱ |
| `P10-05.test-plan.json` | `53a2fe2a…` | TP-1 `ops/admin-tasks.test.ts` | قفل: `admin-tasks.test.ts`، `plt/storage.ts`، `plt/jobs.ts` | TP-1 ⇒ AC-1، AC-2، AC-4 | — |
| `P10-06.json` (اختیاری) | `f14c27e8…` | low / test | شش آزمون int بیرونی P9-05 | AC-1 تا AC-4، AC-8، AC-9 | ۶۰، rework ۱ |
| `P10-06.test-plan.json` | `aeb8ec0e…` | TP-1 `proc/maintenance.test.ts` | قفل: همان سه فایل P10-03 | TP-1 ⇒ AC-3، AC-4 | — |

- مورد مسیرها: همهٔ مسیرهای owns زیر `packages/core/src/` هستند، جز owns ‏P10-01.
- مورد PR کارت: پس از پیش‌سنجی بازبین. PR ده فایل `docs/aeo/tasks/P10-02` تا `P10-06` (کارت و TestPlan) و `docs/aeo/l3/phase10-plan.md` را دارد. ریسک آن high است (`docs/aeo/**`)، پس approve مالک لازم است. P10-01 دفتری است و در PR نمی‌آید.

## ۸. کارت P10-03 ‏v2 (0.3؛ E236‑R)
- مورد علت: attempt 1 ‏(`job-20261110-f44eb44e`، JobBlocked ‏6225، بی commit) نشان داد hook بستن reconcile برای حذف bytes شیء pending به ObjectStore نیاز دارد، و store فقط در wiring ‏`apps/web/src/server/jobs.ts` در دسترس است.
- مورد تصمیم E236‑R: راه ۱ (owns و wiring)؛ راه ۲ (adapter بی‌عمل store و حذف دیرتر bytes) رد شد؛ رفتار B در شکست حذف: خطا ثبت می‌شود و بستن run کامل می‌شود، با قید ردیابی (ردیف شیء deleted و object_id پاک).
- مورد تغییر کارت: owns + `apps/web/src/server/jobs.ts` و `packages/core/src/media/index.ts` (مشروط)؛ AC-2 بازنویسی (رفتار B و قید ردیابی)؛ AC-3 + سناریوی int شکست `store.delete`؛ AC-10 تازه (فقط wiring و export)؛ assumptions: E229 = الف، بند v2 و trade-off تماس Blob درون تراکنش. AC-1، AC-4، AC-8 و AC-9 بی‌تغییر.
- مورد ریسک: هیچ‌کدام از دو فایل تازه زیر قاعدهٔ high در `risk-rules.yaml` نیست (بازبین، policy ‏`90964c2`). ریسک کارت medium می‌ماند؛ قاعدهٔ `sql-destructive` همچنان ممکن است gate را high کند.
- مورد TestPlan: بی‌تغییر (`c8089a1a…`، قفل 6184). owns با فایل‌های قفل اشتراک ندارد.
- مورد ورودی attempt 2: `docs/l3/cards/P10-03.rework-2.md` با `--rework-findings`، روی همان worktree.
