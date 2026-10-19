# دستورالعمل انتشار اصلاح پنج مشکل (D66) — 2026-10-12

وضعیت: آمادهٔ اجرا توسط مدیر کار، پس از سبز شدن هر پنج شاخه. مجوز D66 فقط همین انتشار را پوشش می‌دهد. مبنا: [D60 تا D66](../PRODUCT_DECISIONS_LOG.md)، [بررسی علت](FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)، [بازبینی امنیتی](RELEASE_SECURITY_REVIEW_2026-10-12.md).

## ۰. وضعیت پایه (بررسی‌شده در 2026-10-12)

| مورد | مقدار |
|---|---|
| Vercel | پروژهٔ `prj_sexBQckLtPOxFHgqV385Bx1JaxqF`، تیم `team_8WX5ZTQoGLK3XQim9CHcQ350`؛ استقرار خودکار production از `main` |
| استقرار زنده | `dpl_8iiwKrj57ePBKSMjVE36fUmNd4hZ` از `b4aa3d5` (READY). استقرار قبلی برای بازگشت: `dpl_7E3ne8Vwfd1PyNmdCNVTCZddaeyx` از `93978ea` |
| آدرس production | `https://recalino.vercel.app` |
| آخرین migration ابری | `20261009181203` (۴۶ migration)، برابر با `origin/claude/gifted-franklin-7ecldm` |
| شاخهٔ پایه | `origin/claude/gifted-franklin-7ecldm` (`2baa35f`)؛ `main` در `4ad3391`، سه commit فقط‌مستند عقب‌تر |
| hotfix D59 | شاخهٔ `feat/hotfix-d59-audio-start` (`94c3580`، از `main`). همان تغییر `audio.ts` در `feat/upload-reliability` (commit `47c1bfb`) هم هست |

## ۱. PR و CI کامل

0. **پیش‌شرط: GitHub Actions کار را شروع می‌کند.** از حدود 22:16 UTC روز 2026-10-12، همهٔ اجراها در همهٔ شاخه‌ها پس از ۲ ثانیه و بدون هیچ گامی شکست می‌خوردند (گزارش مدیر). پیش از هر کار: آخرین اجرای CI روی `main` یا شاخهٔ ادغام باید گام‌های اجراشده داشته باشد (مثلاً `pnpm install`)، نه شکست صفرگامی. تا رفع این مشکل، «CI سبز» قابل اثبات نیست و ادغام در `main` انجام نمی‌شود.
1. شاخه‌ها را به ترتیب بخش ۳ در یک شاخهٔ ادغام (پیشنهاد: `feat/five-problems-release`، تا e2e هم اجرا شود) از `origin/claude/gifted-franklin-7ecldm` ادغام کن. ادغام شاخهٔ `claude/...` مستقیم e2e را اجرا نمی‌کند؛ شرط job در `ci.yml` فقط `main`، `feat/*` و `codex/*` است.
2. پس از ادغام آخرین migration:
   ```bash
   pnpm db:start && pnpm db:reset && pnpm db:types
   git diff --exit-code packages/core/src/db/types.ts   # باید خالی باشد
   pnpm verify
   ```
3. push کن و منتظر سبز شدن هر دو job بمان: «Lint, types, boundaries, tests, build» و «End-to-end».
4. PR از شاخهٔ ادغام به `main`. توضیح PR: فهرست D60 تا D66، migrationها، کلیدهای خاموش‌کردن (بخش ۶).
5. hotfix D59: اگر PR جداگانهٔ `feat/hotfix-d59-audio-start` زودتر در `main` نشست، `main` را در شاخهٔ ادغام merge کن. ادغام آزمایشی (2026-10-12): تغییر `audio.ts` در دو شاخه یکسان است و بی‌تعارض ادغام می‌شود. تنها تعارض add/add در `packages/core/src/proc/audio-charged-material.int.test.ts` است؛ هر دو نسخهٔ آزمون را نگه دار، یا اگر یکسان‌اند، نسخهٔ `upload-reliability` را. سپس `pnpm test:int` را برای `proc` اجرا کن.

