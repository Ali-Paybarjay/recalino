# Runbook: مانع استقرار روی claim ‏(ADR-0004 بند 3، گام 3؛ P11-08)

این runbook برای cutover مانع lease و کل فاصلهٔ انتشار از آخرین استقرار production ‏(2b158f4) است. هر کنش این سند کلاس ۲ است و فقط مالک آن را اجرا می‌کند. هیچ کد، migration یا Job خودکاری تابع فعال‌سازی یا غیرفعال‌سازی را صدا نمی‌زند.

**قاعدهٔ ارجاع‌ها (AC-28؛ R2-P1108-06).** هر ارجاع `path:line` commit خود را دارد، تکی یا با برچسب گروهی:

- کدی که همین PR (P11-08) می‌افزاید یا تغییر می‌دهد، روی head ‏`2043a1d` است: migration ‏`20261112130000_plt_job_claim_barrier.sql`، `packages/core/src/plt/jobs.ts` و `apps/web/src/server/jobs.ts` در خط‌هایی که این PR افزوده یا تغییر داده است.
- کدی که پیش از این PR روی main بوده، روی main ‏`fe526ba` است. میان `fe526ba` و main ‏`54122a8` (تازه‌سازی این دور) فقط فایل کارت عوض شده است، پس همان خط‌ها در `54122a8` هم هست.
- شماره‌خط فایلی که این PR در آن خط افزوده، روی دو commit فرق می‌کند. پس برچسب commit را از شماره‌خط جدا نکن.

برای این cutover، این سند بر `docs/plans/RELEASE_RUNBOOK_2026-10-12.md` مقدم است (بند ۷ (ط)). Instant Rollback عادی هم در همان سند است و اینجا فقط گام‌های افزودهٔ مانع می‌آید (بند ۳).

## سازوکار، به‌کوتاهی

- migration ‏`supabase/migrations/20261112130000_plt_job_claim_barrier.sql` یک trigger به نام `job_claim_barrier` روی `plt.job` می‌سازد که **غیرفعال** ساخته می‌شود. روشن یا خاموش بودن مانع همان وضع این trigger است. ستون یا جدول تازه‌ای ساخته نمی‌شود.
- وقتی مانع فعال است، هر claim (ردیفی که به `running` می‌رود) فقط وقتی پذیرفته می‌شود که در `lease_generation` نسل کنونی ردیف `plt.job_lease_generation` و در `lease_build` یکی از `allowed_builds` را نوشته باشد. در غیر این صورت کل دستور claim با خطای `job claim refused by the claim barrier` رد می‌شود.
  - ستون NULL رد می‌شود.
  - `allowed_builds` تهی یا NULL یعنی هیچ build مجاز نیست و **همهٔ** claimها رد می‌شوند (fail-closed). یادداشت «NULL or empty: no build restriction» در migration ‏20261112120000 فقط وضع پیش از فعال‌سازی است.
  - هر نوشتنی که Job را از `running` بیرون ببرد (complete، fail، sweep، cancel، requeue) هر دو ستون را پاک می‌کند. پس مقدار claim قبلی به claimی که خودش آن را ننویسد اختیار نمی‌دهد.
- شناسهٔ build ‏(AC-3): runner در هر claim مقدار `VERCEL_GIT_COMMIT_SHA` را ثبت می‌کند (`runnerBuild`، `apps/web/src/server/jobs.ts:97-112` و `:238`، `:267`، روی head ‏`2043a1d`). این همان commit کامل ۴۰ نویسه‌ای است که استقرار از آن ساخته شده. اگر خالی باشد یا شکل SHA کامل نداشته باشد، claim مقدار NULL می‌نویسد و مانع فعال آن را رد می‌کند.
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

## آنچه با خود استقرار عوض می‌شود، پیش از فعال‌سازی

(AC-7؛ قید ۱ پاسخ مالک به E410.) همهٔ ارجاع‌های این بخش کد افزوده یا تغییرداده‌شدهٔ همین PR است، پس روی head ‏`2043a1d` است: migration ‏`20261112130000_plt_job_claim_barrier.sql` و `packages/core/src/plt/jobs.ts` (`jobs.ts` در این بخش همین فایل است). Observed by model.

**خود قید پایگاه داده، تا مانع خاموش است، هیچ اثری ندارد.** trigger ‏`job_claim_barrier` خاموش ساخته می‌شود (`supabase/migrations/20261112130000_plt_job_claim_barrier.sql:161-174`) و تا فعال‌سازی هیچ نوشتنی را رد یا تغییر نمی‌دهد. آزمون B01 همین را نشان می‌دهد. پس استقرار مانع به مانع نیاز ندارد.

این سه تغییر رفتار runner با خود ادغام و استقرار کد اثر می‌کنند، نه با فعال‌سازی. مالک آن‌ها را پیش از استقرار دانسته می‌پذیرد:

1. **kind بی تعریف claim نمی‌شود.** `runDueJobs` فقط kindهایی را claim می‌کند که در همان runner تعریف دارند (`packages/core/src/plt/jobs.ts:678-679`). Job با kind ناشناخته در صف می‌ماند. هیچ رویداد لاگ، شمارنده یا ستونی آن را نشان نمی‌دهد. پیش از این کارت چنین Jobی terminal fail می‌شد و `job_tampered` ثبت می‌کرد.
2. **Job با payloadVersion بالاتر به صف برمی‌گردد.** اگر payloadVersion از `version` تعریف همان kind بالاتر باشد، Job به‌جای `payload_invalid` و `job_tampered` به صف برمی‌گردد (`jobs.ts:693-699`):
   - attempt پس داده می‌شود (`jobs.ts:415`)؛
   - `run_at` دست‌کم 60 ثانیه پس از ساعت پایگاه داده می‌رود (`jobs.ts:398`، `:416-417`)؛
   - `last_error = 'payload_version_newer'` (`jobs.ts:418`) و رویداد لاگ `job_requeued` با `code: payload_version_newer` (`jobs.ts:696`).
   - **این requeue سقف شمار ندارد**، چون attempt پس داده می‌شود و `max_attempts` هرگز پر نمی‌شود. **رویداد امنیتی هم ثبت نمی‌کند** (C11-51؛ بند ۸).
3. **در مسیر `payload_invalid`، بی اختیار فقط `job_lease_lost` ثبت می‌شود.** اگر `failJob` اختیار نیابد (`null`)، فقط رویداد warn ‏`job_lease_lost` ثبت می‌شود. نه `summary.failed` افزوده می‌شود و نه `job_tampered` (`jobs.ts:701-707`). `job_tampered` فقط پس از fail موفق ثبت می‌شود (`jobs.ts:708`).

وارسی پس از استقرار این تغییرها در بند ۲، گام ۲ است.

## قاعدهٔ مشترک توقف (AC-24 و AC-25)

