# Recalino — پذیرش دستهٔ ۵ ‏L3 ‏(Batch 5 acceptance)

- **نسخه:** 0.1 · تاریخ: 2026-11-06 · نویسنده: سشن L1 ‏(`aeo-b5`) · پایه: `main@bb52d01`
- **مرجع معیارها:** `docs/aeo/l3/phase5-plan.md` §۸ (نسخهٔ 0.2 در همین PR).
- **مرجع داده:**
  - سند جمع‌بندی دستهٔ ۵ ‏(`docs/l3/phase5-closeout.md` نسخهٔ 0.2 در دفتر AEO).
  - تحلیل L-bench ‏(`docs/l2/bench/analysis-l3-phase5.md` نسخهٔ 0.1 §۷، از دادهٔ خام seq ‏4850 تا 5061؛ `totals_check.match: true`).
  - دفتر کل `aeo` (۵۰۶۱ رویداد، سالم، لنگرها matched).
  - GitHub با خواندن فقط (GET).
- **برچسب‌ها:**
  - **[M]**: Observed by model. L1 خودش از ledger، git، خروجی Jobها یا GitHub خواند.
  - **[D]**: Documented. از سند، خروجی Job یا پیام بازبین آمده است.
  - **[NV]**: Not Verified.
  - **[L-bench]**: از analysis-l3-phase5 0.1 §۷، Observed by model از دادهٔ seq ‏4850 تا 5061.
- **قید این سند:**
  - URL، نام حساب و ایمیل عمداً نیامده‌اند.
  - این PR فقط `docs/aeo/**` را تغییر می‌دهد.
  - **پذیرش با Review ‏APPROVED مالک روی head همین PR است (دروازهٔ پایان دستهٔ ۵).**

## ۱. هدف دستهٔ ۵
- دامنه [D]: چهار کار (E134، پیشنهاد بازبین پس از دستهٔ ۴):
  - مورد P5-03: آزمون پین hash قالب prompt درس با `promptVersion` (AUD-2 ‏F-7).
  - مورد P5-04: آزمون پین تنظیمات خط لولهٔ صدا با `VOICE_MODEL_REVISION` (AUD-3 ‏F-9).
  - مورد P5-01: زمان‌بندی `accountOrphansJob(existingAccountIds)` در `accPeriodicJobs`، فقط dry-run، و آزمون `existingAccountIds` (انحراف AC-5 ‏P4-01؛ CWE-693).
  - مورد P5-02: NOT EXISTS در همان DELETE (CWE-367)، و log برآورد هزینهٔ بیش از hold، بی clamp.
- ترتیب [D]: P5-03 ⇒ P5-04 ⇒ P5-01 ⇒ P5-02، یک Task در هر بلوک (phase5-plan §۲؛ E137).

