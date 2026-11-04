# Recalino — پذیرش فاز ۱ ‏L3 ‏(Phase 1 acceptance، دروازهٔ G-L3)

- **نسخه:** 0.1-draft · تاریخ: 2026-11-04 · نویسنده: سشن L1 ‏(`aeo-10`) · پایه: `main@c886877`
- **مرجع معیارها:** l3-plan §۸ در دفتر مهندسی AEO (Documented: روادمپ §۱-۳ و §۹).
- **مرجع داده:** سند جمع‌بندی فاز ۱ ‏(`docs/l3/phase1-closeout.md` نسخهٔ 0.1 در دفتر AEO)، دفتر کل `aeo` (۳۹۰۷ رویداد، سالم، لنگرها matched)، و GitHub با خواندن فقط (GET).
- **برچسب‌ها:**
  - **[M]**: Observed by model. L1 خودش از ledger، git یا GitHub خواند.
  - **[D]**: Documented. از سند یا پیام بازبین آمده است.
  - **[NV]**: Not Verified.
  - **⟨L-bench⟩**: جای عددی که L-bench می‌سنجد. تا تأیید بازبین خالی می‌ماند.
- **قید این سند:**
  - URL، نام حساب و ایمیل عمداً نیامده‌اند.
  - این PR فقط `docs/aeo/**` را تغییر می‌دهد.
  - **این سند پیش‌نویس است. پذیرش با Review ‏APPROVED مالک روی همین PR است (G-L3).**

## ۱. خلاصهٔ داوری
| معیار (l3-plan §۸) | هدف | نتیجه | وضعیت |
|---|---|---|---|
| معیار Taskها | ۱۰ Task واقعی از Task Card تا merge؛ ≥ ۸ ادغام‌شده با تست مرجع سبز | **۱۰ از ۱۰** (و P1-00)، همه با verify ‏pass و main-check ‏pass [M] | ✔ برآورده |
| معیار First-Pass Review Acceptance | نرخ ≥ ۶۰٪ | ⟨L-bench: First-Pass⟩ | منتظر L-bench |
| معیار Escaped Defects (risk:high) | صفر | ‏defect واقعی: **۰** [M]؛ seeded: ⟨L-bench⟩ | بخش واقعی ✔؛ seeded منتظر L-bench |
| معیار Recovery Success ‏(B-06) | نرخ ≥ ۸۰٪، فقط با `aeo run` | ⟨L-bench: Recovery⟩ | منتظر L-bench |
| معیار Usage per Accepted PR ‏(B-07) | ثبت‌شده؛ ظرفیت هفتگی برآوردشده | ⟨L-bench: Usage/PR⟩؛ عدد خام ledger در §۳ | منتظر L-bench |
| معیار رخداد امنیتی | صفر؛ و صفر در B-08 | **۰** رخداد [M]؛ B-08: ⟨L-bench⟩ | بخش ledger ✔؛ B-08 منتظر L-bench |
| دروازهٔ G-L3 | PR «Phase 1 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک | همین PR | منتظر approve مالک |

## ۲. معیار Taskها — شاهد [M]
ستون «attempt» یعنی شمار attemptهای گام implement. هزینه همان `total_cost_usd` در رویدادهای Job است (R50). ستون «seq ‏Merged» از دفتر کل `aeo` آمده است.

| Task | ریسک | PR | merge_sha | seq ‏Merged | attempt | Job | هزینه (دلار) |
|---|---|---|---|---|---|---|---|
| ‏P1-00 | medium | ‏#84 | `578ee94` | 2874 | ۲ | ۷ | 2.01 |
| ‏P1-01 | low | ‏#85 | `b798cdd` | 2909 | ۲ | ۹ | 1.36 |
| ‏P1-02 | low | ‏#87 | `9670c5b` | 3007 | ۱ | ۳ | 1.13 |
| ‏P1-03 | low | ‏#88 | `98d3b6f` | 3032 | ۱ | ۵ | 0.99 |
| ‏P1-04 | low | ‏#89 | `ded3b16` | 3057 | ۱ | ۵ | 1.32 |
| ‏P1-05 | low | ‏#91 | `c3e8a99` | 3148 | ۱ | ۳ | 0.90 |
| ‏P1-06 | low | ‏#93 | `1f6be50` | 3300 | ۱ | ۵ | 1.72 |
| ‏P1-07 | high | ‏#95 | `292d200` | 3445 | ۱ | ۴ | 1.48 |
| ‏P1-08 | high | ‏#96 | `b5f4e94` | 3589 | ۱ | ۴ | 1.68 |
| ‏P1-09 | high | ‏#100 | `c886877` | 3906 | ۳ | ۱۲ | 6.92 |
| ‏P1-10 | high | ‏#99 | `d3baa13` | 3773 | ۲ | ۵ | 3.80 |
| **جمع** | — | ۱۱ PR | — | — | ۱۶ | ۶۲ | **23.29** |