> ناتوانی سنجش با صفر برابر نیست؛ ادامهٔ Job با ثبت پرسش، شرط عملیاتی را نمی‌بندد؛ تا هر دو شمار به‌طور معتبر صفر نشده‌اند یا مالک دربارهٔ شرط تصمیم صریح تازه‌ای نداده، فعال‌سازی مجاز نیست؛ اگر زمان مجاز یا گام بعدیِ وضع میانی معلوم نیست، تصمیم مالک پیش از عبور از آن نقطه لازم است و حد زمانی نامحدود فرض نمی‌شود.

این قاعده نقطهٔ توقف است. «blocked نیست» در گزارش Job فقط یعنی کار گزارشی Job ادامه یافت. اجازهٔ فعال‌سازی یا cutover نیست.

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
5. **تصمیم صریح مالک دربارهٔ C11-34 و C11-35** (AC-17؛ R2-P1108-03؛ قید ۳ ‏E348). این دو ردیف «باز» جدول پذیرش Recalino ADR-0004 ‏0.7 هستند (`docs/adr/0004-job-lease-fencing.md:207-208`، روی main ‏`fe526ba`). تصمیم با ارجاع ثبت‌پذیر (شمارهٔ تصمیم) در یادداشت cutover می‌آید.
   - **نقطهٔ توقف:** تا این تصمیم نامعلوم است، فعال نکن.
   - این پیش‌شرط اصلاح هیچ‌یک را الزام نمی‌کند. نوع تصمیم با مالک است.
6. **محیط Preview بی متغیرهای production** (AC-29؛ تصمیم مالک؛ E424‑R؛ C11-54). پیش از استقرار و فعال‌سازی، مالک به دست خودش تأیید و در یادداشت cutover ثبت می‌کند که محیط Preview سکوی استقرار هیچ‌یک از این پنج متغیر را ندارد: `DATABASE_URL`، `SUPABASE_URL`، `SUPABASE_SECRET_KEY`، `SUPABASE_PUBLISHABLE_KEY` و `CRON_SECRET`.
   - **نقطهٔ توقف:** تا این تأیید ثبت نشده، فعال نکن. استقرار برای cutover (بند ۲، گام ۱) هم پیش از این ثبت آغاز نمی‌شود.
   - دلیل: شناسهٔ build همان commit است و مانع، استقرار پیش‌نمایشِ همان commit را از production تمیز نمی‌دهد (حد C11-54).
   - ثبت فقط نام هر متغیر و نبودنش در Preview است، هرگز مقدار.
   - این کنش مالک است (کلاس ۲). Job آن را اجرا نمی‌کند و هیچ محیطی را نمی‌خواند. C11-54 تا ثبت این تأیید باز می‌ماند.
7. وارسی پس از استقرار (بند ۲، گام ۲) هر دو شمار را به‌طور معتبر صفر نشان داده است، یا مالک دربارهٔ آن شرط تصمیم صریح تازه داده است (قاعدهٔ مشترک توقف).
8. فعال‌سازی در حد زمانی وضع میانی است که مالک پیش از استقرار تعیین کرده (بند ۲، «فعال‌سازی عقب‌افتاده»).

## ۲. ترتیب cutover

1. استقرار build تازه، که commit پس از ادغام این کارت است (بند ۷ (ز)). پیش از آن پیش‌شرط ۶ بند ۱ (محیط Preview) ثبت شده باشد. زمان promote را یادداشت کن. حد زمانی وضع میانی از همین لحظه شمرده می‌شود («فعال‌سازی عقب‌افتاده» در پایین).
2. **وارسی پس از استقرار** (AC-24؛ قید ۲ پاسخ مالک به E410). فقط خواندن است، با نقش مالک در SQL editor، پس از دست‌کم یک دور runner از استقرار تازه. هر دو شمار باید صفر باشند. در این گام، `packages/core/src/plt/jobs.ts` (و `jobs.ts`) روی head ‏`2043a1d` است، چون همهٔ خط‌های ارجاع‌شدهٔ آن را این PR افزوده یا تغییر داده است؛ `apps/web/src/server/jobs.ts` روی main ‏`fe526ba` است.
   - **(الف) Jobهای صف با kind بی تعریف.** این شمار بی کد تازه به‌طور معتبر ممکن نیست:
     - فهرست kindهای تعریف‌شدهٔ runner در زمان اجرا و وابسته به env ساخته می‌شود (`apps/web/src/server/jobs.ts:119-160`، main ‏`fe526ba`). مثلاً kindهای storage و voice فقط با object store (`:124-126`، main ‏`fe526ba`) و kindهای processing، voice، lessonReview و media فقط با تنظیمات خودشان (`:143-156`، main ‏`fe526ba`).
     - فیلتر kind ناشناخته بی‌صداست (`packages/core/src/plt/jobs.ts:679`، head ‏`2043a1d`): نه رویداد لاگ، نه ستون.
     - هیچ ابزار مخزن فهرست kindهای استقرار production را چاپ نمی‌کند.
     - آنچه بی کد تازه ممکن است، فقط فهرست kindهای منتظر است تا مالک آن را با kindهای شناخته‌شده بسنجد:

       ```sql
       select kind, payload_version, state, count(*) as jobs, min(run_at) as oldest_run_at
       from plt.job
       where state in ('queued', 'retry_scheduled')
       group by kind, payload_version, state
       order by kind;
       ```

     - نشانه، نه اثبات: kindی که `oldest_run_at` آن چند دور runner گذشته و هنوز منتظر است. صف عقب‌افتاده هم همین را نشان می‌دهد. Not Verified.
     - تا مالک فهرست kindهای استقرار را از منبع معتبر ندارد یا دربارهٔ این شرط تصمیم صریح نداده، این شمار «نامعلوم» است، نه صفر (قاعدهٔ مشترک توقف). پرسش مالک: پرسش ۷ در «پرسش‌های باز مالک».
   - **(ب) Jobهایی که برای payloadVersion بالاتر به صف برمی‌گردند.** requeue ‏`last_error = 'payload_version_newer'` می‌نویسد و Job را `queued` یا `retry_scheduled` می‌کند (`packages/core/src/plt/jobs.ts:414`، `:418`، head ‏`2043a1d`). claim بعدی `last_error` را پاک نمی‌کند (`jobs.ts:280-285`، head ‏`2043a1d`؛ دستور claimی که این PR در `:283` تغییر داده است).

     ```sql
     select kind, payload_version, state, count(*) as jobs
     from plt.job
     where last_error = 'payload_version_newer' and state in ('queued', 'retry_scheduled')
     group by kind, payload_version, state;
     ```

     - همراه آن: نبود رویداد `job_requeued` با `code: payload_version_newer` در لاگ runtime استقرار تازه (`jobs.ts:696`، head ‏`2043a1d`).
     - حد: Jobی که هنوز موعدش نرسیده و runner آن را برنداشته، شمرده نمی‌شود. سنجش آن مقایسهٔ `payload_version` با `version` تعریف هر kind در کد است و همان حد (الف) را دارد. پس این شمار فقط برای Jobهای رسیده معتبر است. پرسش مالک: پرسش ۸.
   - **اگر شمار (الف) صفر نبود:**
     1. فعال نکن.
     2. kind، `payload_version`، شمار و `oldest_run_at` را در یادداشت cutover ثبت کن، بی شناسهٔ کاربر.
     3. منشأ را بیاب: kind از build تازه‌تری است (مثلاً build پیش‌نمایشی که به پایگاه دادهٔ production نوشته)، یا kind کنارگذاشته‌شده است.
     4. هیچ ردیفی را حذف یا تغییر نده. این runbook راه لغو گروهی Job ندارد.
     5. تصمیم با مالک است: صبر تا استقرار buildی که آن kind را تعریف می‌کند (که آن‌گاه باید در `allowed_builds` باشد)، یا تصمیم دیگر. تا تصمیم، فعال‌سازی مجاز نیست.
   - **اگر شمار (ب) صفر نبود:**
     1. فعال نکن. این یعنی buildی با `version` بالاتر Job نوشته است، که بند ۵ آن را منع می‌کند.
     2. kind، `payload_version` و شمار را ثبت کن و build نویسنده را بیاب.
     3. هیچ ردیفی را تغییر نده. این Jobها هر دست‌کم 60 ثانیه، بی سقف شمار، دوباره برداشته و برگردانده می‌شوند (`jobs.ts:398`، `:416-417`، head ‏`2043a1d`). اثرشان لاگ و بار است، نه مصرف attempt.
     4. تصمیم با مالک است. تا تصمیم، فعال‌سازی مجاز نیست.
