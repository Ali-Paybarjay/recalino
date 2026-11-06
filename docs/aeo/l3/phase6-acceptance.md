# Recalino — پذیرش دستهٔ ۶ ‏L3 ‏(Batch 6 acceptance)

- **نسخه:** 0.1 · تاریخ: 2026-11-06 · نویسنده: سشن L1 ‏(`aeo-b5`) · پایه: `main@e249ba6`
- **مرجع معیارها:** `docs/aeo/l3/phase6-plan.md` §۸ (نسخهٔ 0.3 در همین PR).
- **مرجع داده:**
  - سند جمع‌بندی دستهٔ ۶ ‏(`docs/l3/phase6-closeout.md` نسخهٔ 0.2 در دفتر AEO).
  - تحلیل L-bench ‏(`docs/l2/bench/analysis-l3-phase6.md` نسخهٔ 0.1 §۷، از دادهٔ خام seq ‏5083 تا 5329؛ `totals_check.match: true`).
  - دفتر کل `aeo` (۵۳۲۹ رویداد، سالم، لنگرها matched).
  - GitHub با خواندن فقط (GET).
- **برچسب‌ها:**
  - **[M]**: Observed by model. L1 خودش از ledger، git، خروجی Jobها یا GitHub خواند.
  - **[D]**: Documented. از سند، خروجی Job یا پیام بازبین آمده است.
  - **[NV]**: Not Verified.
  - **[L-bench]**: از analysis-l3-phase6 0.1 §۷، Observed by model از دادهٔ seq ‏5083 تا 5329.
- **قید این سند:**
  - URL، نام حساب و ایمیل عمداً نیامده‌اند.
  - این PR فقط `docs/aeo/**` را تغییر می‌دهد.
  - **پذیرش با Review ‏APPROVED مالک روی head همین PR است (دروازهٔ پایان دستهٔ ۶).** پس از merge آن، توقف برنامه‌ریزی‌شدهٔ E152 آغاز می‌شود.

## ۱. هدف دستهٔ ۶
- دامنه [D]: چهار کار از یافته‌های دستهٔ ۵ (E144 = الف):
  - مورد P6-02: آزمون اتصال `existingAccountIds.accountRow === accountRowOf` و sweep با accountRow واقعی (tests_missing ‏security ‏P5-02).
  - مورد P6-04: پین `VOICE_WINDOW_PLAN` با `VOICE_MODEL_REVISION` (minor ‏code ‏P5-04).
  - مورد P6-03: فیلد `hold_micros` در allow-list ‏log، و استفاده در `provider_estimate_above_hold` (پرسش باز implementer ‏P5-02).
  - مورد P6-01: سند فقط‌خواندنی نسخهٔ مدل صدا و اثر `e460366` (E141 = الف).
- ترتیب [D]: P6-02 ⇒ P6-04 ⇒ P6-03 ⇒ P6-01، یک Task در هر بلوک.

