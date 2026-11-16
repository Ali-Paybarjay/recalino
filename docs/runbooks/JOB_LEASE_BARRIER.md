# Runbook: مانع استقرار روی claim ‏(ADR-0004 بند 3، گام 3؛ P11-08)

این runbook برای cutover مانع lease و کل فاصلهٔ انتشار از آخرین استقرار production ‏(2b158f4) است. هر کنش این سند کلاس ۲ است و فقط مالک آن را اجرا می‌کند. هیچ کد، migration یا Job خودکاری تابع فعال‌سازی یا غیرفعال‌سازی را صدا نمی‌زند.

برای این cutover، این سند بر `docs/plans/RELEASE_RUNBOOK_2026-10-12.md` مقدم است (بند ۷ (ط)). Instant Rollback عادی هم در همان سند است و اینجا فقط گام‌های افزودهٔ مانع می‌آید (بند ۳).

## سازوکار، به‌کوتاهی

- migration ‏`supabase/migrations/20261112130000_plt_job_claim_barrier.sql` یک trigger به نام `job_claim_barrier` روی `plt.job` می‌سازد که **غیرفعال** ساخته می‌شود. روشن یا خاموش بودن مانع همان وضع این trigger است. ستون یا جدول تازه‌ای ساخته نمی‌شود.
- وقتی مانع فعال است، هر claim (ردیفی که به `running` می‌رود) فقط وقتی پذیرفته می‌شود که در `lease_generation` نسل کنونی ردیف `plt.job_lease_generation` و در `lease_build` یکی از `allowed_builds` را نوشته باشد. در غیر این صورت کل دستور claim با خطای `job claim refused by the claim barrier` رد می‌شود.
  - ستون NULL رد می‌شود.
  - `allowed_builds` تهی یا NULL یعنی هیچ build مجاز نیست و **همهٔ** claimها رد می‌شوند (fail-closed). یادداشت «NULL or empty: no build restriction» در migration ‏20261112120000 فقط وضع پیش از فعال‌سازی است.
  - هر نوشتنی که Job را از `running` بیرون ببرد (complete، fail، sweep، cancel، requeue) هر دو ستون را پاک می‌کند. پس مقدار claim قبلی به claimی که خودش آن را ننویسد اختیار نمی‌دهد.
- شناسهٔ build ‏(AC-3): runner در هر claim مقدار `VERCEL_GIT_COMMIT_SHA` را ثبت می‌کند (`runnerBuild` در `apps/web/src/server/jobs.ts`). این همان commit کامل ۴۰ نویسه‌ای است که استقرار از آن ساخته شده. اگر خالی باشد یا شکل SHA کامل نداشته باشد، claim مقدار NULL می‌نویسد و مانع فعال آن را رد می‌کند.
- تابع‌ها (هر دو security invoker و بیرون از دسترس `public`، `anon`، `authenticated` و `recalino_app`):
  - `plt.activate_job_claim_barrier(allowed_builds text[], current_build text) returns integer`: در یک تراکنش ورودی را می‌سنجد، ردیف مانع و `plt.job` را قفل می‌کند، trigger را روشن می‌کند، `lease_token` همهٔ Jobهای running را می‌چرخاند، نسل را یکی بالا می‌برد، `allowed_builds` را ثبت می‌کند و نسل جاری را برمی‌گرداند.
    - اگر مجموعه تهی یا NULL باشد، عضو خالی داشته باشد، یا `current_build` خالی یا بیرون از مجموعه باشد، خطا می‌دهد و هیچ چیز را تغییر نمی‌دهد.
    - idempotent است: وقتی مانع فعال است و مجموعه (به‌عنوان set) همان است، فقط نسل جاری را برمی‌گرداند و هیچ نسلی بالا نمی‌رود و هیچ توکنی نمی‌چرخد.
    - اگر مانع فعال باشد و مجموعه فرق کند (بند ۳)، نسل دوباره بالا می‌رود و توکن‌ها دوباره می‌چرخند.
  - `plt.deactivate_job_claim_barrier() returns void`: فقط trigger را خاموش می‌کند. هیچ ردیفی حذف یا تغییر نمی‌شود و نسل و `allowed_builds` همان می‌مانند. idempotent است.
