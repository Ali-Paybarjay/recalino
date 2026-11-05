# Recalino — پذیرش دستهٔ ۳ ‏L3 ‏(Batch 3 acceptance)

- **نسخه:** 0.1 · تاریخ: 2026-11-05 · نویسنده: سشن L1 ‏(`aeo-b5`) · پایه: `main@4c15739`
- **مرجع معیارها:** `docs/aeo/l3/phase3-plan.md` §۶ (نسخهٔ 0.2 در همین PR).
- **مرجع داده:**
  - سند جمع‌بندی دستهٔ ۳ ‏(`docs/l3/phase3-closeout.md` نسخهٔ 0.2 در دفتر AEO).
  - تحلیل L-bench ‏(`docs/l2/bench/analysis-l3-phase3.md` نسخهٔ 0.1 §۶، از دادهٔ خام seq ‏4336 تا 4574).
  - دفتر کل `aeo` (۴۵۷۴ رویداد، سالم، لنگرها matched).
  - GitHub با خواندن فقط (GET).
- **برچسب‌ها:**
  - **[M]**: Observed by model. L1 خودش از ledger، git، خروجی Jobها یا GitHub خواند.
  - **[D]**: Documented. از سند یا پیام بازبین آمده است.
  - **[NV]**: Not Verified.
  - **[L-bench]**: از analysis-l3-phase3 0.1 §۶، Observed by model از دادهٔ seq ‏4336 تا 4574.
- **قید این سند:**
  - URL، نام حساب و ایمیل عمداً نیامده‌اند.
  - این PR فقط `docs/aeo/**` و یک جمله در `docs/runbooks/USER_ACCOUNT_REMOVAL.md` را تغییر می‌دهد.
  - **پذیرش با Review ‏APPROVED مالک روی head همین PR است (دروازهٔ پایان دستهٔ ۳).**

## ۱. هدف دستهٔ ۳
- دامنه [D]: چهار اصلاح کوچک (E122، «دستهٔ ۳: پیشنهاد بازبین»):
  - مورد آپلود صوت: دو یافتهٔ حسابرسی AUD-1، یعنی F-1 (bug، high) و F-6 (smell).
  - مورد P2-01: دو nit امنیتی دربارهٔ `module` در storage.
  - مورد P2-06: ردیف یتیم plt پس از hard delete، به شکل گزینهٔ الف، یعنی runbook (E123).
- ترتیب [D]: P3-03 ⇒ P3-02 ⇒ P3-01 ⇒ P3-04، یک Task در هر بلوک (phase3-plan §۲).

## ۲. خلاصهٔ داوری
| معیار (phase3-plan §۶) | هدف | نتیجه | حکم |
|---|---|---|---|
| معیار ۱. Taskها | چهار کارت از Task Card تا merge؛ ≥ ۳ با تست مرجع سبز | **۴ از ۴**؛ ۰ نقض Gate؛ ۰ blocked [L-bench] | ✔ برآورده |
| معیار ۲. First-Pass Review Acceptance | ≥ ۶۰٪ (تعریف b1) | **ب۱: ۴ از ۴ (۱۰۰٪)**؛ الف و ب۲ ۴ از ۴؛ هر چهار در یک attempt [L-bench] | ✔ برآورده |
| معیار ۳. Escaped Defects ‏(risk:high) | ۰ | **۰**؛ هیچ PR ‏Task در gate ‏high نبود (سه medium، یک low)، پس معیار تهی است [L-bench] | ✔ برآورده (تهی) |
| معیار ۴. Recovery Success ‏(B-06) | ≥ ۸۰٪ اگر قطعی رخ دهد | **قطعی رخ نداد** (۰ Job یتیم، ۰ blocked، ۰ freeze) [L-bench] | اندازه‌گیری نشد |
| معیار ۵. Usage per Accepted PR | ثبت؛ جمع زیر سقف هفته | جمع **8.87** دلار؛ میانگین 2.22، میانه 2.06، بیشینه 3.27 ‏(P3-02)، کمینه 1.48 ‏(P3-04) [L-bench]؛ هفته 56.51 از ۱۰۰ [M] | ✔ ثبت شد؛ زیر سقف |
| معیار ۶. رخداد امنیتی | ۰ | **۰**؛ ۰ `PushStopped`؛ یک `ApprovalInvalidated` ‏(4405) که کنترل درست کار کرد [L-bench] | ✔ برآورده |
| معیار ۷. صفر regression | ‏main-check ‏pass پس از هر merge؛ شمار فایل‌های `pnpm test:unit` کم نشود | **۸ از ۸** merge با بررسی سبز [L-bench]؛ فایل‌های آزمون unit ‏۳۱۸ ⇒ ۳۱۸ [M] | ✔ برآورده |
| معیار ۸. رفتار آپلود | آزمون «PUT کند ولی پیش‌رونده» سبز؛ «PUT گیرکرده» همچنان timeout | هر دو آزمون روی head ‏#116 در verify و CI سبز؛ آزمون نخست روی base شکست می‌خورد [M] | ✔ برآورده (شاهد L1) |
| دروازهٔ پایان | PR «Batch 3 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک | همین PR | منتظر approve مالک |

