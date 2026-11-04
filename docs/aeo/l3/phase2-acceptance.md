# Recalino — پذیرش فاز ۲ ‏L3 ‏(Phase 2 acceptance)

- **نسخه:** 0.1 · تاریخ: 2026-11-04 · نویسنده: سشن L1 ‏(`aeo-99`) · پایه: `main@8eed258`
- **مرجع معیارها:** `docs/aeo/l3/phase2-plan.md` §۶ (نسخهٔ 0.5 در همین مخزن).
- **مرجع داده:**
  - سند جمع‌بندی فاز ۲ ‏(`docs/l3/phase2-closeout.md` نسخهٔ 0.2 در دفتر AEO).
  - تحلیل L-bench ‏(`docs/l2/bench/analysis-l3-phase2.md` نسخهٔ 0.1 §۶، از دادهٔ خام seq ‏3934 تا 4314).
  - دفتر کل `aeo` (۴۳۱۴ رویداد، سالم، لنگرها matched).
  - GitHub با خواندن فقط (GET).
- **برچسب‌ها:**
  - **[M]**: Observed by model. L1 خودش از ledger، git، خروجی Jobها یا GitHub خواند.
  - **[D]**: Documented. از سند یا پیام بازبین آمده است.
  - **[NV]**: Not Verified.
  - **[L-bench]**: از analysis-l3-phase2 0.1 §۶، Observed by model از دادهٔ seq ‏3934 تا 4314.
- **قید این سند:**
  - URL، نام حساب و ایمیل عمداً نیامده‌اند.
  - این PR فقط `docs/aeo/**` و یک سطر در `docs/design/UI_COPY_PENDING.md` را تغییر می‌دهد.
  - **پذیرش با Review ‏APPROVED مالک روی head همین PR است (دروازهٔ پایان فاز ۲).**

## ۱. هدف فاز ۲
- دامنه [D]: شش اصلاح کوچک از یافته‌های بازبین‌های فاز ۱ (closeout فاز ۱ §۶)، همه به‌صورت Task Card از طریق AEO (E104). اصلاح‌های حسابرسی بلوک ۸۰ در این دسته نبودند (E106 = الف).
- ترتیب [D]: نخست low، و migrationها آخر (phase2-plan §۲).

## ۲. خلاصهٔ داوری
| معیار (phase2-plan §۶) | هدف | نتیجه | حکم |
|---|---|---|---|
| معیار ۱. Taskها | شش کارت از Task Card تا merge؛ ≥ ۵ با تست مرجع سبز | **۶ از ۶**؛ ۰ نقض Gate [L-bench] | ✔ برآورده |
| معیار ۲. First-Pass Review Acceptance | ≥ ۶۰٪ (تعریف b1 فاز ۱) | **ب۱: ۶ از ۶ (۱۰۰٪)**؛ الف و ب۲ ۶ از ۶؛ «تنها یک attempt» ۴ از ۶ (۶۷٪) [L-bench] | ✔ برآورده |
| معیار ۳. Escaped Defects ‏(risk:high) | ۰ | **۰، موقت** برای P2-04، P2-02 و P2-06 [L-bench] | ✔ برآورده، با قید: پنجرهٔ پیگیری باز است |
| معیار ۴. Recovery Success ‏(B-06) | ≥ ۸۰٪ اگر قطعی رخ دهد | **قطعی رخ نداد** (۰ Job یتیم، ۰ freeze). جانشین‌ها: بازیابی تا پایان Task ۲ از ۲، بی دخالت دستی ۰ از ۲ [L-bench] | اندازه‌گیری نشد (همان فاز ۱) |
| معیار ۵. Usage per Accepted PR | ثبت؛ جمع زیر سقف هفته | جمع **12.20** دلار؛ میانگین 2.03، میانه 1.81، بیشینه 2.98 [L-bench]؛ جمع هفته 47.64 از ۱۰۰ [D] | ✔ ثبت شد؛ زیر سقف |
| معیار ۶. رخداد امنیتی | ۰ (خروج داده، تغییر policy به‌دست عامل) | **۰**؛ ۰ `PushStopped`؛ تغییر policy فقط با aeo ‏#99 و approve مالک [L-bench] | ✔ برآورده |
| معیار ۷. صفر regression | ‏main-check ‏pass پس از هر merge؛ شمار فایل‌های `pnpm test:unit` کم نشود | **۱۱ از ۱۱** merge با بررسی سبز [L-bench]؛ فایل‌های آزمون unit ۳۱۷ ⇒ ۳۱۸ [M] | ✔ برآورده |
| دروازهٔ پایان | PR «Phase 2 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک | همین PR | منتظر approve مالک |

- **جمع‌بندی:**
  - برآورده بی قید: بندهای ۱، ۲، ۵، ۶ و ۷.
  - برآورده با قید: بند ۳ (موقت).
  - اندازه‌گیری نشد: بند ۴، چون قطعی رخ نداد. phase2-plan §۶ همین حالت را پیش‌بینی کرده است.