## ۲. بررسی بی‌کاری پردازش (فقط‌خواندنی، پیش از ادغام در `main`)

ادغام در `main` بلافاصله استقرار production می‌سازد؛ پس این بررسی **پیش از ادغام PR** انجام شود. *(به‌روزرسانی 2026-10-19، [D83](../PRODUCT_DECISIONS_LOG.md): پس از اجرای [چک‌لیست دروازهٔ CI](../ops/BRANCH_PROTECTION_FA.md)، استقرار production فقط پس از سبز شدن check «Lint, types, boundaries, tests, build» روی همان commit promote می‌شود؛ این بررسی همچنان پیش از ادغام انجام شود.)* فقط `select`، با پروژهٔ `twowhuzhvyuzjrpraikm`:

```sql
-- باید صفر ردیف برگرداند؛ هر ردیف یعنی کاری در جریان است.
select 'job' as what, kind as detail, state, count(*) as n
from plt.job where state in ('queued','running','retry_scheduled')
  -- فقط کارهای پردازش کلاس و صوت؛ کارهای دوره‌ای نگهداری (plt.purge_*، src.maintenance و…) مانع نیستند.
  and kind in ('proc.process','proc.voice_analysis','proc.automatic_learning','eval.lesson_review',
               'src.verify_audio','src.verify_upload','src.verify_staged_audio','media.tts')
group by 1,2,3
union all
select 'run', '', state, count(*) from proc.processing_run
where state in ('queued','processing') group by 1,2,3
union all
select 'upload', '', state, count(*) from src.audio_upload
where state = 'pending' and expires_at > now() group by 1,2,3;

-- Runهای منتظر آپلود: مانع انتشار نیستند (آپلود از دستگاه دوباره شروع می‌شود)، ولی ثبتشان کن.
select id, state, last_error, created_at from proc.processing_run
where state = 'awaiting_upload' order by created_at;

-- نسخهٔ migration ابری پیش از push
select max(version), count(*) from supabase_migrations.schema_migrations;
```

نتیجهٔ 2026-10-12 حدود 22:30 UTC: هیچ job یا Run فعالی نبود، یک Run در `awaiting_upload` (همان `fbc79e72` سند تشخیص)، ۶ آپلود `verified` که همه کمتر از ۲۴ ساعت از رونویسی‌شان گذشته است.

اگر کاری در جریان بود، تا ۱۰ دقیقه صبر کن و دوباره اجرا کن. نام کارها و state‌ها از `supabase/migrations/20261002094004_plt_jobs.sql` و `20261004044059_lkm_processing.sql` بررسی شده‌اند.

## ۳. ترتیب ادغام

| ترتیب | شاخه | migration | چرا این ترتیب |
|---|---|---|---|
| 1 | `feat/upload-reliability` | ندارد | رفع D59 فوری‌ترین است؛ بی‌تعارض روی پایه |
| 2 | `feat/recording-capture` | `20261012230000_src_capture_staged_audio.sql` | تعارض فقط در `pending-copy.ts` و `UI_COPY_PENDING.md` |
| 3 | `feat/session-navigation` | ندارد | تعارض با ۱ در `AutomaticLearningProvider.tsx`، `pending-copy.ts`، `UI_COPY_PENDING.md` |
| 4 | `feat/lesson-quality` | ندارد | تعارض متنی در دو فایل متن |
| 5 | `feat/voice-detection` | `20261012220000_voice_class_links.sql` | تعارض با ۴ در `packages/core/src/proc/worker.ts` و با ۱ در `packages/core/src/voc/index.ts` |

نتیجهٔ ادغام آزمایشی (2026-10-12، سرِ شاخه‌ها در دور دوم: `105c2ac`، `c512a24`، `38067a3`، `f4a0f7a`، `26aa6e0`):