3. انتظار برای پایان همهٔ اجراهای قدیم. یکی از این دو لازم است:
   - گذشتن بیشینهٔ زمان اجرای نسخهٔ قدیم از لحظهٔ promote: ‏`maxDuration` ‏800 ثانیهٔ runner ‏(`RUNNER_MAX_SECONDS`، `apps/web/src/server/jobs.ts:53`، main ‏`fe526ba`)، به شرط مستند بند ۱ (الف)؛
   - یا شاهد توقف همهٔ اجراهای قدیم از لاگ runtime به تفکیک deployment.
   - تا پیش از فعال‌سازی، کد پیش از مانع هنوز می‌تواند claim کند.
   - **حد B13 (AC-22 (ج)):** مانع پایگاه داده اثر یک invocation کهنهٔ در جریان را نمی‌گیرد، چون `runJobStep` در 2b158f4 توکن را نمی‌سنجد و فقط `cancelled` را می‌بیند (`git show 2b158f4:packages/core/src/plt/jobs.ts`، خط‌های 325-350). trigger فقط claim تازه را می‌بندد و چرخش توکن فقط renew، complete و fail آن اجرا را. تنها مانع اثر مرحله‌ای آن، انتظار همین گام است. پس فعال‌سازی به شاهد AC-8 (بند ۱، پیش‌شرط ۳) وابسته است.
4. خواندن commit کامل ۴۰ نویسه‌ای استقرار production جاری از داشبورد سکوی استقرار. این همان `current_build` است.
5. فعال‌سازی (نقش مالک جداول، مثلاً `postgres` در SQL editor؛ هرگز `anon`، `authenticated` یا `recalino_app`). فقط وقتی همهٔ پیش‌شرط‌های بند ۱ برقرارند، از جمله ۵ تا ۸:

   ```sql
   select plt.activate_job_claim_barrier(array['<commit جاری>']::text[], '<commit جاری>');
   ```

   - اگر buildهای پس از مانع دیگری هم باید claim کنند، آن‌ها را هم در آرایه بیاور. هر build در آرایه باید پس از مانع ساخته شده باشد.
   - نتیجه نسل تازه است. سپس وضع را با دو query بخش «سازوکار» بسنج: ‏`tgenabled = 'O'`.
6. سنجش پس از فعال‌سازی:
   - در لاگ، یک claim موفق از استقرار جاری (مثلاً `job_succeeded`) و نبود خطای `job claim refused by the claim barrier` از آن استقرار؛
   - `select lease_generation, lease_build from plt.job where state = 'running';` ⇒ نسل تازه و build جاری.
   - اگر claim استقرار جاری رد شد: یعنی `current_build` نادرست بوده یا `VERCEL_GIT_COMMIT_SHA` در runtime نیست. فعال‌سازی را با آرایهٔ درست تکرار کن، یا بند ۴ (بازگشت) را اجرا کن.

پیامد فعال‌سازی: توکن همهٔ Jobهای running می‌چرخد و نسلشان کهنه می‌شود. پس این Jobها اختیار خود را از دست می‌دهند، تا پایان lease می‌مانند، sweep آن‌ها را برمی‌گرداند و با claim تازه ادامه می‌یابند. هر کدام یک attempt مصرف می‌کند.

### فعال‌سازی عقب‌افتاده (AC-25؛ قید ۳ پاسخ مالک به E410)

وضع میانی یعنی کد این کارت مستقر است و مانع خاموش است. در این وضع:

- سه تغییر بخش «آنچه با خود استقرار عوض می‌شود» برقرارند.
- مانع هیچ claimی را نمی‌بندد. promote یا Instant Rollback به build پیش از مانع بی هیچ ردی دوباره claim می‌کند (B01، B10).
- حفاظت ADR-0004 بند 3 در برابر اجراکنندهٔ قدیم هنوز برقرار نیست.

**این وضع تا کی پذیرفتنی است: با مالک.** نه کد و نه ADR-0004 حد زمانی برای آن نمی‌دهد. بند 3 ‏ADR-0004 فقط شرط‌های فعال‌سازی را می‌گوید (`docs/adr/0004-job-lease-fencing.md:76-103`، main ‏`fe526ba`) و در کد هیچ مهلت یا هشداری برای مانع خاموش نیست (Observed by model روی head ‏`2043a1d`: بیرون از آزمون‌ها و docs، نام مانع فقط در migration ‏20261112130000 و در توضیح `apps/web/src/server/jobs.ts:104` و `packages/core/src/plt/jobs.ts:234` آمده است). پرسش مالک: پرسش ۹.

**نقطهٔ توقف:**

1. پیش از استقرار (گام ۱)، مالک حد زمانی وضع میانی و گام پس از گذشتن آن را تعیین و در یادداشت cutover ثبت می‌کند.
2. تا این حد ثبت نشده، استقرار برای cutover آغاز نمی‌شود. حد نامحدود فرض نمی‌شود (قاعدهٔ مشترک توقف).
3. اگر حد گذشت و فعال‌سازی هنوز ممکن نیست (مثلاً شاهد AC-8 یا وارسی گام ۲ نامعلوم است)، از آن نقطه عبور نکن. وضع را ثبت کن و تصمیم تازهٔ مالک را بگیر.
4. گزینه‌ها با مالک است، از جمله: تمدید صریح با حد تازه، یا Instant Rollback به build پیش از این کارت بر پایهٔ `docs/plans/RELEASE_RUNBOOK_2026-10-12.md`.
5. غیرفعال‌سازی گزینه نیست، چون مانع از پیش خاموش است.

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