## ۲. خلاصهٔ داوری
| معیار (phase6-plan §۸) | هدف | نتیجه | حکم |
|---|---|---|---|
| معیار ۱. Taskها | چهار کارت تا merge؛ ≥ ۳ با تست مرجع سبز | **۴ از ۴**؛ ۰ نقض Gate؛ ۰ blocked [L-bench] | ✔ برآورده |
| معیار ۲. First-Pass Review Acceptance | ≥ ۶۰٪ (تعریف b1) | **۴ از ۴ (۱۰۰٪)**؛ هر چهار در یک attempt ‏implement و بی rework [L-bench] | ✔ برآورده |
| معیار ۳. Escaped Defects ‏(risk:high) | ۰ (P6-01، و P6-02 با gate ‏high) | **۰** برای #131 و #134؛ `MainChecked` ‏pass، ۰ `RegressionDetected`، ۰ revert [L-bench]؛ موقت، چون پنجرهٔ P6-01 پس از merge ۹٫۷ دقیقه است | ✔ برآورده (موقت) |
| معیار ۴. Recovery Success ‏(B-06) | ≥ ۸۰٪ اگر قطعی رخ دهد | **قطعی Job رخ نداد** [L-bench] | اندازه‌گیری نشد |
| معیار ۵. Usage per Accepted PR | ثبت؛ جمع زیر سقف هفته | جمع **6.95** دلار (۱۶ Job، ۲۲۶ نوبت)؛ میانگین 1.74، میانه 1.56، بیشینه 2.92 ‏(P6-01)، کمینه 0.91 ‏(P6-04)؛ درون برآورد 5.5 تا 9.5 [L-bench]؛ هفته 79.46 از ۱۰۰ [M] | ✔ ثبت شد؛ زیر سقف |
| معیار ۶. رخداد امنیتی | ۰ | **۰**؛ ۰ `PushStopped`، ۰ `ApprovalInvalidated`؛ هر پنج merge ‏high پنجره پس از approve مالک؛ ۳٫۹۸ denial در هر ۱۰۰ نوبت [L-bench] | ✔ برآورده |
| معیار ۷. صفر regression | ‏main-check ‏pass پس از هر merge؛ فایل‌های unit کم نشود (پایه ۳۲۱) | **۵ از ۵** merge ‏Recalino با `MainChecked` ‏pass [L-bench]؛ فایل‌های unit ‏۳۲۱ [D] | ✔ برآورده |
| معیار ۸. سقف نوبت (E142) | هر `JobScheduled` همان `max_turns` کارت | **۱۶ از ۱۶** با ۶۰ [L-bench]؛ منبع `card` در هر ۱۶ (Observed by reviewer و L1 از ledger؛ در export نیست) | ✔ برآورده |
| معیار ۹. اتصال accountRow ‏(P6-02) | `accountRow` همان `accountRowOf`؛ NOT EXISTS در apply؛ dry-run بی DELETE | ‏TP-1 و `testplan-lock` ‏pass [L-bench]؛ `toBe(accountRowOf)` و دو DELETE با NOT EXISTS در apply، و ۰ DELETE در dry-run [D] | ✔ برآورده |
| معیار ۱۰. پین پنجره ‏(P6-04) | آزمون سبز و شکست با تغییر بی bump | ‏TP-1 و `testplan-lock` ‏pass [L-bench]؛ با `{30000, 15}` موقت، شکست با پیام bump [D] | ✔ برآورده |
| معیار ۱۱. فیلد log ‏(P6-03) | فقط `hold_micros` تازه؛ log بی `production_limit`؛ ثبت هزینه بی‌تغییر | ‏TP-1 و `testplan-lock` ‏pass [L-bench]؛ هر دو reviewer: یک فیلد عددی، بی متن کاربر (CWE-532) [D] | ✔ برآورده |
| معیار ۱۲. سند صدا ‏(P6-01) | چهار بخش، با برچسب، بی دادهٔ کاربر و بی تغییر کد | ‏TP-1، `scope` و `testplan-lock` ‏pass [L-bench]؛ ۳۹ Observed، ۱۳ Not Verified و ۳۳ ارجاع مسیر:خط [D] | ✔ برآورده |
| دروازهٔ پایان | PR «Batch 6 acceptance» با Review ‏APPROVED مالک | همین PR | منتظر approve مالک |

- **جمع‌بندی:**
  - برآورده: بندهای ۱، ۲، ۵ تا ۱۲. بندهای ۹ تا ۱۲ را L-bench در سطح gate دید، و محتوا از خروجی Jobهاست [D].
  - برآورده و موقت: بند ۳.
  - اندازه‌گیری نشد: بند ۴، چون قطعی Job رخ نداد.

## ۳. جدول Taskها — شاهد [M]
| Task | ریسک کارت / gate | PR | merge_sha | seq ‏Merged | attempt | Job | هزینه (دلار) | merge |
|---|---|---|---|---|---|---|---|---|
| ‏P6-02 | low / high | ‏#131 | `d8d0c0a` | 5193 | ۱ | ۴ | 1.96 | approve مالک (E150) |
| ‏P6-04 | low / medium | ‏#132 | `e196009` | 5234 | ۱ | ۴ | 0.91 | ‏D7 |
| ‏P6-03 | medium / medium | ‏#133 | `9067b54` | 5275 | ۱ | ۴ | 1.15 | ‏D7 |
| ‏P6-01 | low / high | ‏#134 | `e249ba6` | 5328 | ۱ | ۴ | 2.92 | approve مالک (E151) |
| **جمع** | — | ۴ PR | — | — | — | ۱۶ | **6.95** | ۲ ‏D7، ۲ approve |