- **جمع‌بندی:**
  - برآورده: بندهای ۱، ۲، ۵، ۶، ۷ و ۸.
  - برآورده و تهی: بند ۳، چون هیچ Task ‏high نبود.
  - اندازه‌گیری نشد: بند ۴، چون قطعی رخ نداد. phase3-plan §۶ همین حالت را پیش‌بینی کرده است.

## ۳. جدول Taskها — شاهد [M]
| Task | ریسک کارت / gate | PR | merge_sha | seq ‏Merged | attempt | Job | هزینه (دلار) | merge |
|---|---|---|---|---|---|---|---|---|
| ‏P3-03 | low / medium | ‏#114 | `059136d` | 4462 | ۱ | ۴ | 2.11 | ‏D7 |
| ‏P3-02 | medium / medium | ‏#115 | `8d2dc9e` | 4499 | ۱ | ۴ | 3.27 | ‏D7 |
| ‏P3-01 | medium / medium | ‏#116 | `c742fa0` | 4536 | ۱ | ۴ | 2.01 | ‏D7 |
| ‏P3-04 الف | low / low | ‏#117 | `4c15739` | 4573 | ۱ | ۴ | 1.48 | ‏D7 |
| **جمع** | — | ۴ PR | — | — | ۴ | ۱۶ | **8.87** | ۴ ‏D7 |

- **PRهای دیگر پنجره [M]:**
  - PR کارت: #113 (کارت‌ها و phase3-plan ‏0.1، `930b1a1`).
  - PRهای aeo: #101 ‏(R89، `4697a65`)، #102 ‏(R91، `661cb34`) و #103 (سیاست runbook، `2b52101`).
  - جمع پنجره ۸ merge است، و هیچ‌یک از چهار PR بیرون از جدول هزینهٔ Job ندارد.
- **زمان PR تا merge [M]:** همهٔ PRهای Task ‏۱۰ تا ۱۳ دقیقه بودند، که بیشترش زمان CI است.