- runner پس از این کارت Job نسخهٔ بالاتر را به صف برمی‌گرداند: attempt پس داده می‌شود و `run_at` دست‌کم 60 ثانیه به تعویق می‌افتد (`requeueJob`، `packages/core/src/plt/jobs.ts:397-423`، head ‏`2043a1d`).
- runner پیش از این کارت همان Job را terminal fail می‌کند و `job_tampered` ثبت می‌کند.
- kind ناشناخته اصلاً برداشت نمی‌شود.
- این کارت version هیچ kindی را بالا نمی‌برد.

## ۶. اعمال migration و فعال‌سازی: فقط مالک

اعمال migration روی production و فعال‌سازی مانع کلاس ۲‌اند (E291 قید ۵). فقط در پنجرهٔ cutover و به دست مالک انجام می‌شوند، و فقط پس از سبز شدن CI ‏(`pnpm test:int` با migration از صفر) روی همان commit هدف.

## ۷. فاصلهٔ انتشار از آخرین استقرار production ‏(2b158f4)

**(الف) پیش‌شرط schema guard.** پیش از هر گام، فیلد `schema` در `/api/health?deep=1` روی build جاری نباید `unknown` باشد. `unknown` یعنی guard باز است (F-4). اگر `unknown` است، متوقف شو و علت را بیاب.

**(ب) اعمال migrationهای معوق.** فقط مالک، و فقط با ابزار اعمال مخزن: ابتدا `pnpm db:apply` (dry run)، سپس `pnpm db:apply --apply`.

- ابزار همهٔ migrationهای معوق را یک‌جا و فقط از `origin/main` اعمال می‌کند (`tools/db-apply/apply.ts:59-68`، main ‏`fe526ba`). پس `main` در لحظهٔ اعمال باید همان commit هدف باشد.
- هر migration به ترتیب نسخه، در **یک تراکنش جدا** همراه ردیف history خودش اعمال می‌شود، با `lock_timeout = 5s` ابزار (`tools/db-apply/plan.ts:207-221`، main ‏`fe526ba`). migration این کارت درون خودش آن را به ‏3s کم می‌کند (`supabase/migrations/20261112130000_plt_job_claim_barrier.sql:163`، head ‏`2043a1d`).
- پس از هر کدام history دوباره خوانده و سنجیده می‌شود. شکست یکی ابزار را متوقف می‌کند (`tools/db-apply/apply.ts:102-107`، main ‏`fe526ba`). migrationهای پیشین اعمال‌شده می‌مانند و آن یکی کامل برمی‌گردد (Observed by model از همین کد).
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

**(هـ) env.** هیچ کلید تازه‌ای برای production لازم نیست (F-6). شناسهٔ build این کارت از `VERCEL_GIT_COMMIT_SHA` می‌آید. این متغیر سیستمی سکوی استقرار است، نه کلیدی که مالک بسازد. Not Verified: روشن بودن تنظیم «در دسترس گذاشتن متغیرهای سیستمی» در پروژه. شاهد عملی، بند ۱، پیش‌شرط ۴ است. بی آن، مانع فعال همهٔ claimهای استقرار را رد می‌کند.

**(و) build پیش‌نمایش.** پیش از promote، یک build پیش‌نمایش از همان commit هدف ساخته و سنجیده شود، چون patch ‏ffmpeg-static روی سکوی استقرار هرگز ساخته نشده است (F-7). این build پیش‌نمایش فقط پس از ثبت پیش‌شرط ۶ بند ۱ (محیط Preview) ساخته می‌شود.

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

هر چه در این بند هست Observed by model است، مگر جایی که برچسب دیگری دارد. **همهٔ ارجاع‌های این بند و بندهای ۹ و ۱۰ کد پیش از این PR است و روی main ‏`fe526ba` است**، مگر ارجاعی که برچسب head ‏`2043a1d` دارد. این PR هیچ‌کدام از این فایل‌ها را تغییر نداده است. ارجاع‌هایی که دور پیش روی `b1d0b98` سنجیده شده بودند (migrationهای quota، `packages/core/src/priv/media.int.test.ts`، `packages/core/src/org/sessions.ts`، `packages/core/src/quota/operations.ts`، `packages/ops-cli/src/main.ts`، `apps/web/src/server/ai.ts` و ابزارهای بند ۹) در این دور روی `fe526ba` دوباره سنجیده شدند. هیچ hold یا دادهٔ production خوانده نشد.

> **این پذیرش فقط برای دورهٔ پایلوت است. پیش از باز کردن محصول برای کاربران تازه، C11-36 باید بسته شده باشد.**
>
> C11-51 (requeue Job با payloadVersion بالاتر، بی سقف شمار و بی رویداد امنیتی؛ بخش «آنچه با خود استقرار عوض می‌شود»، تغییر ۲) **باز** است. پیش از باز کردن محصول برای کاربران تازه بسته می‌شود (AC-21؛ قید ۴ پاسخ مالک به E410).

**کدام holdها باز می‌مانند.**

- **لغو run و حذف جلسه در میانهٔ فراخوان پولی:** پس از fencing ‏P11-02، commit نتیجهٔ provider رد می‌شود، ردیف `quota.provider_cost` ساخته نمی‌شود، attempt در `started` می‌ماند و hold باز می‌ماند (ADR-0004 بند 5؛ E351 = الف).
  - hold فقط در `finishProviderStep` بسته می‌شود (`packages/core/src/quota/costs.ts:298-302`).
  - `quota.cost_hold.session_id` هیچ FKی ندارد (`supabase/migrations/20261004042259_quota_cost_controls.sql:20`)، پس حذف جلسه hold را پاک نمی‌کند.
  - در `packages/core/src/priv` و `packages/core/src/org` هیچ ارجاعی به `quota` نیست.
  - reconcile این hold را نمی‌بندد (C11-9).
- **حذف حساب در میانهٔ فراخوان پولی** (سنجش دوبارهٔ AC-28 ‏P11-02 روی main ‏`fe526ba`): درخواست حذف حساب run و Job را لغو می‌کند، commit نتیجه رد می‌شود، attempt در `started` و hold باز می‌ماند (`packages/core/src/priv/media.int.test.ts:781-830`، به‌ویژه :823-830).
  - ردیف hold فقط وقتی پاک می‌شود که ردیف `acc.user_account` حذف شود (`on delete cascade`، `20261004042259_quota_cost_controls.sql:19`؛ و reservation در `20261004042259_quota_cost_controls.sql:24` و `20261004041529_quota_ledger.sql:20`).
  - Not Verified: اینکه حذف سخت ردیف حساب کی و آیا رخ می‌دهد.