- **برخورد timestamp:** ندارد. دو migration تازه هر دو بعد از `20261009181203` ابری‌اند.
- **وابستگی ترتیب:** ندارند. یکی `voc.analysis` و دیگری `src.audio_upload` و `org.class_session` را تغییر می‌دهد. `supabase db push` آن‌ها را به ترتیب نام اجرا می‌کند (`2200` پیش از `2300`)، مستقل از ترتیب ادغام.
- **`packages/core/src/db/types.ts`:** هر دو شاخه تغییرش داده‌اند، ولی ادغام متنی‌اش بی‌تعارض است. پس از ادغام هر دو، `pnpm db:types` را دوباره اجرا کن؛ گام CI «Generated DB types match the migrations» همین را می‌سنجد.
- **تعارض‌های واقعی:** `worker.ts` (lesson-quality با voice-detection، هر دو بخش بررسی صدا را بازنویسی کرده‌اند) نیاز به حل دستی و اجرای دوبارهٔ `proc/*.int.test.ts` دارد. بقیه متن رابط‌اند؛ همهٔ کلیدها را نگه دار.
- **هر دو migration افزایشی‌اند:** ستون nullable یا با default، یک قید check، یک index یکتای جزئی و `drop not null` روی `src.audio_upload.reservation_id`. روی ۴۶ ردیف فعلی قفل طولانی نمی‌سازند.

این بررسی را درست پیش از ادغام تکرار کن:

```bash
B=origin/claude/gifted-franklin-7ecldm
for b in upload-reliability recording-capture session-navigation lesson-quality voice-detection; do
  git fetch -q origin feat/$b
  git diff --name-only $B...origin/feat/$b -- supabase/migrations packages/core/src/db/types.ts | sed "s|^|$b: |"
done
```

## ۴. `supabase db push`

فقط پس از ادغام در `main` (اجازهٔ دائمی CLAUDE.md). از checkout تمیز `main`:

```bash
supabase db push --dry-run   # باید فقط دو migration بخش ۳ را نشان دهد
supabase db push
```

سپس بررسی: `select version from supabase_migrations.schema_migrations order by version desc limit 3;` باید `20261012230000` و `20261012220000` را نشان دهد.

**نگهبان schema (OPS-05، ممیزی 2026-10-18):** از این پس build نسخهٔ تازه‌ترین فایل `supabase/migrations` را در `apps/web/src/server/schema-version.generated.ts` می‌نویسد (`pnpm schema:version`؛ آزمون واحد کهنگی آن را می‌گیرد). اگر دیتابیس از این نسخه عقب‌تر باشد، runner (`/api/jobs/run` و بیدارباش فوری) هیچ ایمیل، job دوره‌ای یا claim تازه‌ای انجام نمی‌دهد، هر بار لاگ `schema_behind` می‌نویسد، برای هر نسخه یک رخداد ممیزی `ops.schema_behind` (در «Recent activity» پنل مالک) و یک لاگ خطای `schema_behind_alert` می‌سازد، و `/api/health?deep=1` پاسخ 503 می‌دهد. حداکثر ۳۰ ثانیه پس از `db push`، runner خودکار ادامه می‌دهد. اگر نقش برنامه نتواند `supabase_migrations.schema_migrations` را بخواند، نگهبان یک بار هشدار `schema_version_unreadable` می‌نویسد و کار را متوقف نمی‌کند (fail open).

**قاعدهٔ ترتیب:** هر migration باید با کد در حال اجرا سازگار باشد (فقط افزایشی؛ ستون not-null تازه با default). ترتیب امن‌تر «اول migration سازگار با عقب، سپس ادغام کد» است؛ چون قاعدهٔ فعلی CLAUDE.md اجرای `db push` را فقط برای migrationهای ادغام‌شده در `main` بی‌پرسش می‌داند، تغییر این ترتیب تصمیم مالک محصول است. تا آن تصمیم، پنجرهٔ میان ادغام و `db push` را نگهبان بالا امن می‌کند.

