# Recalino — پذیرش دستهٔ ۴ ‏L3 ‏(Batch 4 acceptance)

- **نسخه:** 0.1 · تاریخ: 2026-11-05 · نویسنده: سشن L1 ‏(`aeo-b5`) · پایه: `main@9bf9163`
- **مرجع معیارها:** `docs/aeo/l3/phase4-plan.md` §۸ (نسخهٔ 0.2 در همین PR).
- **مرجع داده:**
  - سند جمع‌بندی دستهٔ ۴ ‏(`docs/l3/phase4-closeout.md` نسخهٔ 0.2 در دفتر AEO).
  - تحلیل L-bench ‏(`docs/l2/bench/analysis-l3-phase4.md` نسخهٔ 0.1 §۶، از دادهٔ خام seq ‏4663 تا 4828).
  - دفتر کل `aeo` (۴۸۲۸ رویداد، سالم، لنگرها matched).
  - GitHub با خواندن فقط (GET).
- **برچسب‌ها:**
  - **[M]**: Observed by model. L1 خودش از ledger، git، خروجی Jobها یا GitHub خواند.
  - **[D]**: Documented. از سند یا پیام بازبین آمده است.
  - **[NV]**: Not Verified.
  - **[L-bench]**: از analysis-l3-phase4 0.1 §۶، Observed by model از دادهٔ seq ‏4663 تا 4828.
- **قید این سند:**
  - URL، نام حساب و ایمیل عمداً نیامده‌اند.
  - این PR فقط `docs/aeo/**` را تغییر می‌دهد.
  - **پذیرش با Review ‏APPROVED مالک روی head همین PR است (دروازهٔ پایان دستهٔ ۴).**