**در کدام سقف‌ها و با چه مبلغی.**

- هر hold باز با `maximum_micros` خودش، یعنی بیشینه، شمرده می‌شود (`costs.ts:107-110`: `closed_at is null`، بی فیلتر زمان). شمارش در `spendTotals` است (`costs.ts:78-122`؛ مرز روز و ماه UTC در `:85-86`):
  - **session:** در سقف جلسهٔ خودش، بی هیچ مرز زمانی (`costs.ts:96`).
  - **ماه کاربر:** فقط holdهای همان کاربر که از آغاز ماه UTC جاری ساخته شده‌اند (`costs.ts:97-100`).
  - **روز سیستم:** فقط holdهایی که از آغاز روز UTC جاری ساخته شده‌اند (`costs.ts:101`). پس hold باز پس از نیمه‌شب UTC از سقف روز بیرون می‌رود.
  - **ماه سیستم:** فقط holdهای ساخته‌شده از آغاز ماه UTC جاری (`costs.ts:102`). پس با آغاز ماه بعد از هر دو سقف ماه بیرون می‌رود.
  - سقف دیگری در این بررسی نیست. `killSwitch` همهٔ holdهای تازه را می‌بندد (`costs.ts:149`).
- hold تازه وقتی رد می‌شود که `جمع + بیشینهٔ فراخوان > سقف` (`costs.ts:168-171`، با `scope` همان سقف).

**سقف جلسه: بسته‌ماندن بی مرز زمانی (AC-19).**

- hold باز در سقف جلسه بی مرز زمانی شمرده می‌شود. جمع جلسه همهٔ `provider_cost`های آن جلسه در هر زمان (`costs.ts:106`) و همهٔ holdهای باز آن (`costs.ts:107-110`) را می‌شمارد (`costs.ts:96`).
- رد: `costs.ts:169-171` با `scope: "session"`.
- پیامد: جلسه‌ای که چند بار وسط پردازش لغو شده ممکن است برای همیشه به سقف جلسه برسد و برای هر فراخوان پولی تازه بسته بماند، چون هیچ راهی این holdها را نمی‌بندد (پایین‌تر، «بستن: هیچ»).
- حذف جلسه این holdها را پاک نمی‌کند (`quota.cost_hold.session_id` بی FK؛ بالاتر).
- **راه چارهٔ کاربر:** یک جلسهٔ تازه (`createSession`، `packages/core/src/org/sessions.ts:146-178`). جمع session جلسهٔ تازه فقط هزینه‌ها و holdهای خود آن را می‌شمارد (`costs.ts:96`)، پس holdهای جلسهٔ قبلی آن را نمی‌بندند.
  - holdهای جلسهٔ قبلی همچنان تا پایان ماه UTC در سقف ماه کاربر شمرده می‌شوند (`costs.ts:97-100`).
  - Not Verified: اینکه کاربر می‌تواند همان محتوا را در جلسهٔ تازه دوباره بفرستد بی هزینه یا محدودیت دیگری. جریان محصول سنجیده نشد.
- **کاری که مالک می‌تواند بکند:** فقط بالا بردن سقف `session` برای همهٔ جلسه‌ها، با همان سازوکار اهرم اضطراری بند ۱۰. سیاست هزینه یک سقف session مشترک دارد (`costs.ts:13`) و سقف جداگانه برای یک جلسه نیست.

**مقدار سقف‌ها.**

- چهار سقف `session`، `userMonth`، `systemDay` و `systemMonth` (micros) در ستون jsonb ‏`limits` ردیف singleton ‏`quota.cost_policy` هستند (`costs.ts:8-18`؛ ستون در `supabase/migrations/20261004042259_quota_cost_controls.sql:12`). هر فراخوان آن‌ها را از پایگاه داده می‌خواند (`costs.ts:137-148`).
- کد مقدار پیش‌فرضی ندارد. بی ردیف، هر فراخوان با `cost_policy_missing` رد می‌شود (`costs.ts:142`).
- این مقادیر با `cost.configure` اپراتور (`packages/core/src/ops/operator.ts:66`، `:130-136`) یا مسیر ادمین (`apps/web/src/server/admin-routes.ts:226-256`) تنظیم می‌شوند.
- **مقدار production: با مالک.**

**بیشینهٔ hold یک فراخوان (`M`).** `modelMaximumMicros[model] ?? maximumMicros` از تنظیمات provider، و هرگز بیش از `maximumMicros` (`packages/core/src/aip/contracts.ts:99-104`؛ فیلدها در `:60-63`: هر دو عدد صحیح مثبت). منبع آن env ‏`OPENROUTER_SETTINGS_JSON` است (`apps/web/src/server/ai.ts:12`). پس بزرگ‌ترین `M` ممکن همان `maximumMicros` است و کوچک‌ترین آن کمینهٔ `maximumMicros` و همهٔ مقدارهای `modelMaximumMicros`. **مقدار production: با مالک.**

**خواندن سقف‌ها و `M` (فقط خواندن؛ AC-20).** مالک اجرا می‌کند. هیچ مقدار production در این سند یا گزارش Job نیست.

- چهار سقف، با نقش مالک در SQL editor:

  ```sql
  select version, currency, kill_switch,
    (limits->>'session')::bigint     as session_micros,
    (limits->>'userMonth')::bigint   as user_month_micros,
    (limits->>'systemDay')::bigint   as system_day_micros,
    (limits->>'systemMonth')::bigint as system_month_micros
  from quota.cost_policy
  where singleton;
  ```

  راه دیگر: صفحهٔ هزینهٔ ادمین همین `limits` را نشان می‌دهد (`packages/core/src/ops/admin-read.ts:520-522`).