**ترتیب استقرار و migration:** کد تازه ستون‌های تازه را می‌خواند (`voc.analysis.speaker_links`، `src.audio_upload.staged_at`، `org.class_session.capture_open_until`). ادغام در `main` بلافاصله استقرار می‌سازد و ساخت حدود ۲ تا ۴ دقیقه طول می‌کشد؛ پس `db push` را **بلافاصله پس از ادغام** اجرا کن تا پیش از READY شدن استقرار تمام شود. کد قدیمی در حال اجرا با schema تازه سازگار است: هیچ ستونی حذف یا تغییر نوع نمی‌دهد و تنها ستون not-null تازه default دارد.

## ۵. تأیید استقرار خودکار Vercel

1. در داشبورد Vercel، یا با `list_deployments` (`target: production`، `limit: 1`)، استقراری با `githubCommitSha` برابر commit ادغام باید به `READY` برسد.
2. شناسهٔ استقرار قبلی (`dpl_8iiwKrj57ePBKSMjVE36fUmNd4hZ`) را برای بازگشت یادداشت کن.
3. خطاهای ساخت: `list_deployment_events` همان استقرار.

## ۶. روشن کردن قابلیت‌ها

همهٔ تنظیمات زیر از کد شاخه‌ها خوانده شده‌اند. هیچ‌کدام در production تعریف نشده‌اند (فهرست نام متغیرها، 2026-10-12)، پس **پیش‌فرض کد** فعال می‌شود:

| تصمیم | سازوکار (شاخه، فایل) | پیش‌فرض | کار هنگام انتشار |
|---|---|---|---|
| D60 آپلود قطعه حین ضبط | `RECALINO_CAPTURE_EARLY_UPLOAD` (`recording-capture`، `apps/web/src/server/capture-staging-jobs.ts:14`) | **روشن** مگر `off` | کاری لازم نیست. خاموش‌کردن: `off` و redeploy |
| D61 رونویسی پس‌زمینه | `RECALINO_CAPTURE_EARLY_TRANSCRIPTION` (همان فایل) | روشن مگر `off`؛ اما **hook رونویسی هنوز وصل نیست** (`setStagedVerifiedHook` هیچ فراخوانی ندارد) | پیش از انتشار، از مالک شاخه بپرس که D61 کامل شده یا نه |
| D64 تأیید صدا یک بار در کلاس و انتخاب خط | `VOICE_SETTINGS_JSON` با `classConfirmation` و `targetTurns` (`voice-detection`، `packages/core/src/voc/settings.ts`) | **هر دو روشن** | کاری لازم نیست. خاموش‌کردن: JSON کامل با `false`. مقدار نامعتبر خطا می‌دهد و پردازش صدا را می‌شکند؛ پیش از ذخیره با `voiceSettingsSchema` بسنج |
| پذیرش خودکار صدا (D54) | `VOICE_ACCEPTANCE_POLICIES` | خاموش | دست نزن |
| D62 و D63 بودجهٔ جزوه و کلاس بلند | کلید `lessonQuality` در `OPENROUTER_SETTINGS_JSON` (`lesson-quality`، `packages/core/src/aip/contracts.ts`) | **خاموش** (کلید نیست ← رفتار قبلی) | فقط بخش ۷ |
| تشخیص ضبط (PRD-REC-05) | `RECALINO_CAPTURE_DIAGNOSTICS` | روشن مگر `off` | کاری لازم نیست |

یادداشت: «روشن کردن» D60 و D64 در عمل همان استقرار است. اگر مالک بخواهد انتشار کد و روشن شدن جدا باشند، پیش از ادغام `RECALINO_CAPTURE_EARLY_UPLOAD=off` و `VOICE_SETTINGS_JSON` با `false` را در production بگذار، پس از smoke test بردار و redeploy کن (پرسش ۱ گزارش).