## ۴. رخدادها [M]
- **E22 با تداخل و approve دوباره (aeo ‏#103):**
  - رخداد: پس از merge ‏R91، شاخهٔ سیاست runbook با main به‌روز شد. تداخل فقط در جملهٔ `comment` ‏`targets.json` بود، و هر دو جمله نگه داشته شدند.
  - پیامد: patch-id عوض شد، پس `ApprovalInvalidated` ‏(4405، `patch_changed`). مالک دوباره approve داد (4418، E126)، و merge در 4427 انجام شد.
  - مقایسه: ‏#102 بی تداخل به‌روز شد، و approve با D19 منتقل شد (4389).
- **قفل‌های TestPlan به‌موقع:** مالک هر چهار TestPlan را پیش از نخستین Job قفل کرد (4414 تا 4417). هیچ `testplan-lock` ‏fail نبود.
- **اجرای زندهٔ R89:** gate ‏`scope` در هر چهار PR ‏Task گفت: «4 job(s) ran with the Task Card at base (R89)» ‏pass.
- **فایل‌های untracked در worktree ‏Job (بسته، بی ریسک) [D]:**
  - یافته: `.bashrc`، `.gitconfig`، `.mcp.json` و `.idea` در worktree ‏Job دیده شدند.
  - توضیح: این‌ها placeholderهای ۰ بایتی مستند sandbox ‏Claude Code روی Linux و WSL2 هستند. sandbox آن‌ها را در مدت فرمان می‌گذارد و پس از آن برمی‌دارد.
  - سنجش: پس از Job در worktree نبودند [M]. Job ‏`.mcp.json` را نمی‌خواند، و این فایل‌ها به commit نمی‌رسند (ایست ۲۶۷).
- **یافتهٔ مشترک دو review ‏P3-04:** گام ۵ runbook ترتیب باطل شدن نشست‌ها را نادرست می‌گفت. همین PR آن را اصلاح می‌کند (§۷).
- **دیگر:** هیچ `RegressionDetected`، freeze، revert یا `PushStopped` نبود.

## ۵. Rهای controller و سیاست [M]
| R یا سیاست | commit ‏aeo | کار |
|---|---|---|
| ‏R89 | `4697a65` | gate ‏`scope` می‌سنجد که آخرین Job هر (گام، نقش) با کارت base اجرا شده است (`task-card-hash`) |
| ‏R91 | `661cb34` | review یک Task ‏DB منتظر CI سبز روی head می‌ماند (`db_paths`)؛ در دستهٔ ۳ هیچ Task ‏DB نبود |
| سیاست runbook | `2b52101` | یک فایل دقیق `docs/runbooks/USER_ACCOUNT_REMOVAL.md` در write_paths |

- **نامزدهای controller [D]** (شماره‌گذاری بازبین، ایست ۲۶۸):
  - ‏R92: هشدار یا رد preflight بی `TestPlanLocked`.
  - ‏R93: پیام «fetch first» یا fetch خودکار در main-check.
  - ‏R94: پس گرفته شد (placeholder مستند sandbox).
  - ‏R95: ثبت `JobResidue` برای placeholder ماندگار (کم‌اولویت).
  - ‏R96: `pnpm schema:version` در bash_allow.
  - بی شماره: bash_allow گسترده‌تر برای implementer و reviewerها؛ typecheck و lint در verify؛ گسترش فهرست سفید export ‏L-bench.

## ۶. نامزدهای دستهٔ بعد (از Jobهای review و پرسش‌های باز implementer؛ همه غیرمسدودکننده) [M]
| نامزد | منشأ | شدت یا نوع |
|---|---|---|
| ‏P3-04 ب: job نگهداشت برای ردیف‌های plt بی حساب | تصمیم مالک E123 (الف+ب) | ‏high (حذف داده)؛ پس از سنجش شمار ردیف یتیم |
| سقف مطلق برای PUT آپلود | پرسش باز implementer ‏P3-01 | تصمیم مالک |
| ‏PUT عکس تخته با `fetch` و بی progress (هنوز ۹۰ ثانیهٔ ثابت) | ‏security ‏nit ‏P3-01 | ‏nit، hypothesis |
| خوانندهٔ علت قطع آپلود و شمارندهٔ تشخیصی | پرسش باز implementer ‏P3-02 | کارت جدا (capture-diagnostics) |
| ‏Map ‏`causes` و `sentBytes()` بی try | ‏code و security ‏nit ‏P3-02 | ‏nit |
| دو برچسب admin «in the last hour» (failed_runs و failed_jobs) | ‏E107، P2-03 | تصمیم متن مالک |
| اصلاح‌های حسابرسی بلوک ۸۰ (AUD-1 ‏F-2 تا F-10 و AUD-2 تا AUD-5) | ‏E106 | مختلف |

## ۷. اصلاح گام ۵ runbook در همین PR [M]
- فایل: `docs/runbooks/USER_ACCOUNT_REMOVAL.md` (از #117).
- تغییر: فقط یک جمله، یعنی گام ۵. اکنون می‌گوید نشست‌های کاربر در گام `revoke_auth` باطل می‌شوند، پیش از hookهای پاک‌سازی ماژول‌ها. هویت Auth در پایان job، در گام `delete_auth`، با soft delete خود Supabase پاک‌سازی می‌شود.
- منبع: یافتهٔ code ‏minor و security ‏nit ‏P3-04 (`job-20261105-a44dd398` و `job-20261105-5c4dbf16`). هر دو آن را از کد base تأیید کرده بودند.
- قید: بی SQL، بی URL، بی ایمیل.

## ۸. کارهای باز مالک
- **پاک‌سازی:** worktree و شاخهٔ `aeo/P3-04` (R44/R86). L1 حذف نمی‌کند.
- **تصمیم‌ها:**
  - سقف مطلق PUT آپلود.
  - زمان P3-04 ب.
  - دو برچسب admin معلق ذیل E107.
- **دستهٔ بعد:** دامنه و ترتیب را مالک تعیین می‌کند. ورودی‌هایش §۵ و §۶ این سند هستند.

## ۹. تصمیم‌های مالک در دستهٔ ۳ [D]
| تصمیم | موضوع |
|---|---|
| ‏E122 | دستهٔ ۳ = پیشنهاد بازبین |
| ‏E123 | شکل P3-04: الف+ب (الف در این دسته، ب در دستهٔ بعد) |
| ‏E124 | انتقال R89 و R91 به main تازه با merge ‏main درون شاخه (گزینهٔ ج، روال E22) |
| ‏E125 | approve ‏aeo ‏#101، #102، #103 و Recalino ‏#113 |
| ‏E126 | قفل چهار TestPlan دستهٔ ۳ و approve دوبارهٔ aeo ‏#103 |

## ۱۰. پذیرش
- **پذیرش دستهٔ ۳:** با Review ‏APPROVED مالک روی head همین PR. این دروازهٔ پایان دستهٔ ۳ است (phase3-plan §۶).
- **پس از پذیرش:** دامنهٔ دستهٔ بعد را مالک تعیین می‌کند.
