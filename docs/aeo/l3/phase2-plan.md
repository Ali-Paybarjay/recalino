# برنامهٔ فاز ۲ ‏L3 — دستهٔ اصلاح یافته‌های امنیتی فاز ۱

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.3 (2026-11-04، بلوک ۱۰۹ ‏L1: کارت v2 ‏P2-03 پس از blocked ‏attempt 1؛ وضعیت گام‌ها در §۲؛ E115 در §۸؛ همراه PR کارت v2 به Recalino می‌رود)؛ 0.2 (2026-11-04، بلوک ۱۰۲ ‏L1: نامزدهای پیگیری P2-01 در §۷؛ فقط در دفتر)؛ 0.1 (2026-11-04، بلوک ۹۹ ‏L1؛ پیش‌نویس برای بازبینی) |
| وضعیت | پیش‌نویس. فاز ۲ با تصمیم مالک E104 آغاز شد. E105 = الف و E106 = الف (2026-11-04). هیچ Job تا ادغام PR کارت‌ها اجرا نمی‌شود |
| بازبینی | بازبینی شد، ایست ۲۰۶ (2026-11-04): sha256 هر فایل، schema کارت‌ها و TestPlanها، قفل‌ها، جدایی owns_paths، ادعای ریسک و R87 |
| پایه | ‏Recalino ‏`main@d071ba7` (پس از G-L3، ‏#102)؛ aeo ‏`main@3b33d8b` |
| مرجع‌ها | برنامهٔ L3 ‏`l3-plan.md` ‏1.1 (§۴ تا §۶ و §۸)؛ جمع‌بندی فاز ۱ ‏`phase1-closeout.md` ‏0.2 (§۶)؛ پذیرش فاز ۱ ‏`docs/aeo/l3/phase1-acceptance.md` در Recalino (#102) |
| قید X1 | متن کد و اسناد Recalino خوانده نشد. owns_paths از نام فایل‌ها، کارت‌های فاز ۱، خروجی Jobها و گزارش‌های L1 آمده است |

برچسب‌ها: **Documented** (با مسیر سند) / **Observed by model** / **Not Verified**.

## ۱. هدف
- مورد هدف: شش یافتهٔ بخش ۶ جمع‌بندی فاز ۱ بسته شوند، زیر همان قواعد L3. پنج یافته از بازبین امنیتی آمده‌اند (همه hypothesis و غیرمسدودکننده) و یکی بدهی E95 است.
- مورد قواعد: مرحلهٔ دوم merge ‏(D7: low و medium بی approve مالک پس از همهٔ gateها؛ high با approve). سقف ۲۰ دلار هر بلوک و ۱۰۰ دلار هر هفته (D8). یک Task در هر بلوک.
- مورد بیرون از دامنه: اصلاح‌های حسابرسی محصولی بلوک ۸۰ (E106 = الف؛ §۷).

## ۲. فهرست و ترتیب کارت‌ها
| ترتیب | کارت | یافتهٔ منبع | ‏CWE | ریسک کارت | ریسک gate (برآورد از مسیر) | ‏merge | ‏owns_paths |
|---|---|---|---|---|---|---|---|
| گام ۱ | ‏P2-01 | ‏P1-07 ‏(#95)، sanitization ‏`module` | ‏CWE-22/706 | ‏low | ‏medium | ‏D7، بی approve | ‏`packages/core/src/plt/storage.ts`، `storage-compose-module.test.ts` |
| گام ۲ | ‏P2-04 | ‏P1-08 ‏(#96)، query در URL پایگاه محلی | ‏CWE-20 | **high** | ‏high (`packages/ops-cli/**`) | ‏approve مالک | ‏`packages/ops-cli/src/evaluation-config.ts`، `evaluation-config.test.ts` |
| گام ۳ | ‏P2-03 | ‏P1-09 ‏(#100)، پنجرهٔ غلتان هشدار | ‏CWE-778 | ‏low | ‏medium | ‏D7، بی approve | ‏`packages/core/src/ops/health.ts`، `health.test.ts`، `packages/core/src/proc/run-health.ts`؛ در v2 افزون بر این‌ها `packages/core/src/plt/health.ts`، `plt/jobs.ts`، `plt/index.ts`، `tools/test/core-exports-allowlist.test.ts` |
| گام ۴ | ‏P2-05 | ‏P1-09، پاک‌سازی ردیف‌های ساختگی آزمون int | ‏— | ‏medium | ‏medium؛ high اگر diff ‏`delete from` داشته باشد | ‏D7 یا approve | ‏`packages/core/src/ops/health.int.test.ts` |
| گام ۵ | ‏P2-02 | ‏P1-09، ایندکس partial ‏`finished_at` | ‏CWE-400 | **high** | ‏high (migration) | ‏approve مالک | ‏`supabase/migrations/20261104130000_proc_failed_run_finished_at_index.sql`، `tools/test/proc-failed-run-index-migration.test.ts`، `packages/core/src/proc/run-health-index.int.test.ts` |
| گام ۶ | ‏P2-06 | ‏P1-10 ‏(#99)، دو FK ‏`plt → acc` ‏(E95؛ E105 = الف) | ‏— | ‏high | ‏high (migration، drop) | ‏approve مالک | ‏`supabase/migrations/20261104130100_plt_drop_acc_user_foreign_keys.sql`، `tools/test/fk-follows-capability-map.test.ts`، `packages/core/src/db/types.ts` |

- مورد وضعیت گام‌ها (Observed by model، ledger؛ 2026-11-04):
  - مورد گام ۱: ‏P2-01 ⇒ Recalino ‏#104 ⇒ `main@1cf0455` (D7)، 1.91 دلار.
  - مورد گام ۲: ‏P2-04 ⇒ Recalino ‏#105 ⇒ `main@707dfea` (approve مالک)، 1.27 دلار.
  - مورد گام ۳: ‏P2-03 ‏attempt 1 ‏blocked (`job-20261104-27d93ec7`، 0.59 دلار، بی تغییر فایل). شمارش failed_jobs در `plt/health.ts` است و زمان چک پیشین فقط در `plt.job` (ADR-0002 قاعدهٔ ۴). کارت v2 با چهار فایل افزوده (E115). attempt 2 پس از merge کارت v2.
  - مورد گام‌های ۴ تا ۶: آغاز نشده‌اند.
- مورد ترتیب: نخست low، و DB آخر. P2-06 فقط پس از سبز شدن پنج کارت پیشین و با بودجهٔ باقی‌ماندهٔ هفته اجرا می‌شود.
- مورد ریسک (Observed by model): gate بیشینهٔ ریسک کارت و ریسک مسیر را می‌گیرد (`gates.ts`، `maxLevel`). در `policy/risk-rules.yaml` هر مسیر بی قاعده medium است، `packages/ops-cli/**` و `supabase/**` ‏high هستند، و بررسی معنایی `sql-destructive` هر `drop`، `alter`، `truncate` یا `delete from` در diff را high می‌کند. شش کارت فاز ۱ با ریسک کارت low در gate ‏medium سنجیده شدند (ledger).
- مورد اختلاف با دستور بلوک ۹۹: ریسک کارت P2-04 (low خواسته شده بود) و P2-02 (medium) به high رسید، چون مسیرشان آن را تعیین می‌کند. این‌گونه کارت مسیر merge واقعی را نشان می‌دهد.
- مورد جدایی: owns_paths شش کارت همپوشانی ندارند. هیچ TestPlan فایلی را قفل نمی‌کند که کارتِ پیش از آن در ترتیب تغییرش می‌دهد (Observed by model، بررسی اسکریپتی).
- مورد وابستگی‌های نرم: P2-05 و P2-02 به P2-03 وابسته‌اند (همان پرس‌وجوی failed_runs)، و P2-06 به P2-02 (هر دو migration تازه).

## ۳. جریان اجرا
- مورد پیش از Job اول:
  - مورد PR کارت‌ها: PR اسناد Recalino روی شاخهٔ `aeo/task-cards-10`، با `docs/aeo/tasks/P2-*.json` و همین سند در `docs/aeo/l3/phase2-plan.md`. approve مالک یعنی تأیید محتوای کارت‌ها.
  - مورد PR سیاست جدا (R87): دو فایل migration ‏P2-02 و P2-06 بیرون از `write_paths.recalino` هستند. یک PR در aeo، با approve مالک، فقط همین دو فایل را به `policy/targets.json` می‌افزاید (الگوی E93). تا آن PR ادغام نشود، `aeo run` و `--preflight` این دو کارت را پیش از هر رویداد رد می‌کنند.
- مورد هر Task: preflight ⇒ implement ⇒ verify (`pnpm test:unit`، با load کمتر از 2) ⇒ review ‏(code و security) ⇒ `pr open` ⇒ gate حدود ۳۰ ثانیه پس از push ⇒ CI ⇒ gate دوم ⇒ merge در فرمان جدا ⇒ `main-check --wait 15`.
- مورد verify: `pnpm test:unit` آزمون‌های `*.int.test.ts` را اجرا نمی‌کند. حکم آن‌ها با گام `pnpm test:int` در CI است (درس P1-09).
- مورد rework: حداکثر یک دور در هر کارت (`max_rework_rounds: 1`). یافتهٔ CI یا review با `--rework-findings` ‏(R88) داده می‌شود.

## ۴. بودجه (D8)
- مورد هفتهٔ جاری (Documented، پیام بلوک ۹۹ بازبین): تا 2026-11-04 ‏35.44 دلار از ledger مصرف شده است (`JobFinished.total_cost_usd` از 2026-11-02)، پس 64.56 دلار باقی است.
- مورد برآورد (Not Verified؛ برون‌یابی از فاز ۱): میانگین هر PR پذیرفته‌شده 2.12 دلار و میانه 1.48 دلار بود. بیشینه P1-09 با 6.92 دلار در سه تلاش بود.

| کارت | برآورد (دلار) | پایه |
|---|---|---|
| کارت P2-01، P2-04، P2-03 | ‏1.5 تا 3 هر کدام | ‏Task کوچک با دو بازبین |
| کارت P2-05 | ‏1.5 تا 4 | خطر blocked یا rework پس از CI |
| کارت P2-02 | ‏2 تا 5 | ‏migration و آزمون int |
| کارت P2-06 | ‏3 تا 7 | ‏migration، types، آزمون P1-10 و خطر blocked |
| جمع | ‏12 تا 26 | زیر سقف هفته؛ هر بلوک یک Task، زیر ۲۰ دلار |

## ۵. قواعد توقف
- مورد پایه: همهٔ قواعد `l3-plan.md` §۶ برقرارند: خطاهای Job، دادهٔ حساس، مرز owns_paths، سقف هزینه، رد طبقه‌بند و main قرمز.
- مورد افزوده‌های فاز ۲:
  - مورد blocked: هر blocked که کارت پیش‌بینی کرده است (P2-01 کلید بیرون از storage.ts؛ P2-03 دادهٔ چک پیشین؛ P2-05 grant؛ P2-02 types؛ P2-06 on delete، FK دیگر یا فایل بیرون از owns_paths) ⇒ توقف بلوک و گزینه‌ها برای مالک. L1 هیچ grant یا فایل تازه‌ای به کارت نمی‌افزاید.
  - مورد R87: رد preflight به دلیل write_paths ⇒ توقف تا ادغام PR سیاست.
  - مورد CI: شکست هر گام CI پس از سبز بودن verify ⇒ یک دور rework، و سپس توقف.
  - مورد regression: main قرمز پس از هر merge ⇒ freeze و توقف دسته.

## ۶. معیارهای پذیرش فاز ۲
| معیار | هدف |
|---|---|
| معیار Taskها | شش کارت از Task Card تا merge؛ ≥ ۵ ادغام‌شده با تست مرجع سبز. کارت blocked با تصمیم ثبت‌شدهٔ مالک شمرده می‌شود، نه شکست |
| معیار First-Pass Review Acceptance | نرخ ≥ ۶۰٪ (همان تعریف b1 فاز ۱) |
| معیار Escaped Defects ‏(risk:high) | صفر |
| معیار Recovery Success ‏(B-06) | نرخ ≥ ۸۰٪ اگر قطعی رخ دهد؛ وگرنه «اندازه‌گیری نشد»، همان فاز ۱ |
| معیار Usage per Accepted PR | ثبت‌شده با `ledger stats`؛ جمع زیر سقف هفته |
| معیار رخداد امنیتی | صفر (خروج داده، تغییر policy به‌دست عامل) |
| معیار صفر regression | ‏CI ‏main پس از هر merge سبز (`main-check` ‏pass)؛ شمار فایل‌های `pnpm test:unit` کم نشود |
| دروازهٔ پایان | درخواست PR «Phase 2 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک |

## ۷. نامزدهای دستهٔ بعد (E106 = الف؛ بی کارت در این دسته)
- مورد AUD-1 ‏F-1 (bug، high، confirmed، S): مهلت ثابت ۹۰ ثانیه برای PUT کامل هر قطعهٔ 8 MiB آپلود صوت، بی توجه به پیشرفت انتقال (`apps/web/src/ui/workspace/upload.ts`). اصلاح کم‌خطر: تایمر روی progress از نو شروع شود.
- مورد AUD-1 ‏F-6 (smell، low، confirmed، S): پیام خطای کلی برای هر شکست آپلود، و از دست رفتن علت (`automatic-learning.ts`، `upload.ts`، `manual-audio-manager.ts`). متن‌ها باید با `approved-copy.test.ts` هماهنگ شوند.
- مورد نامزدهای پیگیری از reviewهای P2-01 (Recalino ‏#104، بلوک ۱۰۲؛ همه غیرمسدودکننده؛ بی کارت؛ Observed by model از خروجی Jobها):
  - مورد security ‏nit ‏(`storage.ts:73`، potential): ‏`createObject` و `writeOwnedObject` هنوز `module` را بی سنجش در کلید می‌گذارند. امروز همهٔ callerها ثابت `"src"` می‌دهند. پرسش باز implementer هم همین است.
  - مورد security ‏nit ‏(`storage.ts:299`، hypothesis): سنجش از نوع denylist است و `.` تنها، نویسهٔ کنترلی، `%2F` و `%2E%2E` کدشده و slash مشابه Unicode را رد نمی‌کند. پیشنهاد بازبین: allowlist مانند `/^[a-z][a-z0-9_-]*$/`.
  - مورد code ‏minor ‏(`storage.ts:324`، hypothesis): attestation فقط `pnpm test:unit` را اجرا می‌کند، پس شاهد typecheck و lint فقط از CI است (در #104 سبز بود). نامزد controller یا TestPlan: یک فرمان typecheck در verify.
  - مورد code ‏nit (فایل آزمون): ‏`base_sha` ‏TestPlan ‏`d071ba7` است و پایهٔ attestation ‏`e691b53`، و TestPlan فایل آزمون تازه را قفل نمی‌کند. ایراد فرایندی است، نه نقص diff. پرسش باز implementer: شاخهٔ `targetObjectId` از `module` استفاده نمی‌کند.
- مورد بقیه: دیگر اصلاح‌های کم‌ریسک پنج حسابرسی بلوک ۸۰ (AUD-1 تا AUD-5). فهرست کامل در گزارش L1 بلوک ۸۰ است. انتخاب دستهٔ بعد با مالک است.

## ۸. تصمیم‌های مالک
| تصمیم | موضوع | پاسخ | تاریخ |
|---|---|---|---|
| تصمیم E104 | آغاز فاز ۲ | «فرمان پاک‌سازی انبوه رو بده و فاز دو رو شروع کنیم.» | ‏2026-11-04 |
| تصمیم E105 | دو FK ‏`plt → acc` | الف، حذف دو FK (P2-06) | ‏2026-11-04 |
| تصمیم E106 | اصلاح‌های حسابرسی بلوک ۸۰ | الف، نه در این دسته (§۷) | ‏2026-11-04 |
| تصمیم R87 | ‏PR سیاست برای دو فایل migration | ‏approve مالک؛ aeo ‏#99 ⇒ `dca8680` | ‏2026-11-04 |
| تصمیم E107 | متن هشدار failed_runs («in the last hour») پس از P2-03 | پیش‌فرض الف: متن بی‌تغییر، و یک سطر «متن معلق» در `docs/design/UI_COPY_PENDING.md` (سازوکار E93). مالک تا پیش از Job ‏P2-03 می‌تواند ب (تغییر متن در کارت v2) را بخواهد | ‏2026-11-04 |
| تصمیم E115 | راه P2-03 پس از blocked ‏attempt 1 | پیشنهاد بازبین گزینهٔ الف (کارت v2: تابع فقط‌خواندنی در `plt`، پارامتر `since` در `readPlatformHealth`، آغاز پنجره `max(prev_success.finished_at − 1h, now − 24h)`). approve مالک روی PR کارت v2 همان تصمیم است؛ منتظر approve | ‏2026-11-04 |