- `M`: هیچ ابزار مخزن فقط این دو فیلد را از محیط استقرار نمی‌خواند.
  - کشیدن کل env استقرار با ابزار سکوی استقرار بقیهٔ کلیدها، از جمله `OPENROUTER_API_KEY`، را هم روی دیسک یا خروجی می‌آورد، پس مجاز نیست. Not Verified: اینکه سکوی استقرار مقدار env حساس را اصلاً دوباره نشان می‌دهد.
  - راه دستی: مالک مقدار `OPENROUTER_SETTINGS_JSON` را از منبع امن خودش در یک shell محلی تازه (bash، با Node از مخزن) به فرمان زیر می‌دهد. فرمان در هر حالت **فقط دو عدد یا یک پیام ثابت** چاپ می‌کند.

  **۱. تعریف فرمان** (یک بار در همان shell؛ متن فرمان هیچ مقداری ندارد):

    ```bash
    M_READ='
    let d = "";
    const fail = () => { process.stderr.write("M: invalid settings\n"); process.exitCode = 1; };
    process.stdin.setEncoding("utf8");
    process.stdin.on("error", fail);
    process.stdin.on("data", (c) => { d += c; });
    process.stdin.on("end", () => {
      try {
        const s = JSON.parse(d);
        const ok = (n) => Number.isSafeInteger(n) && n > 0;
        const plain = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
        if (!plain(s) || !ok(s.maximumMicros)) return fail();
        const m = s.modelMaximumMicros === undefined ? {} : s.modelMaximumMicros;
        if (!plain(m)) return fail();
        const v = Object.values(m);
        if (!v.every((n) => ok(n) && n <= s.maximumMicros)) return fail();
        process.stdout.write(s.maximumMicros + " " + v.reduce((a, n) => Math.min(a, n), s.maximumMicros) + "\n");
      } catch { fail(); }
    });'
    ```

  **۲. خط اجرا** (همین یک خط، هم در خودآزمایی و هم با مقدار واقعی؛ متن آن هیچ مقداری ندارد):

    ```bash
    set +x; ( trap 'stty echo' EXIT; trap 'exit 130' INT TERM HUP; stty -echo; S=$(cat); stty echo; printf '%s' "$S" | node -e "$M_READ" ); echo "exit=$?"
    ```

  - **مقدار چگونه به فرمان می‌رسد.** نخست همین یک خط را اجرا کن و فقط پس از آن مقدار را بچسبان؛ خط اجرا و مقدار را هرگز با هم در یک چسباندن نیاور. پس از اجرا، ترمینال بی‌صدا منتظر می‌ماند (`stty -echo`) و `cat` همهٔ سطرهای چسبانده را تا پایان ورودی می‌خواند. پس از چسباندن، **Enter و سپس Ctrl-D** بزن. این برای مقدار تک‌خطی، چندخطی و بی newline پایانی یکسان است: Enter سطر آخر را می‌بندد و Ctrl-D پایان ورودی است؛ newline اضافه را `$(cat)` می‌برد و JSON آن را نادیده می‌گیرد. مقدار نه به readline ‏shell می‌رسد و نه در خط فرمان است: فقط در متغیر `S` درون subshell ‏`( … )` است که export نمی‌شود و با پایان subshell از بین می‌رود. `printf` builtin خود bash است، پس مقدار در argv هیچ فرایندی نیست و فقط از راه pipe به stdin ‏Node می‌رسد.
  - **برگرداندن echo.** `trap 'stty echo' EXIT` در پایان subshell، چه عادی و چه با Ctrl-C ‏(`trap 'exit 130' INT`)، echo ترمینال را برمی‌گرداند (Not Verified در Job؛ پایان عادی را خودآزمایی می‌سنجد، Ctrl-C را نه). اگر به هر دلیل حروف تایپ‌شده دیده نمی‌شوند، بی‌دیدن `stty echo` و Enter بزن.
  - **تاریخچهٔ shell.** ادعای این runbook دربارهٔ تاریخچه فقط به اندازهٔ خودآزمایی پایین است: خودآزمایی با دادهٔ ساختگی و نگاه به تاریخچه در **همان ترمینال و پیش از مقدار واقعی** اجرا می‌شود. اگر در خودآزمایی تکه‌ای از ورودی ساختگی در تاریخچه دیده شد، مقدار واقعی را در این ترمینال نده.
  - مقدار در هیچ فایلی نوشته نمی‌شود. فرمان هیچ فایلی نمی‌سازد و مالک هم نباید مقدار را در فایل، `.env` یا پیام بگذارد.
  - **سنجش پیش از هر چاپ.** فرمان نخست کل ورودی را parse می‌کند و می‌سنجد: ریشه یک object باشد؛ `maximumMicros` عدد صحیح مثبت امن باشد؛ `modelMaximumMicros` یا نباشد یا object باشد و هر مقدارش عدد صحیح مثبت امن و نه بیش از `maximumMicros` (همان قیدهای `contracts.ts:60-63` و `:101`). فقط اگر همه درست بود چاپ می‌کند.
  - **خروجی درست:** یک سطر روی stdout با دو عدد، با یک فاصله: نخست `maximumMicros` (بزرگ‌ترین `M`)، سپس کوچک‌ترین `M` (کمینهٔ `maximumMicros` و همهٔ مقدارهای `modelMaximumMicros`)، و سپس سطر `exit=0`. نام مدل‌ها و هیچ فیلد دیگری چاپ نمی‌شود.
  - **خروجی نادرست:** JSON خراب، ورودی تهی، ریشهٔ غیر object، یا فیلد غیرعددی یا بیرون از بازه: فقط پیام ثابت `M: invalid settings` روی stderr و `exit=1`. هر خطا، از جمله خطای parse، درون `try` گرفته می‌شود و متن خطا، stack یا هیچ تکه‌ای از ورودی چاپ نمی‌شود.
  - خط اجرا با `set +x` آغاز می‌شود، چون با xtrace ‏bash آرگومان `printf`، که همان مقدار است، روی stderr چاپ می‌کند.
  - Not Verified: سقف طول یک سطر در حالت canonical ترمینال (روی Linux حدود 4095 بایت). اگر مقدار تک‌خطی از آن بلندتر باشد، انتظار می‌رود بخشی از آن برسد و خروجی پیام ثابت باشد، نه نشت.
  - این JSON بنا بر schema کلید API ندارد (`contracts.ts:4-70`؛ کلید در `OPENROUTER_API_KEY` جداست، `apps/web/src/server/ai.ts:8`). با این حال فرمان جز دو عدد هیچ چیز از آن چاپ نمی‌کند.

  **خودآزمایی** (AC-20؛ R2-P1108-04). در همان ترمینالی که مقدار واقعی را خواهی داد و پیش از آن، پس از گام ۱، خط اجرای گام ۲ را چهار بار اجرا کن و هر بار یکی از ورودی‌های ساختگی زیر را در پرسش بی‌صدا بچسبان، سپس Enter و Ctrl-D. ورودی‌ها ساختگی‌اند و هیچ مقدار production یا secret ندارند. ورودی (۱) تا (۳) تک‌خطی‌اند و بی newline پایانی چسبانده می‌شوند (فقط تا پایان همان سطر کپی کن، بی شکست سطر)؛ ورودی (۴) چندخطی است.

    ```text
    (۱) درست:
    {"maximumMicros":500000,"modelMaximumMicros":{"fake/model-a":200000,"fake/model-b":400000},"currency":"USD","fakeField":"FAKE-not-a-secret"}
    (۲) JSON خراب:
    {"maximumMicros":500000,"fakeField":"FAKE-not-a-secret"
    (۳) فیلد غیرعددی:
    {"maximumMicros":"500000","modelMaximumMicros":{"fake/model-a":200000},"fakeField":"FAKE-not-a-secret"}
    (۴) چندخطی درست (هر پنج سطر با هم):
    {
      "maximumMicros": 500000,
      "modelMaximumMicros": {"fake/model-c": 300000},
      "fakeField": "FAKE-multi-line-not-a-secret"
    }
    ```

  **خروجی مورد انتظار؛ در Job اجرا نشده**

  | ورودی | stdout | stderr | کد خروج |
  |---|---|---|---|
  | (۱) درست | `500000 200000` | — | `exit=0` |
  | (۲) JSON خراب | — | `M: invalid settings` | `exit=1` |
  | (۳) فیلد غیرعددی | — | `M: invalid settings` | `exit=1` |
  | (۴) چندخطی درست | `500000 300000` | — | `exit=0` |

  - در هیچ‌کدام `fake/model-`، `fakeField`، `FAKE-` یا تکه‌ای از ورودی در خروجی نیست، و ورودی چسبانده روی صفحه دیده نمی‌شود.
  - پس از هر چهار اجرا، حروف تایپ‌شده دوباره دیده می‌شوند (echo برگشته)، و در `history 10` هیچ `FAKE-`، `fakeField`، `fake/model-` یا سطری از ورودی (۴) نیست.
  - اگر خروجی یا echo با این بندها فرق کرد، فرمان را با مقدار واقعی اجرا نکن. اگر تکه‌ای از ورودی ساختگی در تاریخچه بود، مقدار واقعی را نده.
  - `echo "exit=$?"` کد خروج subshell را نشان می‌دهد که همان کد خروج `node` است، چون `node` آخرین فرمان pipe است.

