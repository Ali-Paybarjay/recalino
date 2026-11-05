# برنامهٔ دستهٔ ۳ ‏L3 — Recalino ‏(P3-01 تا P3-04)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.2 (2026-11-05، بلوک ۱۲۳ ‏L1: E123 = الف+ب در §۷ و §۸؛ پیامد R91 در §۳؛ همراه PR پذیرش دستهٔ ۳ به Recalino می‌رود، بلوک ۱۳۱)؛ 0.1 (2026-11-05، بلوک ۱۲۰ ‏L1؛ پیش‌نویس برای بازبینی) |
| وضعیت | پیش‌نویس. دستهٔ ۳ با تصمیم مالک E122 («دستهٔ ۳: پیشنهاد بازبین») آغاز شد. هیچ Job تا merge ‏R89 و R91 و merge ‏PR کارت‌ها با approve مالک اجرا نمی‌شود |
| بازبینی | بازبینی شد، ایست ۲۵۱ (2026-11-05): sha256 هر فایل، schema کارت‌ها و TestPlanها، قفل‌ها، جدایی owns_paths، ریسک و R87 |
| پایه | Recalino ‏`main@49e57e4` (پس از پذیرش فاز ۲، #112)؛ aeo ‏`main@ac45225` |
| مرجع‌ها | پذیرش فاز ۲ ‏`docs/aeo/l3/phase2-acceptance.md` (§۵ تا §۷)؛ جمع‌بندی فاز ۲ ‏`docs/l3/phase2-closeout.md` ‏0.2؛ گزارش L1 بلوک ۸۰ (AUD-1)؛ برنامهٔ فاز ۲ ‏`docs/l3/phase2-plan.md` (§۵ و §۶) |
| قید X1 | متن کد و اسناد Recalino خوانده نشد. owns_paths از نام فایل‌ها (`git ls-tree`)، گزارش بلوک ۸۰ و خروجی Jobهای فاز ۲ آمده است |

برچسب‌ها: **Documented** (با مسیر سند) / **Observed by model** / **Not Verified**.

## ۱. هدف
- مورد دامنه (Documented، پیام بلوک ۱۲۰ بازبین): چهار اصلاح کوچک. دو اصلاح از حسابرسی AUD-1 بلوک ۸۰ آپلود صوت را می‌پوشانند (F-1 و F-6). دو اصلاح دیگر یافته‌های باز فاز ۲ هستند (دو nit ‏P2-01 و ردیف یتیم plt ‏P2-06).
- مورد اولویت: F-1 تنها bug با شدت high در این دسته است. آپلود کند ولی پیش‌رونده امروز پس از ۹۰ ثانیه قطع می‌شود و از نو شروع می‌شود.

## ۲. فهرست و ترتیب کارت‌ها
| ترتیب | کارت | یافتهٔ منبع | ‏CWE یا نوع | ریسک کارت | ریسک gate (برآورد از مسیر) | ‏merge | ‏owns_paths |
|---|---|---|---|---|---|---|---|
| گام ۱ | ‏P3-03 | ‏P2-01 ‏(#104)، دو nit: module در دیگر نویسنده‌ها، و allowlist | ‏CWE-22 | ‏low | ‏medium | ‏D7، بی approve | ‏`packages/core/src/plt/storage.ts`، `storage-compose-module.test.ts`، `storage-module.test.ts` (تازه) |
| گام ۲ | ‏P3-02 | ‏AUD-1 ‏F-6، علت شکست آپلود و شمارندهٔ تشخیصی | ‏smell | ‏medium | ‏medium | ‏D7، بی approve | ‏`apps/web/src/ui/workspace/upload.ts`، `upload.test.ts`، `automatic-learning.ts`، `automatic-learning.test.ts`، `manual-audio-manager.ts`، `manual-audio-manager.test.ts`، `docs/design/UI_COPY_PENDING.md` |
| گام ۳ | ‏P3-01 | ‏AUD-1 ‏F-1، مهلت PUT قطعه با progress از نو | ‏bug، high، confirmed | ‏medium | ‏medium | ‏D7، بی approve | ‏`apps/web/src/ui/workspace/upload.ts`، `upload.test.ts`، `upload-progress.ts`، `upload-progress.test.ts` |
| گام ۴ | ‏P3-04 (الف، پیش‌فرض) | ‏P2-06 ‏(#111)، ردیف یتیم plt پس از hard delete | ‏CWE-459 | ‏low | ‏low (`plain-docs`) | ‏D7، بی approve | ‏`docs/runbooks/USER_ACCOUNT_REMOVAL.md` (تازه) |

- مورد ترتیب (Documented، پیام بازبین): P3-03 ⇒ P3-02 ⇒ P3-01 ⇒ P3-04. یک Task در هر بلوک.
- مورد وابستگی سخت (Observed by model، اسکریپت): P3-02 و P3-01 هر دو `upload.ts` و `upload.test.ts` را تغییر می‌دهند. پس P3-01 فقط روی base پس از merge ‏P3-02 اجرا می‌شود (R81). کارت P3-01 ‏`depends_on: ["P3-02"]` دارد.
- مورد قفل‌ها (Observed by model، اسکریپت): هیچ TestPlan فایلی را قفل نمی‌کند که کارت دیگری تغییرش می‌دهد. P3-01 عمداً `automatic-learning.ts`، `upload.ts` و `UI_COPY_PENDING.md` را قفل نمی‌کند، چون P3-02 آن‌ها را تغییر می‌دهد.
- مورد متن UI: هیچ کارتی متن UI را عوض نمی‌کند. `upload-copy.ts` و `approved-copy.test.ts` در TestPlan ‏P3-02 و P3-01 قفل‌اند. هر متن تازه فقط به‌صورت «متن معلق» در `docs/design/UI_COPY_PENDING.md` می‌آید (سازوکار E107).
- مورد ریسک (Observed by model، `policy/risk-rules.yaml`):
  - مورد medium: مسیرهای `apps/web/src/ui/workspace/**` و `packages/core/src/plt/storage*` قاعدهٔ high ندارند، پس gate ‏medium می‌سنجد.
  - مورد low: P3-04 الف فقط یک `docs/**/*.md` است، پس gate ‏low می‌سنجد. نام فایل عمداً واژهٔ «delet» ندارد، چون قاعدهٔ `data-deletion` هر مسیر `*delet*` را high می‌کند.
  - مورد sql-destructive: متن runbook نباید `delete from`، `drop`، `alter` یا `truncate` داشته باشد، وگرنه بررسی معنایی آن را high می‌کند. این در کارت آمده است.
- مورد درس فاز ۲: هیچ کارت این دسته migration یا تغییر DB ندارد، پس `apps/web/src/server/schema-version.generated.ts` لازم نیست. گزینهٔ ب ‏P3-04 هم فعلاً migration ندارد. اگر روزی migration بخواهد، این فایل باید در owns_paths آن بیاید.

## ۳. جریان اجرا
- مورد پیش‌نیاز ۱ (Documented): merge ‏R89 و R91 در aeo (در دست L-dev).
- مورد پیش‌نیاز ۲: PR کارت‌های دستهٔ ۳ روی `aeo/task-cards-13` با approve مالک. این PR شامل کارت‌ها، TestPlanها و `docs/aeo/l3/phase3-plan.md` است.
- مورد پیش‌نیاز ۳ (درس فاز ۲، runbook ‏2.87): پیش از نخستین Job هر کارت، مالک TestPlan آن را با `testplan lock` قفل می‌کند، و L1 `TestPlanLocked` آن Task را در ledger می‌بیند.
- مورد پیش‌نیاز ۴، فقط برای P3-04 الف: یک PR سیاست aeo فایل دقیق `docs/runbooks/USER_ACCOUNT_REMOVAL.md` را به `write_paths.recalino` بیفزاید، نه `docs/runbooks/**` (سازوکار E93). preflight امروز این کارت را با R87 رد می‌کند (Observed by model، بلوک ۱۲۰).
- مورد پیامد R91 (Documented، پیام بازبین؛ Observed by model از کد R91): برای Task ‏DB (owns_paths هم‌پوشان با `db_paths.recalino`: `supabase/**` و `packages/core/src/db/**`، با هم‌پوشانی محافظه‌کار R81) ترتیب چنین است: implement ⇒ verify ⇒ `pr open` ⇒ CI سبز ⇒ دو review ⇒ gate دوباره، چون review پیش از CI سبز رد می‌شود. هیچ کارت دستهٔ ۳ ‏Task ‏DB نیست. سنجش با `literalPrefix` همان کد: `packages/core/src/plt/storage*`، `apps/web/src/ui/workspace/*` و `docs/runbooks/*` با هیچ‌یک هم‌پوشان نیستند.
- مورد گام‌های هر Task: preflight ⇒ implement ⇒ verify (load1 زیر ۲) ⇒ review:code و review:security پشت سر هم (درس runbook ‏2.92) ⇒ `pr open --task` ⇒ gate حدود ۳۰ ثانیه پس از open ⇒ gate پس از CI ⇒ `merge --dry-run` ⇒ merge در فرمان جدا (D7) ⇒ `ledger verify` ⇒ `main-check --wait 15`.

## ۴. بودجه (D8)
- مورد هفتهٔ جاری (Documented، بازبین؛ از ledger): تا پایان فاز ۲ ‏**47.64 دلار از ۱۰۰** مصرف شده است، پس 52.36 دلار باقی است.
- مورد برآورد (Not Verified؛ برون‌یابی از فاز ۲): میانگین هر PR پذیرفته 2.03 دلار، میانه 1.81 و بیشینه 2.98 بود.

| کارت | برآورد (دلار) | پایه |
|---|---|---|
| کارت P3-03 | ‏1.5 تا 3 | همانند P2-01 (1.91) |
| کارت P3-02 | ‏1.5 تا 4 | سه فایل کد، خطر blocked در شمارنده |
| کارت P3-01 | ‏2 تا 5 | آزمون ساعت ساختگی و XHR ساختگی |
| کارت P3-04 الف | ‏0.5 تا 1.5 | فقط سند |
| جمع (پیش‌فرض الف) | ‏5.5 تا 13.5 | زیر باقی‌ماندهٔ هفته؛ هر بلوک یک Task، زیر ۲۰ دلار |
| کارت P3-04 ب (اگر E123 = ب) | ‏3 تا 7 | حذف داده، آزمون int، خطر blocked |

## ۵. قواعد توقف
- مورد پایه: همهٔ قواعد `l3-plan.md` §۶ و `phase2-plan.md` §۵ برقرارند: خطاهای Job، دادهٔ حساس، مرز owns_paths، سقف هزینه، رد طبقه‌بند، main قرمز، R87 و یک دور rework پس از CI.
- مورد افزوده‌های دستهٔ ۳:
  - مورد blocked پیش‌بینی‌شده: هر blocked که کارت پیش‌بینی کرده است ⇒ توقف بلوک و گزینه‌ها برای مالک. L1 هیچ فایل تازه‌ای به کارت نمی‌افزاید. موارد:
    - مورد P3-03: فراخوانی با module بیرون از allowlist.
    - مورد P3-02: ثبت شمارنده بیرون از owns_paths یا با تغییر سرور.
    - مورد P3-01: فایلی بیرون از owns_paths.
    - مورد P3-04: روال موجود دیگری در docs.
  - مورد متن UI: هر تغییر در `upload-copy.ts` یا `approved-copy.test.ts` ⇒ fail ‏testplan-lock و توقف. متن تازه فقط با تصمیم مالک.
  - مورد ترتیب: P3-01 پیش از merge ‏P3-02 آغاز نمی‌شود.

## ۶. معیارهای پذیرش دستهٔ ۳
| معیار | هدف |
|---|---|
| معیار Taskها | چهار کارت از Task Card تا merge؛ ≥ ۳ ادغام‌شده با تست مرجع سبز. کارت blocked با تصمیم ثبت‌شدهٔ مالک شمرده می‌شود، نه شکست |
| معیار First-Pass Review Acceptance | نرخ ≥ ۶۰٪ (همان تعریف b1) |
| معیار Escaped Defects ‏(risk:high) | صفر |
| معیار Recovery Success ‏(B-06) | نرخ ≥ ۸۰٪ اگر قطعی رخ دهد؛ وگرنه «اندازه‌گیری نشد» |
| معیار Usage per Accepted PR | ثبت‌شده با `ledger stats`؛ جمع زیر سقف هفته |
| معیار رخداد امنیتی | صفر (خروج داده، تغییر policy به‌دست عامل) |
| معیار صفر regression | ‏CI ‏main پس از هر merge سبز (`main-check` ‏pass)؛ شمار فایل‌های `pnpm test:unit` کم نشود (پایه: ۳۱۸ فایل، پس از #111) |
| معیار رفتار آپلود | آزمون «PUT کند ولی پیش‌رونده» ‏(P3-01، AC-2 بند ۱) روی head و در CI سبز؛ آزمون «PUT گیرکرده» همچنان timeout |
| دروازهٔ پایان | درخواست PR «Batch 3 acceptance» روی `docs/aeo/` با Review ‏APPROVED مالک |

## ۷. دو شکل P3-04 (تصمیم مالک E123)
| شکل | کار | ریسک | merge | پیش‌نیاز |
|---|---|---|---|---|
| ‏الف (پیش‌فرض) | سند روال: حذف کاربر فقط از مسیر privacy برنامه؛ منع hard delete از داشبورد یا admin API؛ پیامد آن؛ ارجاع پاک‌سازی به مالک | ‏low (plain-docs) | ‏D7 | ‏PR سیاست aeo برای یک فایل در write_paths |
| ‏ب (فقط پیش‌نویس) | job دوره‌ای نگهداشت که ردیف‌های `plt.push_subscription` و `plt.notification` بی حساب فعال را پاک کند | ‏high (`data-deletion`، `sql-destructive`) | ‏approve مالک | تصمیم E123؛ کارت و TestPlan کامل؛ شاید grant یا فایل زمان‌بندی بیرون از owns_paths (blocked) |

- مورد الف: ریسک کم دارد و ردیف یتیم را پیشگیری می‌کند، ولی ردیف‌های یتیم موجود را پاک نمی‌کند. شمار ردیف یتیم امروز Not Verified است.
- مورد ب: ردیف‌های یتیم را پاک می‌کند، ولی حذف داده است، approve مالک می‌خواهد و خطر blocked دارد. پیش‌نویس آن در `docs/l3/cards/P3-04-b.draft.json` است و TestPlan ندارد.
- مورد ترکیب (تصمیم مالک E123 = الف+ب): الف در این دسته، و ب در دستهٔ بعد پس از سنجش شمار ردیف یتیم.

## ۸. تصمیم‌های مالک
| تصمیم | موضوع | پاسخ | تاریخ |
|---|---|---|---|
| تصمیم E122 | آغاز دستهٔ ۳ | «دستهٔ ۳: پیشنهاد بازبین» | ‏2026-11-05 |
| تصمیم E123 | شکل P3-04 | **الف+ب** (مالک، 10:23 UK): الف در دستهٔ ۳ (همان کارت P3-04)؛ ب در دستهٔ بعد، پس از سنجش شمار ردیف یتیم. پیش‌نویس ب در دفتر می‌ماند | ‏2026-11-05 |
| تصمیم باز | ‏PR سیاست برای `docs/runbooks/USER_ACCOUNT_REMOVAL.md` (R87)، فقط اگر E123 شامل الف است | ‏approve مالک لازم است | — |