## ۳. جدول Taskها — شاهد [M]
| Task | ریسک کارت / gate | PR | merge_sha | seq ‏Merged | attempt | Job | هزینه (دلار) | merge |
|---|---|---|---|---|---|---|---|---|
| ‏P2-01 | low / medium | ‏#104 | `1cf0455` | 4021 | ۱ | ۴ | 1.91 | ‏D7 |
| ‏P2-04 | high / high | ‏#105 | `707dfea` | 4086 | ۱ | ۴ | 1.27 | ‏approve مالک |
| ‏P2-03 | low / medium | ‏#107 | `03521b8` | 4151 | ۲ | ۵ | 2.98 | ‏D7 |
| ‏P2-05 | medium / medium | ‏#108 | `580e017` | 4188 | ۱ | ۴ | 1.52 | ‏D7 |
| ‏P2-02 | high / high | ‏#110 | `7361a06` | 4264 | ۲ | ۵ | 1.72 | ‏approve مالک |
| ‏P2-06 | high / high | ‏#111 | `8eed258` | 4313 | ۱ | ۴ | 2.80 | ‏approve مالک |
| **جمع** | — | ۶ PR | — | — | ۸ | ۲۶ | **12.20** | ۳ ‏D7، ۳ ‏approve |

- **PRهای دیگر پنجره [M]:**
  - PRهای کارت: #103 (کارت‌ها، `e691b53`)، #106 (کارت v2 ‏P2-03، `f4a3bf5`) و #109 (کارت‌های v2 ‏P2-02 و P2-06، `c776745`).
  - PRهای aeo: #99 (سیاست، `dca8680`) و #100 ‏(R85، `ac45225`).
  - جمع پنجره ۱۱ merge است، و هیچ‌یک از پنج PR بیرون از جدول هزینهٔ Job ندارد.
- **زمان‌ها [L-bench]:**
  - PR تا merge ‏high: میانه ۳۰٫۵ دقیقه (فاز ۱: ۲٫۲۲ ساعت)، که ۹۶٫۹٪ آن انتظار approve مالک است.
  - PR تا merge ‏D7: میانه ۱۳٫۱ دقیقه.
  - merge تا `MainChecked`: میانه ۱۲٫۱ دقیقه.
- **شمار فایل‌های آزمون unit [M]:**
  - پیش از #104: ۳۱۷ فایل. verify ‏P2-01 روی head ‏`aec241d` ۳۱۷ فایل اجرا کرد، و #104 فقط یک فایل آزمون موجود را تغییر داد.
  - پس از #111: ۳۱۸ فایل. verify ‏P2-06 روی tree ‏`main@8eed258` ۳۱۸ فایل اجرا کرد.
  - تنها فایل تازه، آزمون ایستای P2-02 است.