## ۷. `OPENROUTER_SETTINGS_JSON` (فقط اگر ارزیابی D62 قبول شد)

1. گزارش ارزیابی زندهٔ `tools/eval/lesson-quality-live.ts` (۱۴ درس holdout، بازبینی کور، سقف ۱٫۵ دلار) باید طبق معیار D56 «بهتر» اعلام کرده باشد. اگر نه، این بخش اجرا نمی‌شود.
2. مقدار فعلی را از Vercel بخوان و در جای امن نگه دار (برای بازگشت). در چت یا لاگ چاپ نکن.
3. فقط این تغییرات را بده، مطابق `config/openrouter-defaults.json` شاخهٔ `lesson-quality`: `version: "openrouter-2026-10-12-1"`، `promptVersion: "recalino-knowledge-11"`، و کلید `lessonQuality` (`version`، `budget`، `sourceCoverage`، `structuredBoard`، و برای D63 `classPartMinutes: 90`). مقدار را پیش از ذخیره با `providerSettingsSchema` بسنج؛ JSON نامعتبر همهٔ پردازش AI را خاموش می‌کند (`apps/web/src/server/ai.ts`).
4. متغیر محیطی فقط در استقرار تازه خوانده می‌شود: redeploy همان commit (Vercel → Redeploy، بدون cache لازم نیست).

## ۸. Smoke test

خودکار و فقط‌خواندنی؛ بدون ورود، بدون ارسال فرم، فقط GET:

```bash
BASE_URL=https://recalino.vercel.app pnpm --filter @recalino/web test:smoke
```

در جلسهٔ ابری Chromium از `/opt/pw-browsers/chromium` برداشته می‌شود؛ جای دیگر `SMOKE_CHROMIUM_PATH` بده یا Chromium خود Playwright. پوشش: صفحهٔ اصلی و پیش‌نمایش بدون خطای console؛ هفت صفحهٔ محافظت‌شده به `/?next=…` می‌روند؛ هشت API بدون نشست 401 می‌دهند؛ `/dev/ui` در production صفحهٔ «یافت نشد» است؛ `/api/health`، manifest، service worker و آیکون‌ها 200.

نتیجهٔ اجرا روی production فعلی (`b4aa3d5`، 2026-10-12): **19 از 19 موفق**.

### چک‌لیست دستی مالک (با حساب خودش، پس از استقرار)

1. ورود؛ Today بدون خطا باز می‌شود.
2. جلسهٔ قدیمی `572dda3f` یا `f36401c8`: Retry آپلود صوت شروع می‌شود و دیگر «Some information is missing or not valid.» نمی‌آید (رفع D59).
3. جلسهٔ تازه، ضبط ۲ تا ۳ دقیقه با گوشی، چند ثانیه رفتن به برنامهٔ دیگر و برگشت، Stop. پیام بازه‌های ضبط‌نشده فقط پس از Stop می‌آید.
4. پیشرفت جلسه: گام بعد روشن است و آپلود صوت بلافاصله شروع می‌شود (با D60، بخشی از قطعه‌ها از قبل روی سرور است).
5. جزوه منتشر می‌شود. صفحهٔ جزوه نشان می‌دهد کدام فایل استفاده نشد و چرا.
6. تأیید صدا: یک بار برای کل کلاس پرسیده می‌شود؛ روی خط‌ها «این شمایید؟» هست.
7. Me → Quota: صوتی که قبلاً پرداخت شده دوباره کسر نشده است (D59).
8. خروج؛ برگشت با دکمهٔ Back صفحهٔ خصوصی را نشان نمی‌دهد.

## ۹. پایش ساعت نخست

### SQL فقط‌خواندنی (هر ۱۵ دقیقه، چهار بار)