- قفل‌ها (AC-13):
  - migration: ‏`CREATE TRIGGER` و `ALTER TABLE … DISABLE TRIGGER`، هر کدام قفل `SHARE ROW EXCLUSIVE` روی `plt.job`، در یک بلوک `DO` با `lock_timeout = 3s`. بی بازنویسی و بی اسکن جدول.
  - تابع فعال‌سازی: `lock table plt.job in share row exclusive mode` و `ALTER TABLE … ENABLE TRIGGER`.
  - تابع غیرفعال‌سازی: `ALTER TABLE … DISABLE TRIGGER`.
  - هر دو تابع `set lock_timeout = '3s'` دارند. اگر قفل در ۳ ثانیه گرفته نشود، کل تابع شکست می‌خورد، هیچ چیز تغییر نمی‌کند و صف Jobها پشت آن نمی‌ماند. در این حالت تابع را دوباره اجرا کن.
- سنجش وضع مانع (فقط خواندن):
  - `select tgenabled from pg_trigger where tgrelid = 'plt.job'::regclass and tgname = 'job_claim_barrier';` ⇒ `D` یعنی خاموش و `O` یعنی روشن.
  - `select generation, allowed_builds, changed_at from plt.job_lease_generation;`

## ۱. پیش‌شرط‌ها

همهٔ این‌ها باید با شاهد برقرار باشند. اگر هر کدام نامعلوم است، **فعال نکن**.

1. migration ‏P11-09 ‏(20261112120000) و migration این کارت (20261112130000) روی production اعمال شده‌اند (بند ۷ (ب)).
2. کد P11-01 و P11-02 و کد این کارت روی production مستقر است و ستون‌ها را پر می‌کند: پس از استقرار، `lease_generation` و `lease_build` در claimهای تازه پر است.
   - سنجش: `select lease_generation, lease_build from plt.job where state = 'running' or finished_at > now() - interval '1 hour' order by updated_at desc limit 20;`
   - مانع هنوز خاموش است، پس ستون‌ها پس از پایان Job پاک نمی‌شوند.
3. «ورودی مالک» ‏(AC-8) موجود است:
   - (الف) مستند رسمی سکوی استقرار برای سه مورد Not Verified ‏C11-10:
     - پایان اجرا در بیشینهٔ زمان تابع، از جمله کار پس از پاسخ (`after()`)؛
     - اینکه Cron فقط استقرار production جاری را صدا می‌زند؛
     - ادامهٔ invocationهای در جریان پس از promote.
   - (ب) لاگ runtime به تفکیک deployment پس از یک promote: رویدادهای claim و `job_lease_lost` از deployment قدیم.
   - جای ثبت: یادداشت cutover مالک. Implementer هیچ‌کدام را اجرا یا جعل نکرده است.
4. `VERCEL_GIT_COMMIT_SHA` در runtime استقرار production در دسترس است. شاهد: پس از استقرار، ستون `lease_build` در claimهای تازه برابر commit همان استقرار است (پرسش ۲ همین بند). Not Verified: اینکه تنظیم پروژه برای در دسترس گذاشتن متغیرهای سیستمی روشن است.

## ۲. ترتیب cutover

1. استقرار build تازه، که commit پس از ادغام این کارت است (بند ۷ (ز)).
2. انتظار برای پایان همهٔ اجراهای قدیم. یکی از این دو لازم است:
   - گذشتن بیشینهٔ زمان اجرای نسخهٔ قدیم از لحظهٔ promote: ‏`maxDuration` ‏800 ثانیهٔ runner ‏(`RUNNER_MAX_SECONDS` در `apps/web/src/server/jobs.ts`)، به شرط مستند بند ۱ (الف)؛
   - یا شاهد توقف همهٔ اجراهای قدیم از لاگ runtime به تفکیک deployment.
   - تا پیش از فعال‌سازی، کد پیش از مانع هنوز می‌تواند claim کند. `runJobStep` در 2b158f4 توکن را نمی‌سنجد، پس اثر مرحلهٔ اجرای قدیمِ زنده را فقط همین انتظار می‌بندد، نه trigger.