**شمار لغو پیاپی تا پر شدن سقف (فرمول).** فرض: هر لغو در میانهٔ یک فراخوان پولی یک hold باز با `M` می‌گذارد، بی هزینهٔ دیگر. hold شمارهٔ n فقط وقتی پذیرفته می‌شود که `(n-1)·M + M ≤ سقف` (`costs.ts:169-171`). پس پس از `floor(سقف / M)` hold باز، فراخوان بعدی رد می‌شود. هزینهٔ ثبت‌شدهٔ دیگر این شمار را کمتر می‌کند. با دو عدد فرمان خواندن `M`: شمار با عدد نخست (`maximumMicros`) کمترین شمار ممکن است و با عدد دوم (کوچک‌ترین `M`) بیشترین آن.

- **جلسه:** `floor(session / M)` لغو در یک جلسه، بی مرز زمانی. سپس آن جلسه بسته می‌شود.
- **ماه کاربر:** `floor(userMonth / M)` لغو در یک ماه UTC. سپس فراخوان تازهٔ همان کاربر در هر جلسه رد می‌شود.
- **روز سیستم:** `floor(systemDay / M)` لغو در یک روز UTC، از همهٔ کاربران.
- **ماه سیستم:** `floor(systemMonth / M)` لغو در یک ماه UTC، از همهٔ کاربران.
- **اگر سقف کاربر زودتر پر شود:** کاربر پس از `floor(userMonth / M)` لغو خودش بسته می‌شود، پیش از آنکه به‌تنهایی سقف روز یا ماه سیستم را پر کند. این هر وقت `floor(userMonth / M) < floor(systemDay / M)` باشد برقرار است، و همین‌طور برای ماه سیستم. آن‌گاه پر کردن سقف سیستم دست‌کم `ceil(floor(systemDay / M) / floor(userMonth / M))` کاربر می‌خواهد، و برای ماه سیستم همین‌طور.

**نمونهٔ کار‌شده با مقدارهای نمایشی (نه production):** `M = 500000`، `session = 2000000`، `userMonth = 20000000`، `systemDay = 50000000`، `systemMonth = 500000000`.

- جلسه: `floor(2000000 / 500000) = 4`. لغو پنجم در همان جلسه دیگر hold نمی‌گیرد و جلسه بسته است.
- ماه کاربر: `floor(20000000 / 500000) = 40`. یک کاربر با جلسه‌های تازه حداکثر به ۴۰ لغو در ماه می‌رسد.
- روز سیستم: `floor(50000000 / 500000) = 100`. چون ۴۰ < ۱۰۰، یک کاربر به‌تنهایی سقف روز را پر نمی‌کند و دست‌کم `ceil(100 / 40) = 3` کاربر لازم است.
- ماه سیستم: `floor(500000000 / 500000) = 1000`. دست‌کم `ceil(1000 / 40) = 25` کاربر لازم است.

عددهای واقعی، با مالک: همین فرمول روی خروجی دو فرمان بالا.

**راه دیدن و بستن دستی.**

- **دیدن (فقط جمع):**
  - صفحهٔ هزینهٔ ادمین `reservedMicros` (جمع holdهای باز)، شمار attemptهای `started` و `uncertain` و `limits` سیاست را نشان می‌دهد (`packages/core/src/ops/admin-read.ts:495-523`).
  - فرمان `stats` اپراتور شمار و جمع holdهای باز را به تفکیک ارز می‌دهد (`packages/core/src/quota/operations.ts:26-35` و `:59-63`؛ `packages/core/src/ops/operator.ts:142-163`).
  - فهرست تک‌به‌تک holdها در هیچ ابزاری نیست.
- **بستن: هیچ.** هیچ فرمان، کار ادمین یا Jobی hold باز را نمی‌بندد، جز `finishProviderStep` در مسیر عادی provider.
- **پرسش مالک پیش از cutover لازم است:** آیا این holdها تا بازیابی دستهٔ ۱۲ باز بمانند، یا راه بستن دستی (و با کدام ثبت هزینه) پیش از cutover لازم است؟ تا پاسخ، تنها ترمز اضطراری موجود `killSwitch` در `cost.configure` است. اهرم بالا بردن موقت سقف در بند ۱۰ است.

## ۹. سه فراخوان runDueJobs که build نمی‌دهند (AC-22 (الف)؛ C11-50)

این سه فراخوان `runDueJobs` گزینهٔ `build` ندارند، پس claimشان `lease_build` را NULL می‌نویسد (`packages/core/src/plt/jobs.ts:283`، head ‏`2043a1d`). سه فراخوان و guardها کد پیش از این PR‌اند، روی main ‏`fe526ba`:

- `packages/ops-cli/src/evaluate.ts:340-343` و `:437-440`
- `packages/core/src/eval/provider-checks.ts:133-136` (فقط از `evaluate.ts:413` و `:446` صدا زده می‌شود)
- `tools/voice/evaluate-pronunciation.ts:259-262` و `:278-281`

روی پایگاه داده‌ای که مانع در آن فعال است، claim آن‌ها رد می‌شود (fail-closed؛ B02، زیرحالت «NULL build»).

- روی main ‏`fe526ba` هر دو ابزار پیش از هر کاری پایگاه دادهٔ غیرمحلی را رد می‌کنند (Observed by model):
  - `evaluate.ts:173-175` ⇒ `packages/ops-cli/src/evaluation-config.ts:61-71`: فقط `localhost`، `127.0.0.1` یا `[::1]` روی درگاه 54322 و `/postgres`؛
  - `evaluate-pronunciation.ts:170-171` ⇒ `:45-48`: فقط میزبان محلی.