- **PRهای دیگر پنجره [M]:**
  - مورد Recalino: PR کارت‌ها ‏#130 ⇒ `9c79fc4` (seq ‏5116، E146).
  - مورد aeo: ‏#107 ‏(R98) ⇒ `9bf7a4e` (E147)، و #108 ‏(R99) ⇒ `6c9188a` (E148).
  - مورد جمع: هفت merge در پنجره.
- **تغییر کد [M]:** ‏۷ فایل، +238 −9، همه درون owns_paths. هیچ migration، grant، schema، `package.json` یا CI تغییر نکرد.

## ۴. رخدادها [M]
- **R98 در عمل:** هیچ پرچم `--max-turns` داده نشد. preflight و هر ۱۶ `JobScheduled` منبع `card` و سقف ۶۰ دارند.
- **R99 در عمل:**
  - مورد implementer: آزمون تک‌فایل و `pnpm check:boundaries` را اجرا کرد.
  - مورد reviewer امنیت P6-03: آزمون را خودش اجرا کرد.
  - مورد denial: از ۲۵ ‏(دستهٔ ۵) به ۹ رسید. همهٔ ۹ فرمان ترکیبی بودند.
- **gate ‏high ‏P6-02:** رشتهٔ SQL مورد انتظار در یک assertion `sql-destructive` را فعال کرد. merge با approve مالک انجام شد. implementer رشته را دور نزد.
- **pr-test در aeo:** با worktree همان head ثبت شد. ‏#108 فقط با `git merge origin/main` و patch-id ثابت به‌روز شد (D19).
- **E152:** مالک توقف برنامه‌ریزی‌شده در پایان دستهٔ ۶ را خواست، تا brief لایهٔ هماهنگی.
- **دیگر:** هیچ `RegressionDetected`، freeze، revert، `PushStopped`، `ApprovalInvalidated` یا `carried_from` نبود.

## ۵. Rهای controller [M]
| R | کار | اجرای زنده در دستهٔ ۶ |
|---|---|---|
| ‏R82 | ورودی review:security برای gate ‏Task ‏high | بله، #131 و #134 |
| ‏R89 | gate ‏`scope` با `task-card-hash` | بله، هر چهار PR ‏Task |
| ‏R90 | انتقال attestation و review به head تازه | نه |
| ‏R91 | بازبینی Task ‏DB منتظر CI | نه |
| ‏R92 | Job با TestPlan فقط از قفل ledger | بله، هر چهار preflight |
| ‏R98 | سقف نوبت از کارت | بله، ۱۶ از ۱۶ |
| ‏R99 | آزمون با آرگومان و `check:boundaries` | بله |

## ۶. فهرست یافته‌ها برای brief (E152) [D]
**این فهرست ورودی brief است، نه طرح.** بی اولویت، بی ترتیب، بی برآورد و بی دامنه. هر یافته فقط با منبعش آمده است.