3. خواندن commit کامل ۴۰ نویسه‌ای استقرار production جاری از داشبورد سکوی استقرار. این همان `current_build` است.
4. فعال‌سازی (نقش مالک جداول، مثلاً `postgres` در SQL editor؛ هرگز `anon`، `authenticated` یا `recalino_app`):

   ```sql
   select plt.activate_job_claim_barrier(array['<commit جاری>']::text[], '<commit جاری>');
   ```

   - اگر buildهای پس از مانع دیگری هم باید claim کنند، آن‌ها را هم در آرایه بیاور. هر build در آرایه باید پس از مانع ساخته شده باشد.
   - نتیجه نسل تازه است. سپس وضع را با دو query بخش «سازوکار» بسنج: ‏`tgenabled = 'O'`.
5. سنجش پس از فعال‌سازی:
   - در لاگ، یک claim موفق از استقرار جاری (مثلاً `job_succeeded`) و نبود خطای `job claim refused by the claim barrier` از آن استقرار؛
   - `select lease_generation, lease_build from plt.job where state = 'running';` ⇒ نسل تازه و build جاری.
   - اگر claim استقرار جاری رد شد: یعنی `current_build` نادرست بوده یا `VERCEL_GIT_COMMIT_SHA` در runtime نیست. فعال‌سازی را با آرایهٔ درست تکرار کن، یا بند ۴ (بازگشت) را اجرا کن.

پیامد فعال‌سازی: توکن همهٔ Jobهای running می‌چرخد و نسلشان کهنه می‌شود. پس این Jobها اختیار خود را از دست می‌دهند، تا پایان lease می‌مانند، sweep آن‌ها را برمی‌گرداند و با claim تازه ادامه می‌یابند. هر کدام یک attempt مصرف می‌کند.

## ۳. Instant Rollback

- **بازگشت به build پیش از مانع** (مثلاً 2b158f4 یا هر build پیش از ادغام این کارت): fail-closed است. claim آن build نه نسل می‌نویسد نه build، پس رد می‌شود و هیچ Jobی اجرا نمی‌شود. اگر واقعاً باید با آن build کار کرد، اول بند ۴ (غیرفعال‌سازی) لازم است، با همهٔ پیامدهایش.
- **بازگشت به build پس از مانع** که در `allowed_builds` نیست: پیش از هر چیز، و پیش از promote، ردیف build مجاز را به‌روز کن:

  ```sql
  select plt.activate_job_claim_barrier(array['<commit بازگشت>']::text[], '<commit بازگشت>');
  ```

  - commit بازگشت باید پس از ادغام این کارت ساخته شده باشد. اگر build فعلی هم باید تا پایان اجراهایش claim کند، آن را هم در آرایه بیاور.
  - چون مجموعه عوض شده، نسل بالا می‌رود و توکن‌ها می‌چرخند، پس اجراهای در جریان build فعلی اختیار خود را از دست می‌دهند.
  - سپس promote. پس از آن، یک claim موفق از استقرار بازگشت را در لاگ ببین.
- **بازگشت به buildی که در `allowed_builds` هست**: کاری جز promote لازم نیست.

## ۴. بازگشت از مانع (غیرفعال‌سازی)

```sql
select plt.deactivate_job_claim_barrier();
```

- فقط مالک و با نقشی جز `public`، `anon`، `authenticated` (و نه `recalino_app`) اجرا می‌کند. تابع فعال‌سازی هم همین قید را دارد.
- پیامد: trigger خاموش می‌شود و claimها دیگر سنجیده نمی‌شوند. کد پیش از مانع دوباره می‌تواند claim کند، و کد پس از مانع با build دلخواه یا NULL. هیچ داده‌ای حذف نمی‌شود. نسل و `allowed_builds` همان می‌مانند.
- فعال‌سازی دوباره پس از آن، نسل را دوباره بالا می‌برد و توکن‌ها را دوباره می‌چرخاند.
- **خالی کردن `allowed_builds` مانع را خاموش نمی‌کند.** همهٔ claimها را می‌بندد (fail-closed). خاموش کردن فقط با همین تابع است.
- برای حذف کامل migration، یادداشت down درون فایل migration را ببین. فقط پس از غیرفعال‌سازی.

## ۵. منع افزایش payloadVersion

بالا بردن `version` تعریف هیچ kind شناخته‌شده‌ای مجاز نیست تا دو شرط برقرار شود: مانع فعال شده باشد (بند ۲) و کد requeue (این کارت) در **همهٔ** buildهای `allowed_builds` مستقر باشد (ADR-0004 بند 3).

