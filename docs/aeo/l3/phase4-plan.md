# برنامهٔ دستهٔ ۴ ‏L3 — Recalino ‏(P4-01، P4-02، P4-04)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.1 (2026-11-05، بلوک ۱۳۷ ‏L1؛ پیش‌نویس برای بازبینی) |
| وضعیت | پیش‌نویس. دستهٔ ۴ با تصمیم مالک E129 («دستهٔ ۴: پیشنهاد بازبین») آغاز شد. E130 = الف (بی سقف مطلق PUT؛ P4-03 حذف شد). هیچ Job تا merge ‏PR کارت‌ها با approve مالک و قفل TestPlanها اجرا نمی‌شود |
| بازبینی | بازبینی شد، ایست ۲۸۱ (2026-11-05): sha256 هر فایل، schema کارت‌ها و TestPlanها، دوازده قفل، جدایی owns_paths، ریسک، R87 و R91 |
| پایه | Recalino ‏`main@7a794c5` (پس از پذیرش دستهٔ ۳، #118)؛ aeo ‏`main@0e98bda` (R90، R92، R93 و R96 در main) |
| مرجع‌ها | پذیرش دستهٔ ۳ ‏`docs/aeo/l3/phase3-acceptance.md` (§۵ تا §۸)؛ جمع‌بندی دستهٔ ۳ ‏`docs/l3/phase3-closeout.md` ‏0.2؛ گزارش L1 بلوک ۸۰ (AUD-5)؛ برنامهٔ دستهٔ ۳ ‏`docs/l3/phase3-plan.md` (§۵ و §۶)؛ پیش‌نویس `docs/l3/cards/P3-04-b.draft.json` |
| قید X1 | متن کد و اسناد Recalino خوانده نشد. owns_paths از نام فایل‌ها (`git ls-tree`)، گزارش بلوک ۸۰ و خروجی Jobهای فاز ۲ و دستهٔ ۳ آمده است |

برچسب‌ها: **Documented** (با مسیر سند) / **Observed by model** / **Not Verified**.

## ۱. هدف
- مورد دامنه (Documented، پیام بلوک ۱۳۷ بازبین؛ E129): سه کار.
  - مورد آپلود: آخرین شکاف آپلود، یعنی عکس تخته بی progress (nit ‏#116).
  - مورد هزینه: یک اصلاح کم‌ریسک هزینه از AUD-5.
  - مورد داده: گزینهٔ ب ‏E123، یعنی job نگهداشت ردیف‌های یتیم plt، با پیش‌فرض dry-run.
- مورد E130 = الف (مالک، 15:59 UK): هیچ سقف مطلق برای PUT پیش‌رونده نیست؛ رفتار P3-01 می‌ماند. پس کارت P4-03 نوشته نشد. شماره‌ها همان می‌مانند.

## ۲. فهرست و ترتیب کارت‌ها
| ترتیب | کارت | یافتهٔ منبع | نوع | ریسک کارت | ریسک gate (برآورد از مسیر) | ‏merge | ‏owns_paths |
|---|---|---|---|---|---|---|---|
| گام ۱ | ‏P4-02 | ‏security ‏nit ‏P3-01 (#116): PUT عکس تخته با fetch و ۹۰ ثانیهٔ ثابت | bug | ‏medium | ‏medium | ‏D7، بی approve | `apps/web/src/ui/workspace/automatic-learning.ts`، `automatic-learning.test.ts` |
| گام ۲ | ‏P4-04 | ‏AUD-5 ‏F-3: هزینهٔ هر TTS همیشه برابر سقف ۵۰۰۰ میکرودلار | bug، low، confirmed | ‏low | ‏medium | ‏D7، بی approve | `packages/core/src/proc/steps/runtime.ts`، `runtime.test.ts` |
| گام ۳ | ‏P4-01 | ‏P2-06 (#111)، CWE-459؛ E123 ب | feature (حذف داده) | **high** | ‏high (`sql-destructive`) | ‏approve مالک | `packages/core/src/plt/account-orphans.ts` (تازه)، `account-orphans.test.ts`، `account-orphans.int.test.ts`، `plt/index.ts`، `plt/jobs.ts`، `packages/core/src/acc/index.ts`، `acc/account.ts` |

- مورد ترتیب (Documented، پیام بازبین پس از E130): P4-02 ⇒ P4-04 ⇒ P4-01. high آخر است. یک Task در هر بلوک.
- مورد جدایی (Observed by model، اسکریپت): owns_paths سه کارت هم‌پوشانی ندارند. هیچ TestPlan فایلی را قفل نمی‌کند که کارت دیگری تغییرش می‌دهد.
- مورد قفل‌ها:
  - مورد P4-02: `upload.ts`، `upload-progress.ts`، `upload-copy.ts`، `approved-copy.test.ts` و `upload-concurrency.ts`. ‏`extendUploadDeadline` و `uploadWithProgress` ‏P3-01 بی‌تغییر به کار می‌روند.
  - مورد P4-04: `aip/pricing.ts`، `aip/openrouter.ts` و `quota/costs.ts`.
  - مورد P4-01: `plt/notifications.ts`، `apps/web/src/server/privacy-routes.ts`، `priv/deletion.ts` و `proc/worker.ts`.
- مورد ریسک (Observed by model، `policy/risk-rules.yaml`):
  - مورد medium: مسیرهای P4-02 و P4-04 قاعدهٔ high ندارند.
  - مورد high: P4-01 ‏high است، چون حذف `delete from` در diff بررسی معنایی `sql-destructive` را برمی‌انگیزد. نام فایل‌ها عمداً واژهٔ delet، cleanup یا retention ندارند.
- مورد R91 (Observed by model، `isDbTask`): هیچ کارت دستهٔ ۴ ‏Task ‏DB نیست. owns_paths با `supabase/**` و `packages/core/src/db/**` هم‌پوشان نیستند، پس review منتظر CI نمی‌ماند.
- مورد migration: هیچ کارت migration ندارد، پس `schema-version.generated.ts` لازم نیست. اگر P4-01 به migration یا grant برسد، blocked.
- مورد R87 (Observed by model): همهٔ owns_paths درون `write_paths.recalino` هستند (`apps/web/src/**`، `packages/core/**`).
- مورد R92 (Observed by model، preflight بلوک ۱۳۷، بی رویداد): preflight هر سه کارت را با «no TestPlanLocked … (R92)» رد کرد. این انتظار می‌رفت. پس از merge ‏PR کارت‌ها و قفل مالک، رد برداشته می‌شود.

## ۳. P4-01 در تفصیل (حذف داده)
- مورد پیش‌فرض dry-run: job بی پرچم فقط شمار ردیف‌های بی حساب هر جدول را برمی‌گرداند و بی محتوا ثبت می‌کند. هیچ دستور حذفی اجرا نمی‌کند.
- مورد apply: حذف فقط با پرچم صریح و با سقف شمار در هر اجرا رخ می‌دهد. ردیف کاربر فعال و کاربر soft-deleted پیش از hook ‏privacy هرگز پاک نمی‌شود.
- مورد مرز ماژول: plt فقط از یک export فقط‌خواندنی acc می‌خواند (ADR-0002 قاعدهٔ ۴). اگر چنین exportی نیست، تنها یک تابع فقط‌خواندنی به acc افزوده می‌شود.
- مورد blocked:
  - مورد grant: نقش برنامه اجازهٔ delete ندارد. blocked با متن دقیق grant. Not Verified؛ `clearAccountNotifications` همین حالا هر دو جدول را پاک می‌کند.
  - مورد فایل: زمان‌بندی فایلی بیرون از owns_paths بخواهد. job قابل فراخوان می‌ماند و محل در گزارش می‌آید.
  - مورد migration: migration لازم شود.
- مورد اجرای apply در production: تصمیم جداگانهٔ مالک است، پس از دیدن شمار dry-run. در این کارت نیست.

## ۴. P4-04 در تفصیل (گزینه‌های AUD-5)
| گزینه | یافته | تغییر | ریسک | پیشنهاد |
|---|---|---|---|---|
| ‏الف (برگزیده) | ‏F-3 (bug، low، confirmed، S) | `usageKind` گام `speech` را به `tts` نگاشت کند؛ یک case در `runtime.test.ts` | کم: یک نگاشت. رفتار کاربر بی‌تغییر. اثر بر عدد ثبت‌شده، اگر نرخ tts نیست، Not Verified، و کارت حالت blocked آن را دارد | ✔ |
| ‏ب | ‏F-8 (smell، low، confirmed، S) | `reasoning_tokens` فقط در log عددی provider_step، بی تغییر schema ‏ledger | کم، ولی `openrouter.ts` را لمس می‌کند و پوشش آزمونش ضعیف‌تر است | — |
| ‏پ | ‏F-4 (risk، medium، confirmed) | سنجش فقط‌خواندنی revision نرخ Gemini در production | کار کد نیست؛ کنسول مدیریت و تصمیم مالک | — |

## ۵. جریان اجرا
- مورد پیش‌نیاز ۱: PR کارت‌های دستهٔ ۴ روی `aeo/task-cards-14` با approve مالک. این PR شامل سه کارت، سه TestPlan و `docs/aeo/l3/phase4-plan.md` است.
- مورد پیش‌نیاز ۲ (R92): مالک هر TestPlan را پیش از نخستین Job آن قفل می‌کند. اکنون preflight بی قفل رد می‌کند.
- مورد پیش‌نیاز ۳ (انجام شد): R90 ‏(#106) در aeo ادغام شد (`0e98bda`، بلوک ۱۳۶)، پس انتقال گواهی verify و reviewها پس از E22 با patch-id بی‌تغییر فعال است (جز review:security ‏PRهای high).
- مورد گام‌های هر Task: preflight ⇒ implement ⇒ verify (load1 زیر ۲) ⇒ review:code و review:security پشت سر هم ⇒ `pr open --task` ⇒ gate حدود ۳۰ ثانیه پس از open ⇒ gate پس از CI ⇒ `merge --dry-run` ⇒ merge در فرمان جدا (D7، یا approve مالک برای P4-01) ⇒ `ledger verify` ⇒ `main-check --wait 15`.

## ۶. بودجه (D8)
- مورد هفتهٔ جاری (Observed by model، ledger): تا پایان دستهٔ ۳ ‏**56.51 دلار از ۱۰۰** مصرف شده است، پس 43.49 دلار باقی است.
- مورد برآورد (Not Verified؛ برون‌یابی از دستهٔ ۳: میانگین 2.22، میانه 2.06، بیشینه 3.27):

| کارت | برآورد (دلار) | پایه |
|---|---|---|
| کارت P4-02 | ‏1.5 تا 3.5 | همانند P3-01 (2.01) |
| کارت P4-04 | ‏1 تا 2.5 | یک نگاشت و یک case |
| کارت P4-01 | ‏3 تا 7 | کد تازه، آزمون int، خطر blocked |
| جمع | ‏5.5 تا 13 | زیر باقی‌ماندهٔ هفته؛ هر بلوک یک Task، زیر ۲۰ دلار |

## ۷. قواعد توقف
- مورد پایه: همهٔ قواعد `l3-plan.md` §۶، `phase2-plan.md` §۵ و `phase3-plan.md` §۵ برقرارند: خطاهای Job، دادهٔ حساس، مرز owns_paths، سقف هزینه، رد طبقه‌بند، main قرمز، R87، R92، یک دور rework پس از CI، و توقف push یا رد GitHub.
- مورد افزوده‌های دستهٔ ۴:
  - مورد blocked پیش‌بینی‌شده: هر blocked که کارت پیش‌بینی کرده است ⇒ توقف بلوک و گزینه‌ها برای مالک. موارد:
    - مورد P4-02: تغییر `upload.ts` یا `upload-progress.ts` لازم شود.
    - مورد P4-04: اثر بر enforcement سقف، یا نیاز به pricing، config یا migration.
    - مورد P4-01: grant، migration، یا فایل زمان‌بندی بیرون از owns_paths.
  - مورد P4-01: هر diffی که بی پرچم حذف کند، یا ردیف کاربر فعال را بگیرد ⇒ رد در review یا gate و توقف.
  - مورد متن UI: هر تغییر در `upload-copy.ts` یا `approved-copy.test.ts` ⇒ fail ‏testplan-lock و توقف.

## ۸. معیارهای پذیرش دستهٔ ۴
| معیار | هدف |
|---|---|
| معیار Taskها | سه کارت از Task Card تا merge؛ ≥ ۲ ادغام‌شده با تست مرجع سبز. کارت blocked با تصمیم ثبت‌شدهٔ مالک شمرده می‌شود، نه شکست |
| معیار First-Pass Review Acceptance | نرخ ≥ ۶۰٪ (تعریف b1) |
| معیار Escaped Defects ‏(risk:high) | صفر (P4-01) |
| معیار Recovery Success ‏(B-06) | نرخ ≥ ۸۰٪ اگر قطعی رخ دهد؛ وگرنه «اندازه‌گیری نشد» |
| معیار Usage per Accepted PR | ثبت‌شده با `ledger stats`؛ جمع زیر سقف هفته |
| معیار رخداد امنیتی | صفر (خروج داده، تغییر policy به‌دست عامل، حذف داده بی پرچم) |
| معیار صفر regression | ‏CI ‏main پس از هر merge سبز (`main-check` ‏pass)؛ شمار فایل‌های `pnpm test:unit` کم نشود (پایه ۳۱۸) |
| معیار dry-run ‏P4-01 | آزمون نشان می‌دهد dry-run شمار را گزارش می‌دهد و بی پرچم هیچ حذفی رخ نمی‌دهد؛ apply فقط تا سقف و فقط ردیف یتیم |
| معیار آپلود عکس | آزمون «PUT عکس کند ولی پیش‌رونده» ‏(P4-02) سبز؛ «PUT عکس گیرکرده» همچنان timeout |
| دروازهٔ پایان | درخواست PR «Batch 4 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک |

## ۹. تصمیم‌های مالک
| تصمیم | موضوع | پاسخ | تاریخ |
|---|---|---|---|
| تصمیم E129 | آغاز دستهٔ ۴ | «دستهٔ ۴: پیشنهاد بازبین» | ‏2026-11-05 |
| تصمیم E130 | سقف مطلق PUT پیش‌رونده | **الف** («E130: الف»): بی سقف مطلق؛ رفتار P3-01 می‌ماند؛ P4-03 حذف شد | ‏2026-11-05 |
| تصمیم باز | اجرای apply ‏P4-01 در production | پس از merge و دیدن شمار dry-run، با مالک | — |