- **تست مرجع:**
  - هر Task یک TestPlan قفل‌شده به دست مالک داشت (`TestPlanLocked`)، و gate ‏testplan-lock در هر PR آن را سنجید.
  - seqها: ‏2788 ‏(P1-00)، 2521، 2919، 2920، 2921، 3067 و 3068 ‏(P1-05)، 3221، 3346، 3347، 3348 و 3349 ‏(P1-10).
  - گام verify با `pnpm test:unit` روی head ‏pass شد.
  - CI ‏«Lint, types, boundaries, tests, build» (شامل `pnpm test:int`) پیش از merge سبز بود، و main-check پس از merge ‏pass بود. [M]
- **merge:**
  - Taskهای `high` ‏(P1-07 تا P1-10) و P1-00 ‏(`medium`) فقط با approve مالک روی head ادغام شدند.
  - ‏P1-06 نخستین merge خودکار D7 بود. [M]، [D]
- **revert:** هیچ Task پس از merge ‏revert نشد. [M]

## ۳. معیارهای سنجشی — جای خالی برای L-bench
| سنجه | عدد | روش و منبع | برچسب |
|---|---|---|---|
| ‏First-Pass Review Acceptance | ⟨L-bench⟩ | ⟨L-bench: تعریف و شمارنده⟩ | ⟨—⟩ |
| ‏Recovery Success ‏(B-06) | ⟨L-bench⟩ | ⟨L-bench⟩؛ فقط Jobهای `aeo run` | ⟨—⟩ |
| ‏Usage per Accepted PR ‏(B-07) | ⟨L-bench⟩ | ⟨L-bench⟩ | ⟨—⟩ |
| زمان‌ها (Task Card تا merge، PR تا merge) | ⟨L-bench⟩ | ⟨L-bench⟩ | ⟨—⟩ |
| ‏Escaped Defects ‏(seeded) | ⟨L-bench⟩ | ⟨L-bench⟩ | ⟨—⟩ |
| رخداد امنیتی در B-08 | ⟨L-bench⟩ | ⟨L-bench⟩ | ⟨—⟩ |

- **عدد خام ledger، برای مقایسه و نه به‌جای عدد L-bench:** ‏23.29 دلار برای ۱۱ PR ‏Task، یعنی میانگین حدود 2.12 دلار برای هر PR؛ ۶۲ Job و ۷۸۴ نوبت. [M]
- **زمان PR تا merge در GitHub:** از ۰٫۲ تا ۴٫۰ ساعت. این عدد انتظار approve مالک را هم در بر دارد. [M]

## ۴. رخداد امنیتی و توقف‌ها — شاهد [M]
- **خروج داده:** رویدادی ثبت نشد.
- **تغییر policy به دست عامل:** رویدادی ثبت نشد.
  - هر تغییر policy (مثل `policy/targets.json`) با PR جدای انسانی و approve مالک انجام شد.
  - نوشتن Jobها به `owns_paths ∩ write_paths` محدود است (R87).
- **توقف push ‏(`PushStopped`):** این‌ها نگهبانی پیش از push بودند، نه رخداد امنیتی.

| seq | شاخه | علت | پیگیری |
|---|---|---|---|
| ‏2759 | کارت (`aeo/task-cards-2`) | الگوی حساس | — |
| ‏3490 | ‏`aeo/P1-08` | الگوی ایمیل‌شکل در دامنهٔ رزرو | R83 |
| ‏3534 | ‏`aeo/P1-08` | زیردامنهٔ example.com | R84 |
| ‏3681 | ‏`aeo/P1-09` | بیرون از write_paths | سیاست و R87 |