- runner پس از این کارت Job نسخهٔ بالاتر را به صف برمی‌گرداند: attempt پس داده می‌شود و `run_at` دست‌کم 60 ثانیه به تعویق می‌افتد (`requeueJob` در `packages/core/src/plt/jobs.ts`).
- runner پیش از این کارت همان Job را terminal fail می‌کند و `job_tampered` ثبت می‌کند.
- kind ناشناخته اصلاً برداشت نمی‌شود.
- این کارت version هیچ kindی را بالا نمی‌برد.

## ۶. اعمال migration و فعال‌سازی: فقط مالک

اعمال migration روی production و فعال‌سازی مانع کلاس ۲‌اند (E291 قید ۵). فقط در پنجرهٔ cutover و به دست مالک انجام می‌شوند، و فقط پس از سبز شدن CI ‏(`pnpm test:int` با migration از صفر) روی همان commit هدف.

## ۷. فاصلهٔ انتشار از آخرین استقرار production ‏(2b158f4)

**(الف) پیش‌شرط schema guard.** پیش از هر گام، فیلد `schema` در `/api/health?deep=1` روی build جاری نباید `unknown` باشد. `unknown` یعنی guard باز است (F-4). اگر `unknown` است، متوقف شو و علت را بیاب.

**(ب) اعمال migrationهای معوق.** فقط مالک، و فقط با ابزار اعمال مخزن: ابتدا `pnpm db:apply` (dry run)، سپس `pnpm db:apply --apply`.

- ابزار همهٔ migrationهای معوق را یک‌جا و فقط از `origin/main` اعمال می‌کند (`tools/db-apply/apply.ts:59-68`). پس `main` در لحظهٔ اعمال باید همان commit هدف باشد.
- هر migration به ترتیب نسخه، در **یک تراکنش جدا** همراه ردیف history خودش اعمال می‌شود، با `lock_timeout = 5s` ابزار. migration این کارت درون خودش آن را به ‏3s کم می‌کند (`tools/db-apply/plan.ts:207-221`).
- پس از هر کدام history دوباره خوانده و سنجیده می‌شود. شکست یکی ابزار را متوقف می‌کند (`apply.ts:102-107`). migrationهای پیشین اعمال‌شده می‌مانند و آن یکی کامل برمی‌گردد (Observed by model از همین کد).
- پس از اعمال، history باید هر چهار نسخه را داشته باشد:
  - `20261104130000_proc_failed_run_finished_at_index.sql`
  - `20261104130100_plt_drop_acc_user_foreign_keys.sql`
  - `20261112120000_plt_job_lease_generation.sql`
  - `20261112130000_plt_job_claim_barrier.sql` (مانع هنگام اعمال غیرفعال است)
- سنجش: `pnpm db:apply` (dry run) باید `0 pending` بگوید، یا: `select version from supabase_migrations.schema_migrations where version in ('20261104130000','20261104130100','20261112120000','20261112130000');` ⇒ چهار ردیف.
- اگر اعمال ناقص ماند (مثلاً migration چهارم با `lock_timeout` شکست خورد)، history را بسنج و `pnpm db:apply --apply` را تکرار کن. ابزار فقط باقی‌مانده‌ها را اعمال می‌کند.
- تا هر چهار نسخه در history نیست، promote نکن.
- migrationهای اعمال‌شده با build قدیم سازگارند و مانع غیرفعال است (E319‑R).
- یافتهٔ data-loss برای این چهار انتظار نمی‌رود. اگر ابزار یافته‌ای گزارش کرد، متوقف شو.

**(ج) سنجش حذف دو FK.** پس از اعمال:

```sql
select conname from pg_constraint
where conname in ('notification_user_id_fkey', 'push_subscription_user_id_fkey');
```

باید صفر ردیف بدهد. اگر نام قید در production فرق کند، migration ‏20261104130100 بی‌صدا کاری نمی‌کند (F-2). در این صورت پیش از promote متوقف شو و با مالک تصمیم بگیر.

**(د) برگشت‌ناپذیری.** migration ‏20261112120000 پس از استقرار کد P11-01 برگشت‌پذیر نیست (F-3)، چون هر claim ستون نسل و ردیف singleton را لازم دارد. migration این کارت تا وقتی مانع خاموش است برگشت‌پذیر است (یادداشت down درون فایل).