```sql
-- وضعیت Runها در یک ساعت گذشته
select state, last_error, count(*) from proc.processing_run
where updated_at > now() - interval '1 hour' group by 1,2 order by 3 desc;

-- صف کارها بر اساس نوع و حالت
select kind, state, count(*), min(run_at) as oldest_due from plt.job
where created_at > now() - interval '1 hour' or state in ('queued','running','retry_scheduled')
group by 1,2 order by 1,2;

-- کارهای شکست‌خورده بر اساس کد خطا
select kind, last_error, count(*) from plt.job
where state = 'failed' and finished_at > now() - interval '1 hour' group by 1,2;

-- آپلودهای صوت تازه، از جمله نسخه‌های staged حین ضبط (D60)
select state, (reservation_id is null) as staged, count(*),
       count(*) filter (where verified_at is not null) as verified
from src.audio_upload where created_at > now() - interval '1 hour' group by 1,2;

-- Runهایی که ۳۰ دقیقه پس از ساخت هنوز منتظر آپلودند (نشانهٔ تکرار مشکل ۱)
select id, created_at from proc.processing_run
where state = 'awaiting_upload' and created_at < now() - interval '30 minutes';

-- D29/D60: نسخهٔ موقت صوت نباید بیش از ۲۴ ساعت پس از رونویسی بماند (باید صفر باشد)
select count(*) from src.audio_upload
where state <> 'deleted' and transcribed_at < now() - interval '24 hours';

-- نسخه‌های staged که هیچ Runی آن‌ها را برنداشت و پنجره‌شان گذشته (باید با sweep حذف شوند)
select count(*) from src.audio_upload
where reservation_id is null and state <> 'deleted' and expires_at < now() - interval '2 hours';
```

### شمارش 4xx و 5xx هر مسیر در لاگ Vercel

هر پاسخ API یک خط `info` با `"event":"request"`، `route`، `status` و `code` می‌نویسد (نمونه: `route: "sourceAudio"`، `status: 400`، `code: "validation_failed"`). پس پاسخ 4xx در فیلتر سطح `error`/`warning` دیده **نمی‌شود**.

- ابزار `get_runtime_logs`: `projectId` و `teamId` بالا، `environment: "production"`، `since: "1h"`، `query: "validation_failed"` (یا `"status":5`، یا نام کد)، و `group_by: "requestPath"` برای شمارش هر مسیر.
- 5xx: همان با `level: ["error","fatal"]` و `group_by: "requestPath"`، یا `get_runtime_errors`.
- CLI: `vercel logs --project recalino --since 1h --json | jq -r 'select(.message|test("\"event\":\"request\"")) | .message | fromjson | select(.status>=400) | "\(.route) \(.status) \(.code)"' | sort | uniq -c | sort -rn`

آستانهٔ اقدام در ساعت نخست: هر 5xx؛ بیش از ۳ پاسخ 400 روی `sourceAudio` یا `stagedAudio` از یک کاربر؛ هر job `failed` تازه.

### پیش‌نویس Routine روزانهٔ سلامت (ساخته نشده؛ هزینه‌اش پرسش ۳ است)

> Daily Recalino health check, read-only. Use the Vercel connector on project `prj_sexBQckLtPOxFHgqV385Bx1JaxqF` (team `team_8WX5ZTQoGLK3XQim9CHcQ350`) and the Supabase connector on `twowhuzhvyuzjrpraikm` only (first confirm `list_projects` shows `recalino` with that ref; otherwise stop). Never write, deploy or change settings; never read class text, transcripts or audio.
> 1. Runtime logs, production, last 24h: count `"event":"request"` lines with status >= 400 grouped by `route`, `status` and `code`. Flag any route/code pair with 5 or more 4xx, any 5xx, and any single user with 3 or more identical 4xx on a POST route (the 2026-10-11 incident was 17 silent `400 validation_failed` on `sourceAudio`).
> 2. SQL: runs in `awaiting_upload` older than 2 hours; jobs `failed` in 24h by `kind`/`last_error`; runs `failed`/`needs_input` in 24h by `last_error`; `src.audio_upload` not deleted more than 24h after `transcribed_at` (must be 0).
> 3. If nothing is flagged, end silently. Otherwise send the owner one short Persian summary with counts, route names and run ids only (no user email, no content).

