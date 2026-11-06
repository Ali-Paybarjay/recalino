# برنامهٔ دستهٔ ۵ ‏L3 — Recalino ‏(P5-01 تا P5-04)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.1 (2026-11-05، بلوک ۱۴۴ ‏L1؛ بلوک ۱۴۵: سطر بازبینی و تصمیم دو انحراف در §۹) |
| وضعیت | پیش‌نویس. دستهٔ ۴ با پذیرش مالک بسته شد (E135، #123 ⇒ `2fa63d9`). دامنهٔ دستهٔ ۵ پیشنهاد بازبین است، با موافقت مالک («با پیشنهاد خودت موافقم»؛ Documented، ایست ۲۹۸). هیچ Job تا merge ‏PR کارت‌ها با approve مالک و قفل TestPlanها اجرا نمی‌شود |
| بازبینی | بازبینی شد، ایست ۳۰۱ (2026-11-05): hash، schema، ۱۶ قفل، owns_paths، ریسک، R87 و R91؛ قفل عمدی `account-orphans.ts` در P5-01 درست است. هر دو انحراف پذیرفته شد (§۹) |
| پایه | Recalino ‏`main@2fa63d94d365c47e8674db62b215347bd05de7e2` (پس از پذیرش دستهٔ ۴، #123)؛ aeo ‏`main@0e98bda` |
| مرجع‌ها | پذیرش دستهٔ ۴ ‏`docs/aeo/l3/phase4-acceptance.md` (§۶ و §۷)؛ جمع‌بندی دستهٔ ۴ ‏`docs/l3/phase4-closeout.md` ‏0.2؛ گزارش L1 بلوک ۸۰ (AUD-2 تا AUD-4)؛ خروجی Jobهای review ‏P4-01 ‏(`job-20261105-b5d8d1e8`، `job-20261105-5770a49d`) و P4-04 ‏(`job-20261105-22ff224d`) |
| قید X1 | متن کد و اسناد Recalino خوانده نشد. owns_paths از نام فایل‌ها (`git ls-tree`)، گزارش بلوک ۸۰ و خروجی Jobهای دستهٔ ۴ آمده است. sha256 فایل‌های قفل از blobهای `2fa63d9` است |

برچسب‌ها: **Documented** (با مسیر سند) / **Observed by model** / **Not Verified**.

## ۱. هدف
- مورد دامنه (Documented، پیام بازبین بلوک ۱۴۴): چهار کار.
  - مورد P5-01: سیم‌کشی و زمان‌بندی دوره‌ای job نگهداشت ‏P4-01، با پیش‌فرض dry-run، و آزمون export ‏`existingAccountIds` در acc. این نامزد هر دو reviewer ‏P4-01 است.
  - مورد P5-02: nitهای امنیتی دستهٔ ۴ که هنوز بازند: CWE-367 در تراکنش apply، و برآورد هزینهٔ گام بیش از hold ‏(runtime.ts:240).
  - مورد P5-03 و P5-04: دو اصلاح کم‌ریسک و confirmed از AUD-2 تا AUD-4، بی تغییر رفتار کاربر یا متن UI (§۴).
- مورد CWE-693 ‏P4-01 (سیم‌کشی فقط با `existingAccountIds`): در P5-01 بسته می‌شود، چون سیم‌کشی همان‌جا رخ می‌دهد. آزمون acc معنای «حساب tombstoned هم موجود است» را می‌سنجد. P5-02 آن را تکرار نمی‌کند.
- مورد E136 (باز): اجرای apply در production. پس از چند اجرای dry-run زمان‌بندی‌شدهٔ P5-01 و دیدن شمار، تصمیم جدای مالک است. در هیچ کارت این دسته نیست (E134).

## ۲. فهرست و ترتیب کارت‌ها
| ترتیب | کارت | یافتهٔ منبع | نوع | ریسک کارت | ریسک gate (برآورد از مسیر) | ‏merge | ‏owns_paths |
|---|---|---|---|---|---|---|---|
| گام ۱ | ‏P5-03 | ‏AUD-2 ‏F-7 (confirmed): prompt بی افزایش `promptVersion` تغییر کرد | test | ‏low | ‏medium | ‏D7 | `packages/core/src/proc/prompt-version.test.ts` (تازه) |
| گام ۲ | ‏P5-04 | ‏AUD-3 ‏F-9 (confirmed): تنظیمات pipeline صدا بی تغییر `VOICE_MODEL_REVISION` عوض شد | test | ‏low | ‏medium | ‏D7 | `apps/web/src/server/voice-engine.test.ts`، `apps/web/src/server/voice-engine.ts` (فقط `export`) |
| گام ۳ | ‏P5-01 | انحراف AC-5 ‏P4-01؛ آزمون جاافتادهٔ هر دو review؛ CWE-693 | feature | ‏medium | ‏medium | ‏D7 | `packages/core/src/acc/jobs.ts`، `acc/jobs.test.ts` (تازه)، `acc/acc.test.ts` |
| گام ۴ | ‏P5-02 | ‏security ‏nit ‏P4-01 (CWE-367)؛ security ‏nit ‏P4-04 | bugfix | **high** | ‏high (`sql-destructive`، اگر diff ‏`delete from` دارد) | ‏approve مالک | `packages/core/src/plt/account-orphans.ts`، `account-orphans.test.ts`، `account-orphans.int.test.ts`، `acc/account.ts`، `acc/index.ts`، `proc/steps/runtime.ts`، `runtime.test.ts` |

- مورد ترتیب: low و medium اول، high آخر. یک Task در هر بلوک.
  - مورد P5-01 پیش از P5-02: سیم‌کشی dry-run پیش از تغییر مسیر حذف می‌آید. پس هر اجرای apply آینده روی کدی است که P5-02 سخت کرده است.
- مورد جدایی (Observed by model، اسکریپت): owns_paths چهار کارت هم‌پوشانی ندارند. هیچ TestPlan فایلی را قفل نمی‌کند که کارتِ پیش از آن در ترتیب تغییرش می‌دهد.
  - مورد قفل پیشین: تنها قفلی که کارتِ بعدی تغییرش می‌دهد، `plt/account-orphans.ts` در P5-01 است. P5-02 آن را پس از merge ‏P5-01 تغییر می‌دهد. این قفل نشان می‌دهد P5-01 به مسیر حذف دست نمی‌زند.
- مورد قفل‌ها (sha256 در `2fa63d9`):
  - مورد P5-03: `proc/knowledge-generation.ts`، `proc/study-prompt.ts`، `config/openrouter-defaults.json` و `proc/steps/publish.ts`. کارت فقط آزمون می‌افزاید.
  - مورد P5-04: `voc/matching.ts`، `voc/linking.ts` و `voc/analysis.ts`.
  - مورد P5-01: `plt/account-orphans.ts`، `plt/maintenance.ts`، `proc/worker.ts` و `priv/deletion.ts`.
  - مورد P5-02: `plt/notifications.ts`، `priv/deletion.ts`، `proc/worker.ts`، `quota/costs.ts` و `aip/pricing.ts`.
- مورد ریسک (Observed by model، `policy/risk-rules.yaml`):
  - مورد medium: هیچ مسیر کد این دسته قاعدهٔ high ندارد. نام هیچ فایل واژهٔ auth، delet، cleanup یا retention ندارد.
  - مورد P5-01: diff فقط ثبت یک job فقط‌شمارنده است. اگر `delete from` در diff بیاید، `sql-destructive` آن را high می‌کند. کارت این را منع می‌کند.
  - مورد P5-02: مسیر حذف را تغییر می‌دهد، پس high است و approve مالک می‌خواهد.
- مورد R91 (Observed by model، از مسیرها): هیچ کارت ‏Task ‏DB نیست. owns_paths با `supabase/**` و `packages/core/src/db/**` هم‌پوشان نیستند.
- مورد migration: هیچ کارت migration ندارد. اگر لازم شد، blocked.
- مورد R87 (Observed by model): همهٔ owns_paths درون `write_paths.recalino` هستند (`apps/web/src/**`، `packages/core/**`).

## ۳. P5-01 و P5-02 در تفصیل (job نگهداشت)
- مورد P5-01:
  - مورد سیم‌کشی: `accountOrphansJob(existingAccountIds)` در `accPeriodicJobs` ‏(`acc/jobs.ts`) ثبت می‌شود. این همان محلی است که implementer ‏P4-01 گزارش داد. acc هر دو ماژول را می‌بیند (Documented، خروجی `job-20261105-2947b1f8`).
  - مورد بازه: همان بازهٔ jobهای دوره‌ای موجود acc، یا روزانه اگر بازه‌ای نیست.
  - مورد dry-run: job ثبت‌شده فقط شمار می‌دهد. payload آن `strictObject` تهی است و `apply` را نمی‌پذیرد (P4-01). پس زمان‌بندی هرگز حذف نمی‌کند.
  - مورد predicate: فقط `existingAccountIds` به job داده می‌شود (CWE-693). آزمون در acc نشان می‌دهد حساب tombstoned ‏(`deleted_at` پر) هم «موجود» است، و حساب ناموجود نه.
  - مورد آزمون زمان‌بندی: یک case غیر int با پایگاه ساختگی نشان می‌دهد job دوره‌ای ثبت‌شده اجرا می‌شود، شمار هر جدول را بی شناسه ثبت می‌کند، و هیچ دستور delete یا begin اجرا نمی‌کند.
  - مورد blocked: اگر ثبت به فایلی بیرون از owns_paths نیاز دارد (مثلاً `proc/worker.ts` قفل)، Implementer با نام فایل و گزینه‌ها blocked برمی‌گرداند.
- مورد P5-02:
  - مورد CWE-367: درون تراکنش apply، حسابی که میان بررسی و DELETE ساخته شود، حذف را متوقف نمی‌کند. reviewer آن را اکنون بهره‌برداری‌پذیر ندانست (hypothesis). گزینه‌ها برای Implementer:
    - مورد ‏الف (پیشنهاد): بررسی «حساب نیست» در همان دستور DELETE ‏(NOT EXISTS). عبارت از یک export در acc می‌آید، پس نام `acc.*` در کد غیرآزمونی plt نمی‌آید (AC-2 ‏P4-01).
    - مورد ‏ب: تراکنش apply با سطح SERIALIZABLE، و رها کردن اجرا هنگام خطای serialization.
    - مورد blocked: اگر هیچ‌یک بی شکستن مرز acc و plt یا آزمون schema-names شدنی نیست، Implementer blocked برمی‌گرداند.
  - مورد برآورد هزینه ‏(runtime.ts:240): reviewer ‏P4-04 گفت `estimatedMicros` ممکن است از hold بیشتر شود، که به سمت امن است. clamp به hold هزینهٔ ثبت‌شده را کمتر از واقع می‌کند. پس پیشنهاد L1 clamp نیست، بلکه یک log عددی است، بی متن کاربر، وقتی برآورد از hold بیشتر شود. رفتار ثبت هزینه بی‌تغییر می‌ماند. بازبین آن را پذیرفت (ایست ۳۰۱).
  - مورد بی‌تغییر: پیش‌فرض dry-run، سقف‌ها (۵۰۰ و ۵۰۰۰)، رزرو و سقف‌های `quota/costs.ts`.

## ۴. P5-03 و P5-04 در تفصیل (گزینه‌های AUD-2 تا AUD-4)
| گزینه | یافته | تغییر | ریسک | پیشنهاد |
|---|---|---|---|---|
| ‏الف | ‏AUD-2 ‏F-7 (confirmed) | آزمونی که hash قالب system prompt (بی ورودی کاربر) را همراه `promptVersion` ‏(`config/openrouter-defaults.json`) پین می‌کند. تغییر prompt بی بالا بردن `promptVersion` آزمون را می‌شکند | کم: فقط آزمون. رفتار مدل و metadata بی‌تغییر | ✔ ‏P5-03 |
| ‏ب | ‏AUD-3 ‏F-9 (confirmed) | آزمونی که تنظیمات pipeline صدا (spanMode، merge threshold و آستانه‌ها) را همراه `VOICE_MODEL_REVISION` پین می‌کند. تغییر تنظیمات بی بالا بردن revision آزمون را می‌شکند. در `voice-engine.ts` فقط `export` افزوده می‌شود، اگر لازم است | کم: فقط آزمون و export. revision و بردارهای ذخیره‌شده بی‌تغییر | ✔ ‏P5-04 |
| ‏پ | ‏AUD-2 ‏F-3 (confirmed) | ثبت سنجه‌های پوشش (نسبت production به بودجه، پوشش پنجره‌ای) در metadata نسل، بی تغییر رفتار | متوسط: `knowledge-generation.ts` و `publish.ts` و schema ‏metadata را لمس می‌کند | — (دستهٔ بعد) |
| ‏ت | ‏AUD-3 ‏F-11 (potential) | محاسبهٔ دوبارهٔ `ambiguous` پس از حلقهٔ پیوند | کم، ولی نمایش ابهام برای کاربر عوض می‌شود و یافته تأییدنشده است | — |
| ‏ث | ‏AUD-4 ‏F-10 (potential) | `catch` در `material-page.tsx` مانند صفحهٔ session | کم، ولی رفتار کاربر هنگام خطا عوض می‌شود | — |

- مورد P5-04 و ناسازگاری گذشته: آزمون فقط تغییر آینده را می‌گیرد. ناسازگاری commit ‏e460366 (بردارهای دو روش با یک revision) را درست نمی‌کند. بالا بردن revision ضبط دوبارهٔ نمونهٔ صدا را می‌خواهد، که رفتار کاربر است و تصمیم مالک.

## ۵. جریان اجرا
- مورد پیش‌نیاز ۱: PR کارت‌های دستهٔ ۵ روی `aeo/task-cards-15` با approve مالک. این PR شامل چهار کارت، چهار TestPlan و `docs/aeo/l3/phase5-plan.md` است (high، `docs/aeo/**`).
- مورد پیش‌نیاز ۲ (R92): مالک هر TestPlan را پیش از نخستین Job آن قفل می‌کند.
- مورد گام‌های هر Task: preflight ⇒ implement ⇒ verify (load1 زیر ۲) ⇒ review:code و review:security پشت سر هم ⇒ `pr open --task` ⇒ gate حدود ۳۰ ثانیه پس از open ⇒ gate پس از CI (برای P5-02 با `--attestation`، `--review` و `--security-review`) ⇒ `merge --dry-run` ⇒ merge در فرمان جدا (D7، یا approve مالک برای P5-02) ⇒ `ledger verify` ⇒ `main-check --wait 15`.

## ۶. بودجه (D8)
- مورد هفتهٔ جاری (Observed by model، ledger؛ هفته از 2026-11-02T00:00Z): تا پایان دستهٔ ۴ ‏**64.35 دلار از ۱۰۰** مصرف شده است، پس 35.65 دلار تا پایان یکشنبه باقی است.
- مورد برآورد (Not Verified؛ برون‌یابی از دستهٔ ۴: میانگین 2.61، میانه 3.25، بیشینه 3.41):

| کارت | برآورد (دلار) | پایه |
|---|---|---|
| کارت P5-03 | ‏1 تا 2.5 | فقط آزمون؛ همانند P4-04 (1.18) |
| کارت P5-04 | ‏1 تا 2.5 | فقط آزمون و export |
| کارت P5-01 | ‏2 تا 4 | سیم‌کشی و دو آزمون؛ کمتر از P4-01 |
| کارت P5-02 | ‏3 تا 7 | مسیر حذف، آزمون int، دو review ‏high |
| جمع | ‏7 تا 16 | زیر باقی‌ماندهٔ هفته؛ هر بلوک یک Task، زیر ۲۰ دلار |

## ۷. قواعد توقف
- مورد پایه: همهٔ قواعد `l3-plan.md` §۶، و phase2-plan §۵ تا phase4-plan §۷ برقرارند: خطاهای Job، دادهٔ حساس، مرز owns_paths، سقف هزینه، رد طبقه‌بند، main قرمز، R87، R92، یک دور rework پس از CI، و توقف push یا رد GitHub (سه رد ⇒ توقف).
- مورد افزوده‌های دستهٔ ۵:
  - مورد P5-01: هر diffی که `apply: true` را در زمان‌بندی بگذارد، `delete from` بیاورد یا predicateی جز `existingAccountIds` به job بدهد ⇒ رد در review یا gate و توقف.
  - مورد P5-02: هر تغییر در پیش‌فرض dry-run یا سقف‌ها، یا نامی از `acc.*` در کد غیرآزمونی plt ⇒ رد و توقف.
  - مورد P5-03 و P5-04: هر تغییر در متن prompt، `promptVersion`، `VOICE_MODEL_REVISION` یا مقدار تنظیمات صدا ⇒ fail ‏testplan-lock یا رد review و توقف.
  - مورد verify ناپایدار: یک verify دوباره، سپس یک rework با `--rework-findings` (روال ایست ۲۸۸).

## ۸. معیارهای پذیرش دستهٔ ۵
| معیار | هدف |
|---|---|
| معیار Taskها | چهار کارت از Task Card تا merge؛ ≥ ۳ ادغام‌شده با تست مرجع سبز. کارت blocked با تصمیم ثبت‌شدهٔ مالک شمرده می‌شود، نه شکست |
| معیار First-Pass Review Acceptance | نرخ ≥ ۶۰٪ (تعریف b1) |
| معیار Escaped Defects ‏(risk:high) | صفر (P5-02) |
| معیار Recovery Success ‏(B-06) | نرخ ≥ ۸۰٪ اگر قطعی رخ دهد؛ وگرنه «اندازه‌گیری نشد» |
| معیار Usage per Accepted PR | ثبت‌شده با `ledger stats`؛ جمع زیر سقف هفته |
| معیار رخداد امنیتی | صفر (خروج داده، تغییر policy به‌دست عامل، حذف داده بی پرچم) |
| معیار صفر regression | ‏CI ‏main پس از هر merge سبز (`main-check` ‏pass)؛ شمار فایل‌های `pnpm test:unit` کم نشود (پایه ۳۱۹) |
| معیار dry-run زمان‌بندی‌شده ‏(P5-01) | آزمون نشان می‌دهد job دوره‌ای ثبت‌شده شمار را بی شناسه ثبت می‌کند و هیچ حذفی رخ نمی‌دهد؛ حساب tombstoned «موجود» است |
| معیار مسیر apply ‏(P5-02) | آزمون نشان می‌دهد apply فقط ردیف یتیم و تا سقف پاک می‌کند؛ پیش‌فرض dry-run بی‌تغییر |
| معیار پین‌ها ‏(P5-03، P5-04) | آزمون‌های تازه روی head سبزند؛ prompt، `promptVersion`، revision و تنظیمات صدا بی‌تغییرند |
| دروازهٔ پایان | درخواست PR «Batch 5 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک |

## ۹. تصمیم‌های مالک
| تصمیم | موضوع | پاسخ | تاریخ |
|---|---|---|---|
| تصمیم E134 | دامنهٔ پس از دستهٔ ۴؛ apply ‏P4-01 | «با پیشنهاد خودت موافقم»: apply در production فقط پس از dry-run زمان‌بندی‌شده | ‏2026-11-05 |
| تصمیم E135 | پذیرش دستهٔ ۴ (#123) | approve مالک | ‏2026-11-05 |
| تصمیم باز E136 | اجرای apply ‏P4-01 در production | پس از dry-runهای زمان‌بندی‌شدهٔ P5-01 و دیدن شمار، با مالک | — |
| تصمیم بازبین | CWE-693 ‏P4-01 (§۱) | پذیرفته: در P5-01 بسته می‌شود (سیم‌کشی فقط با `existingAccountIds` و آزمون acc)، نه در P5-02 (ایست ۳۰۱) | ‏2026-11-05 |
| تصمیم بازبین | برآورد هزینهٔ بیش از hold ‏(§۳) | پذیرفته: «log، نه clamp» (ایست ۳۰۱) | ‏2026-11-05 |
| تصمیم با approve PR کارت‌ها | گزینه‌های P5-03 و P5-04 (§۴) و ترتیب P5-03 ⇒ P5-04 ⇒ P5-01 ⇒ P5-02 | پیشنهاد L1: الف و ب؛ approve مالک PR کارت‌ها = تأیید | — |