- **رخداد D20 (main قرمز ‏aeo، نه Recalino):** seq ‏3178 تا 3200. revert خودکار ⇒ `5c38fb1` در حدود ۱۰ دقیقه.
- **Jobهای `blocked` ‏(۷):**
  - موردهای محیطی (۴): seq ‏2561، 2697 و 2734 (install، P1-01)؛ 2820 (lockfile، P1-00).
  - موردهای کارت یا base ‏(۳): seq ‏3250 ‏(P1-06)، 3567 ‏(P1-09) و 3612 ‏(P1-10).
  - نتیجه: هر هفت Job ‏blocked ماند، و هیچ‌یک کار ناقص را push نکرد.
- **نقص آزمون int در CI ‏(P1-09، seq ‏3806 و 3815):**
  - مسیر کشف: verify و هر دو review ‏pass بودند، و CI آن را پیش از merge گرفت.
  - اصلاح: attempt 3 ‏(`1d97a5f`).
  - نتیجه: به main نرسید، پس escaped defect نیست.

## ۵. Rهای controller که فاز ۱ تولید کرد [M]
| R | commit ‏aeo | کار |
|---|---|---|
| ‏R79 | `f58f502` | مخزن بی CI پیش از merge، تست محلی سبز روی head می‌خواهد |
| ‏R80 | `59b91a0` | install بی side-effects cache ‏pnpm؛ سنجش داراییِ lifecycle |
| ‏R81 | `d6e4604` | implement با `owns_paths` هم‌پوشان رد می‌شود |
| ‏R82 | `f937358` و سیاست `a3088c2` | gate ‏review:security برای Taskهای high |
| ‏R83 | `ade9dbb` | نام‌های رزرو RFC 2606 در اسکن push ایمیل شمرده نمی‌شوند |
| ‏R84 | `6a6b8c6` | زیرنام‌های example.com/.net/.org هم رزرو هستند (RFC 6761 §6.5) |
| ‏R86 | `60fedd2` | شاخهٔ Task کهنه بی worktree رد می‌شود |
| ‏R87 | `5bbeda0` | کارت با `owns_paths` بیرون از write_paths پیش از هر رویداد رد می‌شود |
| ‏R88 | `3b33d8b` | ‏`--rework-findings` برای implement |

- **نامزدها [D]:**
  - ‏R85: رقابت gate با CI ساخته‌نشده (پنج رخداد: seq ‏2765، 3013، 3038، 3558، 3779).
  - ‏R89: سنجش hash کارت در gate.
  - تحمل base در verify.
  - آزمون int برای Taskهای DB.

## ۶. یافته‌های باز برای فاز ۲ (از Jobهای reviewer.security؛ همه hypothesis و غیرمسدودکننده) [M]
| یافته | Task | شدت و CWE |
|---|---|---|
| پاک‌سازی (sanitization) پارامتر `module` در کلید storage | ‏P1-07 | ‏nit، CWE-22/706 |
| ‏FK ‏`plt.notification.user_id` و `plt.push_subscription.user_id` → `acc.user_account` (استثنای E95)؛ masking آزمون FK در سه شکل SQL | ‏P1-10 | بدهی؛ minor، CWE-693 |
| ایندکس partial ‏`(state, finished_at)` روی `proc.processing_run` | ‏P1-09 | ‏nit، CWE-400 |
| پنجرهٔ غلتان هشدار `failed_runs` (و `failed_jobs`) | ‏P1-09 | ‏minor، CWE-778 |
| ردیف‌های ساختگی آزمون int در پایگاه آزمون مشترک می‌مانند (نقش app ‏delete ندارد) | ‏P1-09 | پیامد اصلاح |
| رشتهٔ query در URL پایگاه محلی (`?host=`) | ‏P1-08 | ‏nit، CWE-20 |

## ۷. تصمیم مالک
- **پذیرش فاز ۱:** با Review ‏APPROVED مالک روی head همین PR، پس از جای‌گذاری عددهای §۳.
- **فاز ۲:** دامنه و ترتیب را مالک تعیین می‌کند. ورودی‌هایش §۵ و §۶ است.