## ۱۰. بازگشت (Rollback)

1. **Vercel instant rollback:** داشبورد ← Deployments ← `dpl_8iiwKrj57ePBKSMjVE36fUmNd4hZ` ← Instant Rollback (یا `request_rollback`). چند ثانیه طول می‌کشد. پس از آن، استقرار خودکار از `main` متوقف می‌ماند تا یک استقرار دستی promote شود؛ این را در گزارش بیاور.
2. **کلیدهای خاموش‌کردن، بدون rollback:** `RECALINO_CAPTURE_EARLY_UPLOAD=off`، `RECALINO_CAPTURE_EARLY_TRANSCRIPTION=off`، `VOICE_SETTINGS_JSON` با `classConfirmation: false` و `targetTurns: false`، برگرداندن `OPENROUTER_SETTINGS_JSON` به مقدار ذخیره‌شده. هر تغییر env یک redeploy لازم دارد.
3. **migrationها فقط رو به جلو:** rollback کد، schema را برنمی‌گرداند. هر دو migration افزایشی‌اند و کد `b4aa3d5` با آن‌ها کار می‌کند:
   - `voc.analysis.speaker_links` و `line_choices` با default `{}`: کد قدیمی نادیده‌شان می‌گیرد.
   - `src.audio_upload.reservation_id` nullable شده است. کد قدیمی ردیف بی‌hold نمی‌سازد، ولی ردیف‌های staged موجود را هم نمی‌شناسد. sweep قدیمی `expireTemporaryAudio` بر اساس `expires_at` آن‌ها را حذف می‌کند، پس D29 حفظ می‌شود.
   - `org.class_session.capture_open_until`: کد قدیمی نمی‌خواند؛ پردازش خودکار دیگر منتظر lease نمی‌ماند.
   - اگر حذف schema لازم شد، فقط با migration تازهٔ رو به جلو و اجازهٔ صریح مالک. پیش از `set not null` دوباره روی `reservation_id`، ردیف‌های staged باید حذف شده باشند.
4. داده: rollback هیچ دادهٔ کاربر را تغییر نمی‌دهد. حذف دستی ردیف‌ها لازم نیست.
5. **Vercel مستقل از GitHub Actions است:** استقرار production را Git integration مستقیم از `main` می‌سازد، نه CI. از کار افتادن Actions نه استقرار را متوقف می‌کند و نه rollback را. هر push به `main`، حتی با CI ازکارافتاده یا قرمز، استقرار می‌شود؛ پس push اصلاحی به `main` جایگزین rollback نیست، مگر اینکه محلی `pnpm verify` و `pnpm test:e2e` را گذرانده باشد. Instant Rollback در Vercel همیشه بدون CI کار می‌کند. *(به‌روزرسانی 2026-10-19، [D83](../PRODUCT_DECISIONS_LOG.md)، OPS-04: با ruleset `main` و Vercel Deployment Checks طبق [BRANCH_PROTECTION_FA.md](../ops/BRANCH_PROTECTION_FA.md)، push مستقیم به `main` رد می‌شود و استقرار production به سبز بودن همان check وابسته است. تا مالک محصول آن چک‌لیست را اجرا نکرده، جملهٔ قبلی برقرار است. با Actions ازکارافتاده، ادغام فقط با bypass مالک و شواهد محلی D67 ممکن است.)*

## ۱۱. گزارش پایانی انتشار

commit ادغام، شناسهٔ استقرار، خروجی `db push`، تنظیمات تغییرکرده (فقط نام)، نتیجهٔ smoke test، نتیجهٔ پایش ساعت نخست و هر rollback.