## ۱. هدف دستهٔ ۴
- دامنه [D]: سه کار (E129، «دستهٔ ۴: پیشنهاد بازبین»؛ E130 = الف، P4-03 حذف شد):
  - مورد P4-02: PUT عکس تخته با progress، تا PUT کند ولی پیش‌رونده قطع نشود (security ‏nit ‏#116).
  - مورد P4-04: نگاشت گام `speech` به `tts` در `usageKind` (AUD-5 ‏F-3).
  - مورد P4-01: job نگهداشت ردیف‌های plt بی حساب، با پیش‌فرض dry-run (P3-04 ب، E123).
- ترتیب [D]: P4-02 ⇒ P4-04 ⇒ P4-01، یک Task در هر بلوک (phase4-plan §۲).

## ۲. خلاصهٔ داوری
| معیار (phase4-plan §۸) | هدف | نتیجه | حکم |
|---|---|---|---|
| معیار ۱. Taskها | سه کارت از Task Card تا merge؛ ≥ ۲ با تست مرجع سبز | **۳ از ۳**؛ ۰ نقض Gate؛ ۰ blocked [L-bench] | ✔ برآورده |
| معیار ۲. First-Pass Review Acceptance | ≥ ۶۰٪ (تعریف b1) | **ب۱: ۳ از ۳ (۱۰۰٪)**؛ الف و ب۲ ۳ از ۳؛ «تنها یک attempt ‏implement» ۲ از ۳ (۶۶٫۷٪)، چون P4-02 یک rework ‏(R88) داشت [L-bench] | ✔ برآورده |
| معیار ۳. Escaped Defects ‏(risk:high) | ۰ (P4-01) | **۰** برای #122؛ `MainChecked` ‏pass، ۰ `RegressionDetected`، ۰ revert [L-bench]؛ موقت، چون job در production سیم‌کشی نشده است [M] | ✔ برآورده (موقت) |
| معیار ۴. Recovery Success ‏(B-06) | ≥ ۸۰٪ اگر قطعی رخ دهد | **قطعی Job رخ نداد** (۰ Job یتیم، ۰ blocked، ۰ freeze)؛ سه دور gate بریدهٔ #119 با دستور بازبین بازیابی شد [L-bench] | اندازه‌گیری نشد |
| معیار ۵. Usage per Accepted PR | ثبت؛ جمع زیر سقف هفته | جمع **7.84** دلار (۱۵ Job، ۲۴۴ نوبت)؛ میانگین 2.61، میانه 3.25 ‏(P4-02)، بیشینه 3.41 ‏(P4-01)، کمینه 1.18 ‏(P4-04) [L-bench]؛ هفته 64.35 از ۱۰۰ [M] | ✔ ثبت شد؛ زیر سقف |
| معیار ۶. رخداد امنیتی | ۰ (خروج داده، تغییر policy به‌دست عامل، حذف داده بی پرچم) | **۰**؛ ۰ `PushStopped`، ۰ `ApprovalInvalidated`؛ هر دو merge ‏high پس از approve مالک؛ ۰ Job در aeo [L-bench]؛ job فقط dry-run پیش‌فرض و در production اجرا نشده [M] | ✔ برآورده |
| معیار ۷. صفر regression | ‏main-check ‏pass پس از هر merge؛ شمار فایل‌های `pnpm test:unit` کم نشود (پایه ۳۱۸) | **۴ از ۴** merge با `MainChecked` ‏pass [L-bench]؛ فایل‌های آزمون unit ‏۳۱۸ ⇒ ۳۱۹ [M] | ✔ برآورده |
| معیار ۸. dry-run ‏P4-01 | dry-run شمار می‌دهد و بی پرچم حذف نمی‌کند؛ apply فقط تا سقف و فقط یتیم | ‏TP-1 در verify ‏pass؛ حذف فقط با `apply: true` و تا سقف ۵۰۰ (بیشینه ۵۰۰۰) [M]؛ از export فقط verify، `required-checks`، approve و `MainChecked` دیده می‌شود [L-bench] | ✔ برآورده (شاهد L1) |
| معیار ۹. آپلود عکس ‏P4-02 | «PUT عکس کند ولی پیش‌رونده» سبز؛ «PUT عکس گیرکرده» همچنان timeout | ‏TP-1 در verify ‏attempt 3 و CI ‏#120 سبز؛ هر دو case تازه روی base شکست می‌خورند [M] | ✔ برآورده (شاهد L1) |
| دروازهٔ پایان | PR «Batch 4 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک | همین PR | منتظر approve مالک |

- **جمع‌بندی:**
  - برآورده: بندهای ۱، ۲، ۵، ۶، ۷، ۸ و ۹.
  - برآورده و موقت: بند ۳، چون job ‏P4-01 هنوز در production اجرا نشده است.
  - اندازه‌گیری نشد: بند ۴، چون قطعی Job رخ نداد. phase4-plan §۸ همین حالت را پیش‌بینی کرده است.

## ۳. جدول Taskها — شاهد [M]
| Task | ریسک کارت / gate | PR | merge_sha | seq ‏Merged | attempt | Job | هزینه (دلار) | merge |
|---|---|---|---|---|---|---|---|---|
| ‏P4-02 | medium / medium | ‏#120 | `6f49445` | 4743 | ۱ PR (implement ۲، verify ۳) | ۷ | 3.25 | ‏D7 |
| ‏P4-04 | low / medium | ‏#121 | `ace87f6` | 4780 | ۱ | ۴ | 1.18 | ‏D7 |
| ‏P4-01 | high / high | ‏#122 | `9bf9163` | 4827 | ۱ | ۴ | 3.41 | approve مالک (E133) |
| **جمع** | — | ۳ PR | — | — | — | ۱۵ | **7.84** | ۲ ‏D7، ۱ approve |

- **PR دیگر پنجره [M]:** PR کارت‌ها #119 (کارت‌ها، TestPlanها و phase4-plan ‏0.1، `dfecf4f`، seq ‏4688، approve مالک E131). این PR هزینهٔ Job ندارد. جمع پنجره ۴ merge است، و هیچ PR ‏aeo در پنجره نبود.
- **زمان PR تا merge [M]:**
  - مورد D7: PRهای D7 ‏۱۲ تا ۱۴ دقیقه بودند، که بیشترش CI است.
  - مورد approve مالک: ‏#119 ‏۴۷ دقیقه و #122 ‏۴۴ دقیقه بودند، که بیشترش انتظار approve مالک بود.

## ۴. رخدادها [M]
- **verify ناپایدار P4-02 و rework با R88:**
  - رخداد: verify ‏attempt 1 دو آزمون تازه را fail کرد. attempt 2 روی همان head ‏pass شد، پس آزمون‌ها ناپایدار بودند.
  - علت [D]: آزمون حداکثر ۲۰۰ دور `setImmediate` منتظر شروع PUT می‌ماند، و زیر بار میزبان این کافی نبود.
  - اصلاح: یک دور rework با `--rework-findings` ‏(R88)، فقط در فایل آزمون: انتظار با promise، ساعت ساختگی، و پاک‌سازی هر upload. رفتار تولید بی‌تغییر ماند. verify ‏attempt 3 ‏pass. هزینهٔ اضافه 1.41 دلار.
- **خطای 500 ‏GitHub:**
  - مورد check-run: در PR کارت #119، PATCH ‏check-run ‏`aeo/workflow-paths` سه بار 500 داد. L1 پس از سه بار ایستاد. اجرای دستوری gate پس از آن ‏pass شد.
  - مورد push: push ‏aeo ‏#106 (پیش از این پنجره) سه بار با خطای GitHub رد شد. تنها تلاش دوباره با دستور بازبین موفق شد.
  - پیامد: هیچ داده‌ای از دست نرفت. قاعدهٔ «سه رد ⇒ توقف» درست کار کرد.
- **اجرای زندهٔ R92:** مالک هر سه TestPlan را پیش از نخستین Job قفل کرد (4690 تا 4692، E132). preflight هر سه Task با R92 ‏`run` داد. هیچ `testplan-lock` ‏fail نبود.
- **انحراف AC-5 ‏P4-01 (مجاز) [D]:**
  - رخداد: ثبت دوره‌ای job درون owns_paths شدنی نبود. فایل لازم `acc/jobs.ts` یا `proc/worker.ts` (قفل) است. کارت این حالت را پیش‌بینی کرده بود.
  - پیامد: job آماده ولی سیم‌کشی‌نشده است. پس هیچ اجرایی، حتی dry-run، اکنون در production رخ نمی‌دهد.
- **gate ‏review:security یک Task ‏high:** gate نخست ‏#122 ورودی review را خواست (R82). gate دوم با هر دو review اجرا شد و هر ۹ gate ‏pass شدند.
- **دیگر:** هیچ `RegressionDetected`، freeze، revert، `PushStopped` یا `ApprovalInvalidated` نبود.

## ۵. Rهای controller [M]
همهٔ این Rها پیش از دستهٔ ۴ در `main@0e98bda` ‏aeo بودند.

| R | commit ‏aeo | کار | اجرای زنده در دستهٔ ۴ |
|---|---|---|---|
| ‏R89 | `4697a65` | gate ‏`scope` با `task-card-hash` | بله، هر سه PR ‏Task |
| ‏R90 | `0e98bda` | انتقال attestation و review به head تازه با patch-id برابر | نه؛ هیچ PR پس از باز شدن head تازه نگرفت |
| ‏R92 | `c873272` | Job با TestPlan فقط از قفل ledger آغاز می‌شود | بله، هر سه preflight |
| ‏R93 | `c873272` | main-check ‏aeo: «fetch it first» | نه |
| ‏R96 | `14ce901` | `pnpm schema:version` در bash_allow | نه؛ هیچ کارت migration نداشت |

- **نامزدهای controller [D]:**
  - ‏R95: ثبت `JobResidue` برای placeholder ماندگار sandbox (کم‌اولویت).
  - ‏R97: ساخت check-run تازه یا تلاش دوباره هنگام 5xx روی PATCH ‏check-run.
  - بی شماره: bash_allow گسترده‌تر (implementer و reviewerها)؛ typecheck و lint در verify؛ گسترش فهرست سفید export ‏L-bench.

## ۶. نامزدهای دستهٔ بعد (از Jobهای review و پرسش‌های باز implementer؛ همه غیرمسدودکننده) [M]
| نامزد | منشأ | شدت یا نوع |
|---|---|---|
| زمان‌بندی job نگهداشت (`acc/jobs.ts`، فقط dry-run) و آزمون `existingAccountIds` در `acc/acc.test.ts` | انحراف AC-5 ‏P4-01؛ آزمون جاافتادهٔ هر دو review | کارت تازه |
| قفل ردیف حساب در تراکنش apply (یا NOT EXISTS در همان DELETE) | ‏security ‏nit ‏P4-01 (CWE-367) | ‏nit، hypothesis؛ اکنون بهره‌برداری‌پذیر نیست |
| سیم‌کشی فقط با `existingAccountIds`، نه predicateی با `deleted_at is null` | ‏security ‏nit ‏P4-01 (CWE-693) | ‏nit، hypothesis |
| ‏clamp برآورد هزینهٔ گام | ‏security ‏nit ‏P4-04 | ‏nit؛ به سمت امن |
| ‏idempotency گام speech پس از deploy | پرسش باز implementer ‏P4-04 | نادر |
| اصلاح‌های حسابرسی بلوک ۸۰ (AUD-2 تا AUD-4، و AUD-5 جز F-3) | ‏E106 | مختلف |
| نامزدهای پیشین | phase3-acceptance §۶ | خوانندهٔ علت قطع آپلود، Map ‏`causes`، `sentBytes()`، دو برچسب E107 |

## ۷. کارهای باز مالک
- **پاک‌سازی:** worktree و شاخهٔ `aeo/P4-01` (R44/R86). L1 حذف نمی‌کند.
- **apply ‏P4-01 در production (E134):** فقط پس از یک dry-run زمان‌بندی‌شده و دیدن شمار آن، با تصمیم جدای مالک. سقف پیش‌فرض ۵۰۰ و بیشینه ۵۰۰۰ ردیف در هر اجرا است.
- **تصمیم‌ها:**
  - زمان کارت زمان‌بندی job نگهداشت (§۶).
  - دو برچسب admin معلق ذیل E107.
- **دستهٔ بعد:** دامنه و ترتیب را مالک تعیین می‌کند. ورودی‌هایش §۵ و §۶ این سند هستند.

## ۸. تصمیم‌های مالک در دستهٔ ۴ [D]
| تصمیم | موضوع |
|---|---|
| ‏E129 | دستهٔ ۴ = پیشنهاد بازبین |
| ‏E130 | الف: بی سقف مطلق PUT پیش‌رونده؛ P4-03 حذف شد |
| ‏E131 | approve PR کارت‌های دستهٔ ۴ (#119) |
| ‏E132 | قفل سه TestPlan دستهٔ ۴ پیش از نخستین Job |
| ‏E133 | approve ‏P4-01 ‏(#122، high) |
| ‏E134 | apply ‏P4-01 در production فقط پس از dry-run زمان‌بندی‌شده |

## ۹. پذیرش
- **پذیرش دستهٔ ۴:** با Review ‏APPROVED مالک روی head همین PR. این دروازهٔ پایان دستهٔ ۴ است (phase4-plan §۸).
- **پس از پذیرش:** دامنهٔ دستهٔ بعد را مالک تعیین می‌کند.