**(هـ) env.** هیچ کلید تازه‌ای برای production لازم نیست (F-6). شناسهٔ build این کارت از `VERCEL_GIT_COMMIT_SHA` می‌آید. این متغیر سیستمی سکوی استقرار است، نه کلیدی که مالک بسازد. Not Verified: روشن بودن تنظیم «در دسترس گذاشتن متغیرهای سیستمی» در پروژه. شاهد عملی، بند ۱ پرسش ۴ است. بی آن، مانع فعال همهٔ claimهای استقرار را رد می‌کند.

**(و) build پیش‌نمایش.** پیش از promote، یک build پیش‌نمایش از همان commit هدف ساخته و سنجیده شود، چون patch ‏ffmpeg-static روی سکوی استقرار هرگز ساخته نشده است (F-7).

**(ز) هدف promote.** commitی پس از ادغام همین کارت. کد پیش از آن ستون build را پر نمی‌کند (F-10) و پس از فعال‌سازی هیچ claimی نمی‌تواند.

**(ح) سنجش‌های پس از استقرار:**

- schema guard در وضع `behind` نیست؛
- یک claim موفق از استقرار تازه در لاگ؛
- اجرای `plt.count_account_orphans`؛
- هشدار احتمالی `failed_runs` در health؛
- ffmpeg کار می‌کند (F-9)؛
- CI سبز روی همان commit.

**(ط) تقدم.** این runbook برای این cutover بر `docs/plans/RELEASE_RUNBOOK_2026-10-12.md` مقدم است. آن سند «ادغام = استقرار» و `db push` بلافاصله پس از ادغام را فرض می‌کند (F-8)، که اینجا برقرار نیست: استقرار خودکار تا پس از cutover خاموش است (E304).

## ۸. holdهای بازمانده (AC-16؛ قید ۳ پاسخ مالک به E351)

هر چه در این بند هست Observed by model از کد base ‏(b1d0b98) است، مگر جایی که برچسب دیگری دارد. هیچ hold یا دادهٔ production خوانده نشد.

**کدام holdها باز می‌مانند.**

- **لغو run و حذف جلسه در میانهٔ فراخوان پولی:** پس از fencing ‏P11-02، commit نتیجهٔ provider رد می‌شود، ردیف `quota.provider_cost` ساخته نمی‌شود، attempt در `started` می‌ماند و hold باز می‌ماند (ADR-0004 بند 5؛ E351 = الف).
  - hold فقط در `finishProviderStep` بسته می‌شود (`packages/core/src/quota/costs.ts:298-302`).
  - `quota.cost_hold.session_id` هیچ FKی ندارد (`supabase/migrations/20261004042259_quota_cost_controls.sql:20`)، پس حذف جلسه hold را پاک نمی‌کند.
  - در `packages/core/src/priv` و `packages/core/src/org` هیچ ارجاعی به `quota` نیست.
  - reconcile این hold را نمی‌بندد (C11-9).
- **حذف حساب در میانهٔ فراخوان پولی** (سنجش دوبارهٔ AC-28 ‏P11-02 روی base): درخواست حذف حساب run و Job را لغو می‌کند، commit نتیجه رد می‌شود، attempt در `started` و hold باز می‌ماند (`packages/core/src/priv/media.int.test.ts:781-830`، به‌ویژه :823-830).
  - ردیف hold فقط وقتی پاک می‌شود که ردیف `acc.user_account` حذف شود (`on delete cascade`، `20261004042259_quota_cost_controls.sql:19`؛ و reservation در `20261004042259_quota_cost_controls.sql:24` و `20261004041529_quota_ledger.sql:20`).
  - Not Verified: اینکه حذف سخت ردیف حساب کی و آیا رخ می‌دهد.

**در کدام سقف‌ها و با چه مبلغی.**