## ۴. رخدادها [M]
- **دو Job ‏blocked و کارت‌های v2:**
  - P2-03 ‏attempt 1 (seq ‏4092): شمارش failed_jobs بیرون از owns_paths بود و زمان چک پیشین فقط در `plt.job` بود. کارت v2 ‏(#106، E115) راه فقط‌خواندنی در `plt` را داد، و attempt 2 ⇒ #107.
  - P2-02 ‏attempt 1 (seq ‏4194): آزمون OPS-05 بازتولید فایل نسخهٔ schema را می‌خواست، بیرون از owns_paths. کارت‌های v2 ‏P2-02 و P2-06 ‏(#109، E117) این فایل را دادند، و attempt 2 ⇒ #110.
  - هزینهٔ دو attempt ‏blocked روی هم 1.05 دلار بود. TestPlanها بی‌تغییر ماندند، پس قفل‌های مالک معتبر ماندند.
- **انحراف AC-5 ‏(P2-02 و P2-06):** اجرای `pnpm schema:version` برای implementer مجاز نبود. implementer فقط رشتهٔ نسخه را با Edit نوشت: diff یک سطر بود و آزمون OPS-05 سبز. بازبین انحراف را پذیرفت [D].
- **قفل TestPlan دیرهنگام ‏(P2-01):**
  - رخداد: gate نخست ‏#104 در testplan-lock ‏fail شد (seq ‏4001). مالک شش TestPlan را قفل کرد (seq ‏4006 تا 4011)، و gate دوم ‏pass شد.
  - شاهد برابری: verify و دو review پیش از قفل اجرا شدند، ولی sha256 ‏TestPlan در main، دفتر و head ‏#104 یکی بود و قفل همان sha را ثبت کرد. [M] و Observed by reviewer.
- **review هم‌زمان ‏(P2-03):** قفل Task اجرای دوم را با `LockContention` رد کرد (پیش از هر Job، بی هزینه). از آن پس reviewها پشت سر هم اجرا شدند.
- **دیگر:**
  - هیچ `RegressionDetected`، freeze، revert یا `PushStopped` نبود.
  - یک بار main-check ‏`needs_human` داد (CI ‏main در صف)، و دومین `--wait 15` ‏pass شد.

## ۵. Rهای controller و سیاست [M]
| R یا سیاست | commit ‏aeo | کار |
|---|---|---|
| ‏R85 | `ac45225` | check ساخته‌نشده تا ۱۲۰ ثانیه پس از push ‏pending است، نه missing |
| سیاست R87 | `dca8680` | دو فایل migration دقیق ‏P2-02 و P2-06 در write_paths، نه `supabase/**` (E105 الف) |

- **در راه [D]:** R89 و R91 در دست L-dev هستند و هنوز در main ‏aeo نیستند.
- **نامزدهای controller [D]:**
  - هشدار یا رد preflight وقتی `TestPlanLocked` نیست.
  - `pnpm schema:version` در `bash_allow` نقش implementer.
  - شاهد typecheck و lint در verify.
  - آزمون int برای Taskهای DB (امروز فقط CI آن را اجرا می‌کند).

## ۶. نامزدهای دستهٔ بعد (از Jobهای review؛ همه غیرمسدودکننده) [M]
| یافته | Task | شدت و CWE |
|---|---|---|
| ‏`module` در `createObject` و `writeOwnedObject` سنجیده نمی‌شود | ‏P2-01 | ‏nit، CWE-22 |
| سنجش `module` از نوع denylist است؛ پیشنهاد allowlist | ‏P2-01 | ‏nit |
| برچسب admin «Jobs failed in the last hour» با پنجرهٔ تازه دقیق نیست | ‏P2-03 | ‏nit، CWE-451 |
| شاهد int برای `lastSucceededJobAt` | ‏P2-03 | ‏tests_missing |
| قفل SHARE هنگام ساخت ایندکس بی `concurrently` | ‏P2-02 | ‏nit، CWE-400، hypothesis |
| ردیف یتیم `plt.push_subscription` و `plt.notification` پس از hard delete بیرون از مسیر privacy | ‏P2-06 | ‏minor، CWE-459، hypothesis |
| parser آزمون FK پسوند عددی نام FK را مدل نمی‌کند | ‏P2-06 | ‏nit، CWE-1023 |
| اصلاح‌های حسابرسی بلوک ۸۰ (AUD-1 تا AUD-5) | — | مختلف (E106 = الف) |

## ۷. کارهای باز مالک
- **پاک‌سازی:** worktree و شاخهٔ `aeo/P2-02` و `aeo/P2-06` (R44/R86). L1 حذف نمی‌کند.
- **ردیف یتیم plt:** یک روال مستند که حذف کاربر را فقط از مسیر privacy مجاز بداند، یا یک job نگهداشت (یافتهٔ P2-06).
- **دو برچسب admin:** «in the last hour» برای failed_runs و failed_jobs. هر دو در `docs/design/UI_COPY_PENDING.md` ذیل E107 ثبت‌اند. تغییر متن تصمیم مالک است.

## ۸. تصمیم‌های مالک در فاز ۲ [D]
| تصمیم | موضوع |
|---|---|
| ‏E104 | آغاز فاز ۲ و پاک‌سازی انبوه |
| ‏E105 | دو FK ‏`plt → acc`: الف، حذف (P2-06) |
| ‏E106 | اصلاح‌های حسابرسی بلوک ۸۰: الف، نه در این دسته |
| ‏E107 | متن هشدار failed_runs: الف، بی‌تغییر و ثبت در فهرست متن‌های معلق |
| ‏E108 و E109 | دو تصمیم controller برای L-dev (R90 و R91) |
| ‏E110 | approve ‏Recalino ‏#103 و aeo ‏#99 |
| ‏E111 | قفل شش TestPlan؛ approve ‏aeo ‏#100؛ E107 الف، E108 ۲، E109 ۱ |
| ‏E112 و E113 | بازخورد مالک دربارهٔ شکل پیام‌های بازبین |
| ‏E114 | approve ‏#105 ‏(P2-04) |
| ‏E115 و E116 | کارت v2 ‏P2-03، گزینهٔ الف؛ approve ‏#106 |
| ‏E117 و E118 | کارت‌های v2 ‏P2-02 و P2-06، گزینهٔ الف؛ approve ‏#109 |
| ‏E119 | approve ‏#110 ‏(P2-02) |
| ‏E120 | approve ‏#111 ‏(P2-06) |

## ۹. پذیرش
- **پذیرش فاز ۲:** با Review ‏APPROVED مالک روی head همین PR. این دروازهٔ پایان فاز ۲ است (phase2-plan §۶).
- **پس از پذیرش:** دامنهٔ دستهٔ بعد را مالک تعیین می‌کند. ورودی‌هایش §۵، §۶ و §۷ این سند هستند.