- یافته: شاخه‌های شرطی قالب prompt پین نیستند. منبع: minor ‏code ‏P5-03 ‏(#125).
- یافته: عددهای درون‌خطی `voice-engine-quality.mjs` پین نیستند. منبع: minor ‏security ‏P5-04 ‏(#126).
- یافته: منطق `remapVoiceSegments` و `boundaryUnsafe` ‏(`34862cb`) بی bump بر بردار کلاس اثر دارد. منبع: سند P6-01 §۱ ‏(#134).
- یافته: اگر گزینهٔ الف E145 اجرا شود، بردارهای بیومتریک revision قدیم بی‌مهلت می‌مانند، و ضبط دوباره مراجع و پذیرش‌های خودکار را حذف می‌کند. منبع: minor ‏security ‏P6-01، CWE-359 ‏(#134).
- یافته: شمارش چندبعدی دادهٔ صدا با کاربر کم ممکن است خانهٔ کوچک بسازد. منبع: nit ‏security ‏P6-01 ‏(#134).
- یافته: `docs/architecture/01-system-inventory.md` نوع `plt.count_account_orphans` را ندارد، و `docs/architecture/**` در `write_paths` نیست. منبع: پرسش باز implementer ‏P5-01 ‏(#127).
- یافته: lint و typecheck برای reviewerها مجاز نیست. منبع: denialهای P6-02 ‏(#131).
- یافته: agentها فرمان را با pipe، `;` یا `echo $?` ترکیب می‌کنند، و رد می‌شود. منبع: ۹ denial دستهٔ ۶ (export ‏`seq5083-5329`).
- یافته: شمارندهٔ دور rework (`limits.max_rework_rounds`) در controller نیست. منبع: بدنهٔ aeo ‏#107.
- یافته: placeholderهای sandbox در worktree ‏Job می‌مانند (R95). منبع: پرسش باز implementer ‏P6-04 ‏(#132).
- یافته: کد خروج `pnpm lint` را implementer مستقیم نمی‌بیند. منبع: پرسش باز implementer ‏P6-02 و P6-04.
- یافته: `max_turns_source` در فهرست سفید export ‏L-bench نیست. منبع: analysis-l3-phase6 §۶، یافتهٔ ۱.
- یافته: idempotency گام speech پس از deploy. منبع: پرسش باز implementer ‏P4-04.
- یافته: یافته‌های audit باز (AUD-2 تا AUD-4، جز آنچه دسته‌های ۴ تا ۶ بستند). منبع: گزارش L1 بلوک ۸۰.

## ۷. کارهای باز مالک
- **پاک‌سازی:** worktreeها و شاخه‌های `aeo/P6-01` تا `aeo/P6-04` (R44/R86). L1 حذف نمی‌کند.
- **E136:** هیچ apply حذف ردیف‌های یتیم پیش از گزارش ≥ ۲۴ شمارش ساعتی نیست. زمان deploy و دسترسی به log ‏production بی پاسخ است [NV].
- **E145:** د، موکول به برنامهٔ دستهٔ بعد.
- **E152:** پس از merge این PR، صفر Job و صفر قفل، و گزارش پذیرش به مالک ⇒ توقف تا brief لایهٔ هماهنگی.

## ۸. تصمیم‌های مالک در دستهٔ ۶ [D]
| تصمیم | موضوع |
|---|---|
| ‏E136 | apply حذف ردیف‌های یتیم: روال تأیید، هیچ apply تا گزارش ≥ ۲۴ شمارش ساعتی |
| ‏E140 | پذیرش دستهٔ ۵ (#129) |
| ‏E141 | نسخهٔ مدل صدا: الف، کارت بررسی low (P6-01) |
| ‏E142 | ‏R98 و R99: الف، سفارش به L-dev |
| ‏E143 | پاک‌سازی پنج worktree دستهٔ ۵ |
| ‏E144 | دستهٔ ۶ و ترتیب: الف |
| ‏E145 | ‏`VOICE_MODEL_REVISION`: **د، موکول**؛ نه bump، نه ضبط دوباره؛ سند P6-01 بی‌تغییر |
| ‏E146 | approve PR کارت‌ها ‏#130 |
| ‏E147 | approve ‏aeo ‏#107 ‏(R98) |
| ‏E148 | approve ‏aeo ‏#108 ‏(R99) |
| ‏E149 | قفل چهار TestPlan ‏P6 و پاک‌سازی |
| ‏E150 | approve ‏#131 ‏(P6-02) |
| ‏E151 | approve ‏#134 ‏(P6-01) |
| ‏E152 | توقف برنامه‌ریزی‌شده در پایان دستهٔ ۶ |

## ۹. پذیرش
- **پذیرش دستهٔ ۶:** با Review ‏APPROVED مالک روی head همین PR. این دروازهٔ پایان دستهٔ ۶ است (phase6-plan §۸).
- **پس از پذیرش:** توقف برنامه‌ریزی‌شدهٔ E152 تا brief لایهٔ هماهنگی. دامنهٔ دستهٔ بعد را مالک پس از آن تعیین می‌کند.