- هر hold باز با `maximum_micros` خودش، یعنی بیشینه، شمرده می‌شود (`costs.ts:107-110`). شمارش در `spendTotals` است (`costs.ts:93-101`):
  - **session:** در سقف جلسهٔ خودش، بی هیچ مرز زمانی (`costs.ts:95`).
  - **ماه کاربر:** فقط holdهای همان کاربر که از آغاز ماه UTC جاری ساخته شده‌اند (`costs.ts:96-99`).
  - **روز سیستم:** فقط holdهایی که از آغاز روز UTC جاری ساخته شده‌اند (`costs.ts:100`). پس hold باز پس از نیمه‌شب UTC از سقف روز بیرون می‌رود.
  - **ماه سیستم:** فقط holdهای ساخته‌شده از آغاز ماه UTC جاری (`costs.ts:101`). پس با آغاز ماه بعد از هر دو سقف ماه بیرون می‌رود.
  - سقف دیگری در این بررسی نیست. `killSwitch` همهٔ holdهای تازه را می‌بندد (`costs.ts:149`).
- hold تازه وقتی رد می‌شود که `جمع + بیشینهٔ فراخوان > سقف` (`costs.ts:168-171`).

**مقدار سقف‌ها.**

- چهار سقف `session`، `userMonth`، `systemDay` و `systemMonth` (micros) در ردیف پایگاه دادهٔ `quota.cost_policy` هستند (`costs.ts:8-18`، خواندن `:136-149`). کد مقدار پیش‌فرضی ندارد و بی ردیف، هر فراخوان با `cost_policy_missing` رد می‌شود (`costs.ts:142`).
- این مقادیر با `cost.configure` اپراتور (`packages/core/src/ops/operator.ts:130-136`) یا مسیر ادمین (`apps/web/src/server/admin-routes.ts:243`) تنظیم می‌شوند.
- **مقدار production: با مالک.**

**بیشینهٔ hold یک فراخوان.** `modelMaximumMicros[model] ?? maximumMicros` از تنظیمات provider، و هرگز بیش از `maximumMicros` (`packages/core/src/aip/contracts.ts:99-104`). منبع آن env ‏`OPENROUTER_SETTINGS_JSON` است (`apps/web/src/server/ai.ts:12`). **مقدار production: با مالک.**

**شمار لغو پیاپی تا پر شدن سقف.** فرض: `M` بیشینهٔ hold یک فراخوان است و هر لغو در میانهٔ یک فراخوان پولی یک hold باز با `M` می‌گذارد، بی هزینهٔ دیگر.

- **ماه کاربر:** پس از `floor(userMonth / M)` لغو در یک ماه UTC، فراخوان تازهٔ همان کاربر رد می‌شود.
- **جلسه:** پس از `floor(session / M)` لغو در یک جلسه، آن جلسه بسته می‌شود.
- **روز سیستم:** پس از `floor(systemDay / M)` لغو در یک روز UTC، از همهٔ کاربران.
- **ماه سیستم:** پس از `floor(systemMonth / M)` لغو در یک ماه.
- یک کاربر به‌تنهایی فقط وقتی سقف روز یا ماه سیستم را پر می‌کند که سقف خودش بزرگ‌تر باشد:
  - اگر `userMonth < systemDay`، سقف ماه خود کاربر زودتر پر می‌شود و او به‌تنهایی سقف روز سیستم را پر نمی‌کند.
  - اگر `userMonth < systemMonth`، سقف ماه سیستم را هم به‌تنهایی پر نمی‌کند.
- عددها تا مقادیر production روشن نشده‌اند، با مالک.

**راه دیدن و بستن دستی.**

- **دیدن (فقط جمع):**
  - صفحهٔ هزینهٔ ادمین `reservedMicros` (جمع holdهای باز) و شمار attemptهای `started` و `uncertain` را نشان می‌دهد (`packages/core/src/ops/admin-read.ts:495-518`).
  - فرمان `stats` اپراتور شمار و جمع holdهای باز را به تفکیک ارز می‌دهد (`packages/core/src/quota/operations.ts:26-35` و `:59-63`؛ `packages/core/src/ops/operator.ts:142-163`).
  - فهرست تک‌به‌تک holdها در هیچ ابزاری نیست.
- **بستن: هیچ.** هیچ فرمان، کار ادمین یا Jobی hold باز را نمی‌بندد، جز `finishProviderStep` در مسیر عادی provider.
- **پرسش مالک پیش از cutover لازم است:** آیا این holdها تا بازیابی دستهٔ ۱۲ باز بمانند، یا راه بستن دستی (و با کدام ثبت هزینه) پیش از cutover لازم است؟ تا پاسخ، تنها ترمز اضطراری موجود `killSwitch` در `cost.configure` است.