- **قاعده:** این ابزارها پس از فعال‌سازی روی production اجرا نمی‌شوند. guard کنونی‌شان هم آن را اجازه نمی‌دهد. guard را برای این کار دور نزن.
- اگر روزی لازم شد آن‌ها را روی پایگاه داده‌ای با مانع فعال اجرا کرد، این تصمیم با مالک است و پیش از آن کد باید `build` بدهد. آن تغییر کد بیرون از این کارت است.
- روی پایگاه دادهٔ محلی، اگر مانع را برای آزمون فعال کرده‌ای، پیش از اجرای این ابزارها `select plt.deactivate_job_claim_barrier();` را محلی اجرا کن.

## ۱۰. اهرم اضطراری: سقف روز یا ماه سیستم با holdهای بازمانده پر شده است (AC-18)

این اهرم بی تغییر کد ممکن است. هیچ hold بسته نمی‌شود. فقط سقف موقتاً بالا می‌رود. همهٔ ارجاع‌ها کد پیش از این PR است، روی main ‏`fe526ba`، و Observed by model.

- **(الف) کدام مقدار.** `limits.systemDay` یا `limits.systemMonth` در ستون jsonb ‏`limits` ردیف singleton ‏`quota.cost_policy` (`costs.ts:12-17`).
  - کد آن را در هر `beginProviderStep` از پایگاه داده می‌خواند (`costs.ts:137-148`، زیر قفل advisory سیاست در `:134`).
  - کد آن را با جمع همان دوره می‌سنجد (`costs.ts:169-171`).
  - برای سقف جلسه (بند ۸، AC-19) همین اهرم روی `limits.session` است.
- **(ب) کنش مالک و زمان اثر.** یکی از این دو. هر دو از `configureCostPolicy` می‌گذرند (`costs.ts:21-62`)، که ردیف را upsert و یک رویداد audit با `reason` ثبت می‌کند (`:51-58`):
  - صفحهٔ ادمین، کنش `cost.configure` (`apps/web/src/server/admin-routes.ts:226-256`):
    - **هر چهار** سقف، `killSwitch` و `reason` را می‌خواهد.
    - `version` را `admin-<operationKey>` و ارز را `USD` می‌نویسد (`:246-247`).
  - CLI اپراتور: `pnpm ops -- --input <request.json>`، با فرمان `cost.configure` (`packages/core/src/ops/operator.ts:66`، `:130-136`؛ `packages/ops-cli/src/main.ts:12`، `:29-36`). سیاست کامل را می‌خواهد: `version`، `currency`، `killSwitch` و هر چهار سقف (`costs.ts:8-18`).
  - سه مقدار دیگر و `killSwitch` را دقیقاً همان مقدار پیشین بده. هر دو مسیر کل `limits` را جایگزین می‌کنند.
  - update مستقیم SQL روی ردیف را به کار نبر. از schema و audit می‌گذرد.
  - **زمان اثر:** از نخستین `beginProviderStep` پس از commit. کد cache ندارد و ردیف را در همان تراکنش می‌خواند (`costs.ts:137-141`).
- **(ج) برگشت و زمان آن.** همان کنش (ب) با مقدارهای پیشینِ ثبت‌شده در گام (و).
  - holdهای باز روز با گذشتن نیمه‌شب UTC از `systemDay` بیرون می‌روند (`costs.ts:85`، `:101`).
  - holdهای باز ماه با آغاز ماه UTC بعد از `systemMonth` و `userMonth` بیرون می‌روند (`costs.ts:86`، `:97-102`).
  - پس برگشت سقف روز پس از نیمه‌شب UTC همان روز، و برگشت سقف ماه پس از آغاز ماه UTC بعد است. زودتر از آن، برگشت سقف را دوباره پر می‌کند.
  - holdهای جلسه مرز زمانی ندارند (`costs.ts:96`)، پس برگشت `limits.session` جلسه‌های لغوشده را دوباره می‌بندد. زمان برگشت آن با مالک است (پرسش ۱۰).
- **(د) هیچ ردیف hold، attempt یا provider_cost حذف یا تغییر نمی‌شود.** `configureCostPolicy` فقط `quota.cost_policy` و رویداد audit را می‌نویسد (`costs.ts:29-58`).
- **(ه) پیامد هزینه:** بالا بردن سقف سیستم، بیشینهٔ خرج واقعی همان دوره (روز یا ماه) را به همان اندازه بالا می‌برد. holdهای باز خرج واقعی نیستند، ولی فضای آزادشده با فراخوان‌های پولی واقعی پر می‌شود.
- **(و) گام ثبت، پیش از تغییر.** در یادداشت cutover یا عملیات مالک بنویس:
  - مقدار پیشین هر چهار سقف و `killSwitch` (با فرمان فقط‌خواندنی بند ۸)؛
  - مقدار تازه؛
  - زمان به UTC؛
  - دلیل.
  - همان دلیل را در `reason` کنش بده تا در audit هم بماند (`costs.ts:57`).

## پرسش‌های باز مالک

1. AC-8: سه مورد Not Verified ‏C11-10 و لاگ runtime به تفکیک deployment (بند ۱، پیش‌شرط ۳).
2. در دسترس بودن `VERCEL_GIT_COMMIT_SHA` در runtime ‏production (بند ۱، پیش‌شرط ۴).
3. تصمیم دربارهٔ C11-34 و C11-35، با شمارهٔ تصمیم (بند ۱، پیش‌شرط ۵).
4. holdهای بازمانده: باز بمانند تا دستهٔ ۱۲، یا راه بستن دستی پیش از cutover (بند ۸).
5. مقدار production چهار سقف و `M` (بند ۸). مالک می‌خواند و در این سند نمی‌آید.
6. نتیجهٔ فرمول بند ۸ با عددهای واقعی پذیرفتنی است، یا سقف‌ها پیش از cutover عوض می‌شوند؟
7. منبع معتبر فهرست kindهای تعریف‌شدهٔ استقرار production برای وارسی (الف) بند ۲ گام ۲. بی آن، شمار «نامعلوم» است و فعال‌سازی مجاز نیست، مگر تصمیم صریح تازهٔ مالک.
8. پذیرش حد وارسی (ب): Jobهای با نسخهٔ بالاتر که هنوز موعدشان نرسیده شمرده نمی‌شوند. آیا یک دور runner و صفر بودن شمار کافی است، یا شرط دیگری لازم است؟
9. حد زمانی وضع میانی (کد مستقر، مانع خاموش) و گام پس از گذشتن آن (بند ۲، «فعال‌سازی عقب‌افتاده»).
10. زمان برگشت `limits.session` اگر برای جلسه‌های لغوشده بالا رفت (بند ۱۰ (ج)).
11. ثبت تأیید محیط Preview: نبود هر پنج متغیر در Preview (بند ۱، پیش‌شرط ۶؛ AC-29؛ C11-54).
