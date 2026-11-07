# برنامهٔ دستهٔ ۶ ‏L3 — Recalino ‏(P6-01 تا P6-04)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.3 (2026-11-06، بلوک ۱۶۵ ‏L1: وضعیت بسته تا پذیرش مالک؛ §۹ کامل، E145 تا E152؛ همراه PR پذیرش دستهٔ ۶ به Recalino می‌رود)؛ 0.2 (2026-11-06، بلوک ۱۵۵ ‏L1: وضعیت تصویب‌شده؛ §۹ با E143 و E144؛ زمان E141/E142؛ همراه PR کارت‌ها به Recalino می‌رود)؛ 0.1 (2026-11-06، بلوک ۱۵۴ ‏L1؛ پیش‌نویس برای بازبینی) |
| وضعیت | **بسته تا پذیرش مالک.** هر چهار Task در `main@e249ba6` هستند: ‏P6-02 ‏#131، P6-04 ‏#132، P6-03 ‏#133 و P6-01 ‏#134، با 6.95 دلار برای ۱۶ Job (Observed by model، ledger). جمع‌بندی: `docs/l3/phase6-closeout.md` ‏0.2 در دفتر AEO؛ پذیرش: `docs/aeo/l3/phase6-acceptance.md`. پس از پذیرش، توقف برنامه‌ریزی‌شدهٔ E152. متن پیشین: تصویب‌شده؛ در انتظار PR کارت‌ها. دستهٔ ۵ با پذیرش مالک بسته شد (#129 ⇒ `7897a68`). دامنهٔ دستهٔ ۶ پیشنهاد بازبین است، با تصمیم‌های مالک E141 = الف، E142 = الف و E136 = روال تأیید («برای هر سه، با پیشنهاد بازبین موافقم»؛ Documented، پیام بازبین ≈ 14:33–14:35 UK)، و E144 = الف (تصویب این برنامه). هیچ قفل TestPlan یا Job پیش از merge ‏PR کارت‌ها با approve مالک نیست |
| بازبینی | بازبینی شد (2026-11-06، پیام بازبین 14:41 UK): هر ۹ sha256 برابر؛ هر ۸ JSON با schemaهای controller ‏VALID؛ ۱۶ قفل با blobهای `7897a68` برابر؛ بی هم‌پوشانی؛ ریسک‌ها با policy سازگار. سه انحراف (جای سند P6-01، بی شمارش voiceprint، سطر system-inventory معوق) پذیرفته شد |
| پایه | Recalino ‏`main@7897a686c16f1d7e16f985deb24906125a4c874b` (پس از پذیرش دستهٔ ۵، #129)؛ aeo ‏`main@0e98bda` |
| مرجع‌ها | پذیرش دستهٔ ۵ ‏`docs/aeo/l3/phase5-acceptance.md` (§۵ تا §۷)؛ جمع‌بندی دستهٔ ۵ ‏`docs/l3/phase5-closeout.md` ‏0.2 (§۶ و §۸)؛ تحلیل L-bench ‏`docs/l2/bench/analysis-l3-phase5.md` ‏0.1؛ خروجی Jobهای review ‏P5-02 ‏(`job-20261106-e8204ab0`) و P5-04 ‏(`job-20261106-21e5af05`، `job-20261106-e32cf916`)، و implement ‏P5-02 ‏(`job-20261106-31104efa`) |
| قید X1 | متن کد و اسناد Recalino خوانده نشد. owns_paths از نام فایل‌ها (`git ls-tree`) و خروجی Jobهای دستهٔ ۵ آمده است. sha256 فایل‌های قفل از blobهای `7897a68` است |

برچسب‌ها: **Documented** (با مسیر سند) / **Observed by model** / **Not Verified**.

## ۱. هدف
- مورد دامنه (Documented، پیام بازبین بلوک ۱۵۴): چهار کار، همه کم‌ریسک و از نامزدهای پذیرش دستهٔ ۵.
  - مورد P6-02: آزمون اتصال `existingAccountIds.accountRow === accountRowOf`، و اینکه sweep با accountRow واقعی همان NOT EXISTS را می‌سازد (tests_missing ‏review:security ‏P5-02؛ نامزد ۵).
  - مورد P6-04: پین `VOICE_WINDOW_PLAN` در همان pin ‏P5-04 (minor ‏review:code ‏P5-04؛ نامزد ۲).
  - مورد P6-03: فیلد `hold_micros` در allow-list ‏`plt/log.ts`، و استفاده از آن در `provider_estimate_above_hold` به‌جای `production_limit` (پرسش باز implementer ‏P5-02؛ نامزد ۶).
  - مورد P6-01: بررسی فقط‌خواندنی نسخهٔ مدل صدا و اثر `e460366`، به‌صورت یک سند (E141 = الف). تصمیم bump و ضبط دوباره پس از آن است (E145).
- مورد معوق به دستهٔ بعد (Documented، پیام بازبین):
  - مورد prompt: پوشش شاخه‌های شرطی قالب prompt (نامزد ۱).
  - مورد عددهای صدا: عددهای درون‌خطی `voice-engine-quality.mjs` (نامزد ۳).
  - مورد سند inventory: افزودن `plt.count_account_orphans` به `docs/architecture/01-system-inventory.md` (نامزد ۴). این در هیچ کارت این دسته نمی‌گنجد، چون `docs/architecture/**` در `write_paths.recalino` نیست (Observed by model، `policy/targets.json`). افزودنش تغییر policy و تصمیم مالک می‌خواهد.
- مورد E136 (روال تأیید): هیچ apply پیش از گزارش دست‌کم ۲۴ اجرای ساعتی شمارش نیست. زمان deploy و دسترسی به log ‏production هنوز بی پاسخ است (Not Verified). هیچ کارت این دسته apply را لمس نمی‌کند.
- مورد E142 (R98 و R99): به L-dev سفارش داده شد. تا R98، L1 مقدار `--max-turns` هر Job را از `limits.max_turns` کارت می‌دهد.

## ۲. فهرست و ترتیب کارت‌ها
| ترتیب | کارت | منبع | نوع | ریسک کارت | ریسک gate (برآورد از مسیر) | ‏merge | ‏owns_paths | ‏max_turns |
|---|---|---|---|---|---|---|---|---|
| گام ۱ | ‏P6-02 | ‏tests_missing ‏security ‏P5-02 | test | ‏low | ‏medium؛ high اگر رشتهٔ `delete from` در انتظار آزمون `sql-destructive` را فعال کند | ‏D7، یا approve مالک اگر high | `packages/core/src/acc/jobs.test.ts` | ۶۰ |
| گام ۲ | ‏P6-04 | ‏minor ‏code ‏P5-04 | test | ‏low | ‏medium | ‏D7 | `apps/web/src/server/voice-engine.test.ts`، `apps/web/src/server/voice-source-windows.ts` (فقط `export`) | ۶۰ |
| گام ۳ | ‏P6-03 | پرسش باز implementer ‏P5-02 | feature | ‏medium | ‏medium | ‏D7 | `packages/core/src/plt/log.ts`، `plt/log.test.ts`، `proc/steps/runtime.ts`، `proc/steps/runtime.test.ts` | ۶۰ |
| گام ۴ | ‏P6-01 | ‏E141 = الف؛ AUD-3 ‏F-9 | docs | ‏low | **high** (`docs/aeo/**`، قاعدهٔ `recalino-aeo-docs`) | ‏approve مالک | `docs/aeo/l3/voice-model-revision.md` (تازه) | ۶۰ |

- مورد ترتیب: همان پیشنهاد بازبین، P6-02 ⇒ P6-04 ⇒ P6-03 ⇒ P6-01. یک Task در هر بلوک. P6-01 آخر است، چون سندش از pin تازهٔ P6-04 هم یاد می‌کند.
- مورد جدایی (Observed by model، اسکریپت `scratchpad/b154/mkcards.mjs`): owns_paths چهار کارت هم‌پوشانی ندارند. هیچ TestPlan فایلی را قفل نمی‌کند که کارتِ پیش از آن در ترتیب تغییرش می‌دهد. P6-01 عمداً `voice-source-windows.ts` و `voice-engine.test.ts` را قفل نمی‌کند، چون P6-04 پیش از آن آن‌ها را تغییر می‌دهد.
- مورد قفل‌ها (sha256 در `7897a68`):
  - مورد P6-02: `acc/account.ts`، `acc/jobs.ts`، `acc/index.ts` و `plt/account-orphans.ts`. کارت فقط آزمون می‌افزاید.
  - مورد P6-04: `voice-engine.ts`، `audio-preparer.ts` و `voice-engine-quality.mjs`.
  - مورد P6-03: `quota/costs.ts`، `aip/pricing.ts`، `proc/worker.ts` و `plt/account-orphans.ts`.
  - مورد P6-01: `voice-engine.ts`، `voice-engine-quality.mjs`، `voc/matching.ts`، `voc/linking.ts` و `voc/enrollment.ts`.
- مورد ریسک (Documented، الگوی دستهٔ ۵):
  - مورد medium: مسیرهای `packages/core/src/acc/**`، `plt/**`، `proc/**` و `apps/web/src/server/voice-*` قاعدهٔ high ندارند.
  - مورد P6-03 ‏medium در کارت: allow-list ‏log مرز حریم خصوصی است، ولی فقط یک فیلد عددی افزوده می‌شود.
  - مورد P6-01 ‏high در gate: هر تغییر در `docs/aeo/**` در Recalino high است. پس سند، با وجود ریسک کارت low، approve مالک می‌خواهد.
- مورد R91 (Observed by model، از مسیرها): هیچ کارت Task ‏DB نیست. owns_paths با `supabase/**` و `packages/core/src/db/**` هم‌پوشان نیستند.
- مورد migration: هیچ کارت migration ندارد. اگر لازم شد، blocked.
- مورد R87 (Observed by model): همهٔ owns_paths درون `write_paths.recalino` هستند (`docs/aeo/**`، `apps/web/src/**`، `packages/core/**`).
- مورد preflight (Observed by model، روی `7897a68`، بی رویداد؛ ledger ‏۵۰۸۱ پیش و پس): هر چهار کارت فقط با «no TestPlanLocked … (R92)» رد شدند، که پیش از قفل‌ها انتظار می‌رود.

## ۳. P6-02 و P6-03 در تفصیل
- مورد P6-02:
  - مورد جای آزمون: در `acc/jobs.test.ts`، چون plt هیچ import از acc ندارد (capability map ‏`"plt": []`) و acc اجازهٔ import از plt را دارد.
  - مورد دو case: (۱) `existingAccountIds.accountRow === accountRowOf`؛ (۲) با کامپایلر واقعی Kysely و پایگاه ساختگی، DELETE هر دو جدول در apply شرط not exists روی `acc.user_account` را دارد، و پیش‌فرض dry-run هیچ DELETE نمی‌سازد.
  - مورد آنچه دست نمی‌خورد: کد تولیدی.
  - مورد خطر gate: رشتهٔ `delete from` در انتظار آزمون ممکن است `sql-destructive` را فعال کند. در آن حال gate ‏high است و merge با approve مالک.
- مورد P6-03:
  - مورد فیلد: `hold_micros` با همان قاعدهٔ فیلدهای عددی موجود در `ALLOWED_FIELDS`.
  - مورد log: `provider_estimate_above_hold` با `measured` و `hold_micros`، و بی `production_limit`.
  - مورد بی‌تغییر: شرط log، نبود clamp، hold و ثبت هزینه.
  - مورد آزمون‌ها: `plt/log.test.ts` پذیرش مقدار عددی و رد مقدار غیرعددی را نشان می‌دهد. `runtime.test.ts` شکل تازهٔ log را نشان می‌دهد.

## ۴. P6-01 و P6-04 در تفصیل (نسخهٔ مدل صدا)
- مورد P6-04:
  - مورد pin: `VOICE_WINDOW_PLAN` به همان pin ‏P5-04 در `voice-engine.test.ts` افزوده می‌شود، با همان پیام شکست.
  - مورد export: در `voice-source-windows.ts` فقط `export` مجاز است، اگر لازم باشد.
- مورد P6-01 (E141 = الف):
  - مورد خروجی: یک سند در `docs/aeo/l3/voice-model-revision.md`، فقط از روی کد و تاریخچهٔ git.
  - مورد بخش‌ها: (۱) تغییرهای `e460366`؛ (۲) برچسب‌گذاری voiceprint، نمونه و مرجع با revision، و جایی که مقایسه آن را می‌سنجد؛ (۳) اثر عملی ناسازگاری؛ (۴) گزینه‌های مالک. هر ادعا برچسب دارد.
  - مورد شمارش به تفکیک revision: **در این کارت نیست.** دادهٔ voiceprint بیومتریک است، و `voc` فایل job دوره‌ای ندارد. پس شمارش فقط‌خواندنی به الگوی P5-01 در owns_paths کوچک نمی‌گنجد. Implementer فقط شکل آن را برای یک کارت بعدی پیشنهاد می‌دهد، و تصمیمش با مالک است.
  - مورد گام پس از سند: تصمیم bump ‏`VOICE_MODEL_REVISION` و ضبط دوبارهٔ نمونه‌ها (E145)، که بر کاربران اثر دارد.

## ۵. جریان اجرا
- مورد پیش‌نیاز ۱ (E144 = الف، انجام‌شده): PR کارت‌های دستهٔ ۶ روی `aeo/task-cards-16` با approve مالک. این PR شامل چهار کارت، چهار TestPlan و `docs/aeo/l3/phase6-plan.md` است (high، `docs/aeo/**`).
- مورد پیش‌نیاز ۲ (R92): مالک هر TestPlan را پس از merge ‏PR کارت‌ها و پیش از نخستین Job آن قفل می‌کند.
- مورد گام‌های هر Task:
  - مورد تا PR: preflight ⇒ implement ⇒ verify (load1 زیر ۲) ⇒ review:code و review:security پشت سر هم ⇒ `pr open --task` ⇒ gate حدود ۳۰ ثانیه پس از open.
  - مورد پس از CI: gate با `--attestation`، `--review` و `--security-review` ⇒ `merge --dry-run` ⇒ merge در فرمان جدا (D7، یا approve مالک برای gate ‏high) ⇒ `ledger verify` ⇒ `main-check --wait 15`.
- مورد سقف نوبت (E142): هر Job با `--max-turns` برابر `limits.max_turns` کارت اجرا می‌شود. برای هر چهار کارت ۶۰ است.

## ۶. بودجه (D8)
- مورد هفتهٔ جاری (Observed by model، ledger؛ هفته از 2026-11-02T00:00Z): تا پایان دستهٔ ۵ ‏**72.52 دلار از ۱۰۰** مصرف شده است. 27.48 دلار تا پایان یکشنبه می‌ماند. هفتهٔ تازه از 2026-11-09 است.
- مورد برآورد (Not Verified؛ برون‌یابی از دستهٔ ۵: P5-03 ‏1.86، P5-04 ‏1.40، P5-01 ‏1.71، P5-02 ‏3.20):

| کارت | برآورد (دلار) | پایه |
|---|---|---|
| کارت P6-02 | ‏1.5 تا 2.5 | فقط آزمون، با کامپایلر Kysely؛ همانند P5-01 |
| کارت P6-04 | ‏1 تا 1.5 | فقط آزمون و export؛ همانند P5-04 (1.40) |
| کارت P6-03 | ‏1.5 تا 2.5 | دو فایل تولیدی و دو آزمون |
| کارت P6-01 | ‏1.5 تا 3 | خواندن کد voc و نوشتن سند |
| جمع | ‏5.5 تا 9.5 | نزدیک برآورد بازبین (۷ تا ۹)؛ زیر باقی‌ماندهٔ هفته؛ هر بلوک یک Task، زیر ۲۰ دلار |

## ۷. قواعد توقف
- مورد پایه: همهٔ قواعد phase5-plan §۷ برقرارند.
- مورد افزوده‌های دستهٔ ۶:
  - مورد P6-02: هر تغییر در کد تولیدی acc یا plt ⇒ fail ‏testplan-lock یا رد review و توقف.
  - مورد P6-04: هر تغییر در مقدار `VOICE_WINDOW_PLAN`، revision یا تنظیمات صدا ⇒ رد review و توقف.
  - مورد P6-03: هر فیلد log جز `hold_micros`، یا هر تغییر در شرط log یا ثبت هزینه ⇒ رد review و توقف.
  - مورد P6-01: هر تغییر کد، هر پرس‌وجو روی پایگاه، یا هر شناسه یا دادهٔ کاربر در سند ⇒ رد review و توقف.
  - مورد سقف نوبت: اگر Jobی در سقف کارت تمام شد ولی finished نشد، یک دور rework با `--rework-findings`، نه بالا بردن دستی سقف بی تصمیم بازبین.

## ۸. معیارهای پذیرش دستهٔ ۶
| معیار | هدف |
|---|---|
| معیار Taskها | چهار کارت از Task Card تا merge؛ ≥ ۳ ادغام‌شده با تست مرجع سبز. کارت blocked با تصمیم ثبت‌شدهٔ مالک شمرده می‌شود، نه شکست |
| معیار First-Pass Review Acceptance | نرخ ≥ ۶۰٪ (تعریف b1) |
| معیار Escaped Defects ‏(risk:high) | صفر (P6-01، و P6-02 اگر gate ‏high شد) |
| معیار Recovery Success ‏(B-06) | نرخ ≥ ۸۰٪ اگر قطعی رخ دهد؛ وگرنه «اندازه‌گیری نشد» |
| معیار Usage per Accepted PR | ثبت‌شده با `ledger stats`؛ جمع زیر سقف هفته |
| معیار رخداد امنیتی | صفر (خروج داده، تغییر policy به‌دست عامل، حذف داده بی پرچم) |
| معیار صفر regression | ‏CI ‏main پس از هر merge سبز (`main-check` ‏pass)؛ شمار فایل‌های `pnpm test:unit` کم نشود (پایه ۳۲۱) |
| معیار سقف نوبت (E142) | هر `JobScheduled` همان `max_turns` کارت را دارد |
| معیار اتصال accountRow ‏(P6-02) | آزمون نشان می‌دهد `existingAccountIds.accountRow` همان `accountRowOf` است و sweep با آن NOT EXISTS می‌سازد؛ dry-run بی DELETE |
| معیار پین پنجره ‏(P6-04) | آزمون روی head سبز است و با تغییر `VOICE_WINDOW_PLAN` بی bump می‌شکند؛ مقدارها بی‌تغییر |
| معیار فیلد log ‏(P6-03) | `hold_micros` تنها فیلد تازه است؛ log برآورد آن را دارد و `production_limit` ندارد؛ ثبت هزینه بی‌تغییر |
| معیار سند صدا ‏(P6-01) | سند چهار بخش دارد، با برچسب برای هر ادعا، بی دادهٔ کاربر و بی تغییر کد |
| دروازهٔ پایان | درخواست PR «Batch 6 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک |

## ۹. تصمیم‌های مالک
| تصمیم | موضوع | پاسخ | تاریخ |
|---|---|---|---|
| تصمیم E140 | پذیرش دستهٔ ۵ (#129) | approve مالک | ‏2026-11-06 |
| تصمیم E143 | پاک‌سازی پنج worktree دستهٔ ۵ | مالک انجام داد («DONE»، 14:27 UK)؛ فقط main مانده است | ‏2026-11-06 |
| تصمیم E141 | نسخهٔ مدل صدا | **الف**: کارت بررسی low (P6-01) (پیام بازبین ≈ 14:33–14:35 UK) | ‏2026-11-06 |
| تصمیم E142 | R98 و R99 | **الف**: به L-dev سفارش داده شد؛ تا R98، `--max-turns` از کارت (پیام بازبین ≈ 14:33–14:35 UK) | ‏2026-11-06 |
| تصمیم E136 | apply حذف ردیف‌های یتیم | روال تأیید: هیچ apply تا گزارش ≥ ۲۴ اجرای ساعتی | ‏2026-11-06 |
| تصمیم E144 | این برنامه و چهار کارت؛ ترتیب P6-02 ⇒ P6-04 ⇒ P6-03 ⇒ P6-01 | **الف** («با پیشنهاد بازبین موافقم. الف رو ادامه بدیم.»، 14:37 UK) | ‏2026-11-06 |
| تصمیم E145 | bump ‏`VOICE_MODEL_REVISION` و ضبط دوبارهٔ نمونه‌ها | **د: موکول** به برنامهٔ دستهٔ بعد؛ اکنون نه bump، نه ضبط دوباره؛ سند P6-01 بی‌تغییر پذیرفته شد | ‏2026-11-06 |
| تصمیم E146 | approve ‏Recalino ‏#130 (کارت‌های دستهٔ ۶) | approve مالک (15:17 UK) | ‏2026-11-06 |
| تصمیم E147 | approve ‏aeo ‏#107 ‏(R98) | approve مالک (15:17 UK)؛ merge در بلوک ۱۵۸ | ‏2026-11-06 |
| تصمیم E148 | approve ‏aeo ‏#108 ‏(R99) | approve مالک (15:17 UK)؛ merge در بلوک ۱۵۸ | ‏2026-11-06 |
| تصمیم E149 | قفل چهار TestPlan ‏P6 و پاک‌سازی worktreeهای دستهٔ ۵ و aeo | قفل مالک (seq ‏5138 تا 5141) و پاک‌سازی (16:01 UK) | ‏2026-11-06 |
| تصمیم E150 | approve ‏#131 ‏(P6-02، high) | approve مالک و پاک‌سازی (16:39 UK) | ‏2026-11-06 |
| تصمیم E151 | approve ‏#134 ‏(P6-01، high) | approve مالک (18:26 UK) | ‏2026-11-06 |
| تصمیم E152 | توقف برنامه‌ریزی‌شده در پایان دستهٔ ۶ | پس از merge پذیرش دستهٔ ۶، صفر Job و صفر قفل، و گزارش پذیرش به مالک؛ تا brief لایهٔ هماهنگی بی دستهٔ ۷، بی کارت تازه و بی بازبینی تازه | ‏2026-11-06 |
| تصمیم باز | افزودن `docs/architecture/01-system-inventory.md` به `write_paths` (نامزد ۴) | با مالک؛ تغییر policy | — |