## ۲. خلاصهٔ داوری
| معیار (phase5-plan §۸) | هدف | نتیجه | حکم |
|---|---|---|---|
| معیار ۱. Taskها | چهار کارت تا merge؛ ≥ ۳ با تست مرجع سبز | **۴ از ۴**؛ ۰ نقض Gate در PRهای Task؛ ۰ blocked [L-bench] | ✔ برآورده |
| معیار ۲. First-Pass Review Acceptance | ≥ ۶۰٪ (تعریف b1) | **ب۱: ۴ از ۴ (۱۰۰٪)**؛ الف و ب۲ ۴ از ۴؛ هر چهار در یک attempt ‏implement و بی rework [L-bench] | ✔ برآورده |
| معیار ۳. Escaped Defects ‏(risk:high) | ۰ (P5-02) | **۰** برای #128؛ `MainChecked` ‏pass، ۰ `RegressionDetected`، ۰ revert [L-bench]؛ موقت، چون apply در production اجرا نشده است (E136) [M] | ✔ برآورده (موقت) |
| معیار ۴. Recovery Success ‏(B-06) | ≥ ۸۰٪ اگر قطعی رخ دهد | **قطعی Job رخ نداد** (۰ Job یتیم، ۰ blocked، ۰ freeze) [L-bench] | اندازه‌گیری نشد |
| معیار ۵. Usage per Accepted PR | ثبت؛ جمع زیر سقف هفته | جمع **8.16** دلار (۱۶ Job، ۲۶۰ نوبت)؛ میانگین 2.04، میانه 1.78، بیشینه 3.20 ‏(P5-02)، کمینه 1.40 ‏(P5-04)؛ درون برآورد 7 تا 16 [L-bench]؛ هفته 72.52 از ۱۰۰ [M] | ✔ ثبت شد؛ زیر سقف |
| معیار ۶. رخداد امنیتی | ۰ (خروج داده، تغییر policy به‌دست عامل، حذف داده بی پرچم) | **۰**؛ ۰ `PushStopped`، ۰ `ApprovalInvalidated`؛ هر دو merge ‏high پس از approve مالک (4873، 5049)؛ ۱۴ از ۱۴ gate ‏`workflow-paths` ‏pass؛ ۰ Job در aeo [L-bench]؛ job زمان‌بندی‌شده فقط می‌شمارد و apply را رد می‌کند [D] | ✔ برآورده |
| معیار ۷. صفر regression | ‏main-check ‏pass پس از هر merge؛ فایل‌های `pnpm test:unit` کم نشود (پایه ۳۱۹) | **۵ از ۵** merge با `MainChecked` ‏pass [L-bench]؛ فایل‌های unit ‏۳۱۹ ⇒ ۳۲۰ ‏(#125) ⇒ ۳۲۰ ⇒ ۳۲۱ ‏(#127) ⇒ ۳۲۱ [D] | ✔ برآورده |
| معیار ۸. dry-run زمان‌بندی‌شده ‏(P5-01) | آزمون: job دوره‌ای شمار را بی شناسه ثبت می‌کند و حذف نمی‌کند؛ حساب tombstoned «موجود» است | ‏TP-1 در gate ‏`verify` ‏pass؛ `testplan-lock` ‏pass [L-bench]؛ `acc/jobs.test.ts`: شمار ۳ و ۱، dropped ‏۰، هیچ delete، update، insert یا begin؛ `acc.test.ts`: حساب tombstoned موجود [D] | ✔ برآورده |
| معیار ۹. مسیر apply ‏(P5-02) | آزمون: apply فقط یتیم و تا سقف؛ پیش‌فرض dry-run بی‌تغییر | ‏TP-1 در gate ‏`verify` ‏pass؛ review:security ‏pass در نخستین دور؛ approve مالک [L-bench]؛ case ‏unit حساب تازه را نگه می‌دارد؛ آزمون int در CI ‏۳ از ۳ سبز؛ dry-run و سقف‌ها بی‌تغییر [D] | ✔ برآورده |
| معیار ۱۰. پین‌ها ‏(P5-03، P5-04) | آزمون‌های تازه روی head سبز؛ prompt، `promptVersion`، revision و تنظیمات صدا بی‌تغییر | ‏TP-1 هر دو در gate ‏`verify` ‏pass؛ `testplan-lock` هر دو ‏pass [L-bench]؛ هر دو آزمون با تغییر موقت شکست خوردند و پیام bump دادند [D] | ✔ برآورده |
| دروازهٔ پایان | PR «Batch 5 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک | همین PR | منتظر approve مالک |

- **جمع‌بندی:**
  - برآورده: بندهای ۱، ۲، ۵، ۶، ۷، ۸، ۹ و ۱۰. بندهای ۸ تا ۱۰ را L-bench در سطح gate دید، و شاهد case به case از خروجی Jobهاست [D].
  - برآورده و موقت: بند ۳، چون apply حذف ردیف‌های یتیم هنوز در production اجرا نشده است.
  - اندازه‌گیری نشد: بند ۴، چون قطعی Job رخ نداد. phase5-plan §۸ همین حالت را پیش‌بینی کرده است.

## ۳. جدول Taskها — شاهد [M]
| Task | ریسک کارت / gate | PR | merge_sha | seq ‏Merged | attempt | Job | هزینه (دلار) | merge |
|---|---|---|---|---|---|---|---|---|
| ‏P5-03 | low / medium | ‏#125 | `625840c` | 4925 | ۱ | ۴ | 1.86 | ‏D7 |
| ‏P5-04 | low / medium | ‏#126 | `53a6bea` | 4966 | ۱ | ۴ | 1.40 | ‏D7 |
| ‏P5-01 | medium / medium | ‏#127 | `7f9bf6e` | 5007 | ۱ | ۴ | 1.71 | ‏D7 |
| ‏P5-02 | high / high | ‏#128 | `bb52d01` | 5060 | ۱ | ۴ | 3.20 | approve مالک (E139) |
| **جمع** | — | ۴ PR | — | — | — | ۱۶ | **8.16** | ۳ ‏D7، ۱ approve |

- **PR دیگر پنجره [M]:** PR کارت‌ها #124 (کارت‌ها، TestPlanها و phase5-plan ‏0.1، `716d3a2`، seq ‏4880، approve مالک E137). این PR هزینهٔ Job ندارد. جمع پنجره ۵ merge است، و هیچ PR ‏aeo در پنجره نبود.
- **زمان PR تا merge [M]:**
  - مورد D7: PRهای D7 ‏۱۱٫۶ تا ۱۴٫۰ دقیقه بودند، که بیشترش CI است.
  - مورد approve مالک: ‏#128 ‏۴۵٫۴ دقیقه بود، که بیشترش انتظار approve مالک بود. ‏#124 ‏۷۲۶٫۷ دقیقه بود، با شکست lint و انتظار approve در شب.
- **تغییر کد [M]:** ‏۱۲ فایل، +642 −51، همه درون owns_paths کارت‌ها. هیچ migration، grant، schema، `package.json` یا CI تغییر نکرد.

## ۴. رخدادها [M]
- **شکست lint ‏PR کارت‌ها #124:**
  - رخداد: CI نخست در `pnpm lint` با هشت خطای `format` روی JSONهای P5 شکست خورد.
  - علت: کارت‌ها با `JSON.stringify(…, null, 2)` ساخته شده بودند.
  - اصلاح: دو commit فقط چیدمان، با همان محتوا. ابزار درست قالب‌ساز ۱۰۰ستونی دفتر است، برابر `biome.json`.
  - پیامد: approve مالک پس از head دوم بود. قفل‌ها روی نسخهٔ قالب‌خورده زده شدند.
- **سقف نوبت کارت ‏P5-02 اعمال نشد:**
  - رخداد: کارت `limits.max_turns = 80` دارد، ولی Job با سقف ۶۰ زمان‌بندی شد. implement در ۶۰ از ۶۰ نوبت finished شد، بی شکست.
  - علت: controller سقف را فقط از `--max-turns` می‌گیرد (پیش‌فرض ۶۰) و `limits` کارت را نمی‌خواند. L1 هم ۶۰ داد.
  - پیامد: از این پس L1 `--max-turns` را از کارت می‌دهد. نامزد R98 در §۵ است.
- **آزمون int ‏P5-02:** TestPlan فقط `pnpm test:unit` است. پس آزمون int فقط در CI اجرا شد: ‏۳ از ۳ سبز.
- **اجرای زندهٔ R92:** مالک هر چهار TestPlan را پیش از نخستین Job قفل کرد (4882 تا 4885، E138). preflight هر چهار Task با R92 ‏`run` داد. هیچ `testplan-lock` ‏fail نبود.
- **denialها:** ‏۲۵ در کل، ۹٫۶۲ در هر ۱۰۰ نوبت، بیش از دسته‌های پیشین. بیشترشان اجرای آزمون (۱۰) و فرمان‌های خواندنی با `cd` یا pipe (۱۱) بودند. هیچ‌یک نتیجهٔ Jobی را تغییر نداد.
- **دیگر:** هیچ `RegressionDetected`، freeze، revert، `PushStopped` یا `ApprovalInvalidated` نبود.

## ۵. Rهای controller [M]
همهٔ این Rها پیش از دستهٔ ۵ در `main@0e98bda` ‏aeo بودند.

| R | کار | اجرای زنده در دستهٔ ۵ |
|---|---|---|
| ‏R82 | ورودی review:security برای gate ‏Task ‏high | بله، #128 |
| ‏R89 | gate ‏`scope` با `task-card-hash` | بله، هر چهار PR ‏Task |
| ‏R90 | انتقال attestation و review به head تازه با patch-id برابر | نه؛ هیچ PR پس از باز شدن head تازه نگرفت |
| ‏R91 | بازبینی Task ‏DB منتظر CI سبز | نه؛ هیچ کارت با `db_paths` هم‌پوشان نبود |
| ‏R92 | Job با TestPlan فقط از قفل ledger آغاز می‌شود | بله، هر چهار preflight |

- **نامزدهای controller [D]:**
  - ‏**R98:** `run` به‌طور پیش‌فرض `limits.max_turns` (و `max_rework_rounds`) را از کارت بگیرد، و `--max-turns` فقط override باشد، با ثبت منبع در `JobScheduled`. سفارش آن به L-dev با تصمیم مالک است.
  - مورد bash_allow (مانند R96): اجرای تک‌فایل vitest و `pnpm check:boundaries` برای implementer، و اجرای فقط‌خواندنی آزمون برای reviewer، با قاعدهٔ دقیق.
  - مورد نامزدهای پیشین: R95 و R97 از دستهٔ ۴.

## ۶. نامزدهای دستهٔ بعد (از Jobهای review و پرسش‌های باز implementer؛ همه غیرمسدودکننده) [D]
| شماره | نامزد | منشأ |
|---|---|---|
| ۱ | پوشش شاخه‌های شرطی قالب prompt | ‏minor ‏code ‏P5-03 |
| ۲ | پین `VOICE_WINDOW_PLAN` | ‏minor ‏code ‏P5-04 |
| ۳ | پین عددهای درون‌خطی `voice-engine-quality.mjs` | ‏minor ‏security ‏P5-04 (CWE-1068)؛ پرسش باز implementer |
| ۴ | افزودن `plt.count_account_orphans` به `docs/architecture/01-system-inventory.md` | پرسش باز implementer ‏P5-01 |
| ۵ | آزمون اتصال `existingAccountIds.accountRow === accountRowOf` | ‏tests_missing ‏security ‏P5-02 |
| ۶ | فیلد `hold_micros` در `plt/log.ts` | پرسش باز implementer ‏P5-02 |

## ۷. کارهای باز مالک
- **پاک‌سازی:** worktreeها و شاخه‌های `aeo/P5-01` تا `aeo/P5-04` (R44/R86). L1 حذف نمی‌کند.
- **E136: apply حذف ردیف‌های یتیم در production:**
  - وضعیت: job ساعتی شمار، از `main@7f9bf6e`، فقط می‌شمارد. شمارش‌ها پس از deploy این نسخه در log ‏worker دیده می‌شوند [NV]، با فیلدهای `module`، `kind`، `state`، `measured` و `dropped` برای هر جدول [D].
  - گزارش لازم پیش از تصمیم: دست‌کم ۲۴ اجرا؛ `measured` هر جدول با کمینه، بیشینه و روند؛ مقایسه با سقف ۵۰۰ (بیشینه ۵۰۰۰)؛ `dropped` همیشه ۰ و بی خطا.
  - گام پس از گزارش: تصمیم جدای مالک. هر سیم‌کشی apply کارت high تازه است.
- **e460366: ‏`VOICE_MODEL_REVISION`:** آن commit تنظیمات صدا را عوض کرد و revision را نه. رفع آن یعنی bump و ضبط دوبارهٔ نمونه‌های صدا، که بر کاربران اثر دارد. تصمیم با مالک است.
- **R98:** سفارش به L-dev، با تصمیم مالک.
- **دستهٔ بعد:** دامنه و ترتیب را مالک تعیین می‌کند. ورودی‌هایش §۵ و §۶ این سند هستند.

## ۸. تصمیم‌های مالک در دستهٔ ۵ [D]
| تصمیم | موضوع |
|---|---|
| ‏E134 | دامنهٔ پس از دستهٔ ۴؛ apply فقط پس از dry-run زمان‌بندی‌شده |
| ‏E135 | پذیرش دستهٔ ۴ (#123) |
| ‏E136 (باز) | اجرای apply در production، پس از دیدن شمارش‌ها |
| ‏E137 | approve PR کارت‌های دستهٔ ۵ (#124) و ترتیب |
| ‏E138 | قفل چهار TestPlan دستهٔ ۵ پیش از نخستین Job |
| ‏E139 | approve ‏P5-02 ‏(#128، high) |

## ۹. پذیرش
- **پذیرش دستهٔ ۵:** با Review ‏APPROVED مالک روی head همین PR. این دروازهٔ پایان دستهٔ ۵ است (phase5-plan §۸).
- **پس از پذیرش:** دامنهٔ دستهٔ بعد را مالک تعیین می‌کند.
