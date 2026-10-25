# ۰۱ — فهرست سیستم (System Inventory)

- **تاریخ:** 2026-10-21
- **مبنای کد:** شاخهٔ `ccr-6c21ad01-nlxr08` روی commit `924735b` (Merge #73)
- **روش:** فقط بازرسی فقط‌خواندنی مخزن. هیچ سرویس ابری، لاگ runtime، متغیر محیطی production یا دادهٔ کاربر خوانده نشد. `node_modules` نصب نبود و نصب هم نشد.
- **دامنه:** فهرست اجزا. معماری فعلی در [02](02-as-is-architecture.md)، جریان داده در [03](03-data-flow-analysis.md)، ریسک‌ها در [04](04-risk-register.md) و پرسش‌های باز در [05](05-open-questions.md) آمده‌اند.

## برچسب‌ها و قرارداد ارجاع

| برچسب | معنا |
|---|---|
| **CONFIRMED** | شاهد مستقیم در کد، migration یا config مخزن هست. |
| **INFERRED** | از کنار هم گذاشتن چند شاهد استنتاج شده، ولی مستقیم دیده نشده است. |
| **UNKNOWN** | از مخزن تعیین‌شدنی نیست. معمولاً به مقدار production یا رفتار سرویس بیرونی بستگی دارد. |

- مسیرها نسبت به ریشهٔ مخزن‌اند. `path:line` یعنی خطی که شاهد از آن شروع می‌شود.
- مقدار هیچ secret یا متغیر محیطی در این اسناد نیامده است. فقط **نام** متغیرها آمده است.

---

## ۱. خلاصه

ریکالینو یک **modular monolith** است و از این اجزا ساخته شده:

- یک اپ Next.js که صفحه‌ها، API و اجراکنندهٔ Job را با هم روی Vercel Functions اجرا می‌کند.
- منطق دامنه در پکیج جدای `@recalino/core`.
- Postgres در Supabase که هم منبع حقیقت است و هم صف Job.
- Vercel Blob برای فایل‌ها، با دسترسی خصوصی.
- OpenRouter به‌عنوان تنها درگاه هوش مصنوعی، برای رونویسی، LLM، vision و TTS. **CONFIRMED** (بخش ۵).

---

## ۲. ساختار مخزن

| مسیر | نقش | شاهد | برچسب |
|---|---|---|---|
| `apps/web` | اپ Next.js (App Router)، شامل صفحه‌ها، route handlerها (`src/app/api/**/route.ts`)، کد فقط‌سرور (`src/server/`) و UI (`src/ui/`) | `apps/web/package.json`، `apps/web/AGENTS.md` | CONFIRMED |
| `packages/core` | ۲۲ پوشهٔ ماژول دامنه بدون وابستگی به Next.js/React: `acc` `aip` `anki` `card` `config` `db` `eval` `html` `lkm` `media` `note` `ops` `org` `pers` `plt` `priv` `proc` `quota` `src` `srs` `support` `voc` | `packages/core/src/`؛ قاعدهٔ `core-is-framework-free` در `.dependency-cruiser.cjs:19` | CONFIRMED |
| `packages/ops-cli` | CLI اپراتور، با اسکریپت‌های `backup`، `evaluate` و `timings` | `packages/ops-cli/package.json` | CONFIRMED |
| `supabase` | `config.toml`، ۵۶ migration و `seed.sql`. **هیچ Edge Function** ندارد (پوشهٔ `supabase/functions` وجود ندارد) | `supabase/migrations/` | CONFIRMED |
| `tools` | ابزار build و ops: `db-apply`، `db-types`، `legal`، `voice` (ارزیابی و مدل‌ها)، `client-bundle`، `function-size`، `schema-version` و دیگران | `tools/` | CONFIRMED |
| `config` | پیش‌فرض‌های JSON غیرمحرمانه: `openrouter-defaults.json`، `pilot-cost-policy.json`، `pilot-defaults.json`، `media-defaults.json` و `export-defaults.json` | `config/` | CONFIRMED |
| `docs` | PRD، FR، ADR (۰۰۰۱ تا ۰۰۰۳)، plans، runbooks، ممیزی 2026-10-18 | `docs/` | CONFIRMED |

---

## ۳. زبان، runtime و ابزار

| مورد | نسخه | شاهد | برچسب |
|---|---|---|---|
| Node.js | `>=24 <25` (در این سشن `v24.21.0`) | `package.json` (`engines`) | CONFIRMED |
| pnpm | `12.4.2`، با `minimumReleaseAge: 1440` | `package.json` (`packageManager`)، `pnpm-workspace.yaml` | CONFIRMED |
| TypeScript | `6.0.3` | `package.json` | CONFIRMED |
| Next.js / React | `16.3.8` / `19.3.0` | `apps/web/package.json` | CONFIRMED |
| Kysely / pg | `0.29.6` / `8.23.1` | `packages/core/package.json` | CONFIRMED |
| zod | `4.6.5` | `packages/core/package.json` | CONFIRMED |
| Biome / Vitest / dependency-cruiser | `2.5.15` / `5.0.3` / `18.4.0` | `package.json` | CONFIRMED |
| Playwright | به‌صورت devDependency در `apps/web` | `apps/web/package.json` | CONFIRMED |
| `pg-boss` | `12.35.1` (devDependency ریشه). در `apps`، `packages` و `tools` هیچ import ندارد و احتمالاً از SPIKE-05 مانده است | `package.json`؛ جست‌وجوی import بی‌نتیجه | INFERRED |

---

## ۴. وابستگی‌های اجرایی

| پکیج | نسخه | محل | کاربرد | برچسب |
|---|---|---|---|---|
| `@supabase/ssr`، `@supabase/supabase-js` | `0.12.7`، `2.117.2` | web | نشست و Auth (کوکی، `getClaims`) | CONFIRMED |
| `@vercel/blob` | `2.8.0` | core | ذخیرهٔ فایل خصوصی، presigned URL، compose | CONFIRMED |
| `ts-fsrs` | `5.4.2` | core | زمان‌بندی مرور FSRS | CONFIRMED |
| `ffmpeg-static` | `5.3.0` | web، ops-cli | تأیید صوت، برش ۵ دقیقه‌ای برای STT، decode صدا برای تحلیل گوینده | CONFIRMED |
| `sherpa-onnx-node` | `1.13.8` | web | diarization و embedding گوینده (pyannote-3 و WeSpeaker) | CONFIRMED |
| `sharp` | `0.35.5` | web، core | آماده‌سازی عکس (چرخش، کوچک‌سازی، JPEG) | CONFIRMED |
| `pdfjs-dist`، `@napi-rs/canvas` | `6.4.299`، `1.0.10` | web، core | استخراج متن PDF و render صفحه برای vision | CONFIRMED |
| `web-push` | `3.6.7` | web | اعلان Push (VAPID) | CONFIRMED |
| `nodemailer` | `10.0.15` | core | ارسال ایمیل از طریق Gmail. Resend هم گزینهٔ دیگر است | CONFIRMED |
| `parse5` | `8.0.1` | core | پردازش امن HTML (بدون اجرا) | INFERRED |
| `fflate` | `0.8.3` | core | فشرده‌سازی، احتمالاً برای خروجی Anki/HTML | INFERRED |

---

## ۵. زیرساخت و سرویس‌های بیرونی

| جزء | نقش | شاهد | برچسب |
|---|---|---|---|
| Vercel Functions | میزبان همهٔ صفحه‌ها، API و runner. سقف runner برابر `maxDuration = 800` ثانیه است | `apps/web/src/app/api/jobs/run/route.ts:7`، `apps/web/src/server/jobs.ts:52` | CONFIRMED |
| Vercel Cron | هر دقیقه `GET /api/jobs/run` را صدا می‌زند | `apps/web/vercel.json` | CONFIRMED |
| Supabase Postgres | منبع حقیقت و صف Job. اتصال با `DATABASE_URL` برقرار می‌شود و pool هر instance حداکثر ۳ اتصال دارد. اتصال از طریق Supavisor در حالت transaction است (ADR-0003) | `apps/web/src/server/db.ts:9`، [ADR-0003](../adr/0003-job-queue.md) | CONFIRMED |
| Supabase Auth | نشست کوکی و OAuth. به گزارش CLAUDE.md، Google در پروژهٔ ابری غیرفعال است | `apps/web/src/proxy.ts:55`، `apps/web/src/server/auth/` | CONFIRMED (کد)، UNKNOWN (وضعیت ابری) |
| Vercel Blob | همهٔ فایل‌ها `access: "private"` هستند. مرورگر با presigned URL مستقیم آپلود و دانلود می‌کند | `packages/core/src/plt/storage-vercel-blob.ts:84`، `:106` | CONFIRMED |
| OpenRouter | تنها provider هوش مصنوعی: `chat/completions` (structured و vision)، `audio/transcriptions` و TTS | `apps/web/src/server/ai.ts:5`، `packages/core/src/aip/openrouter.ts:108` | CONFIRMED |
| ایمیل | `RECALINO_EMAIL_PROVIDER` دو مقدار `resend` (پیش‌فرض) یا `gmail` می‌پذیرد | `packages/core/src/support/provider.ts:96` | CONFIRMED |
| Web Push | Service Worker فقط رویدادهای `push` و `notificationclick` را دارد | `apps/web/public/sw.js:9`، `:29` | CONFIRMED |
| GitHub Actions | CI روی push و PR به `main` و اجرای دستی | `.github/workflows/ci.yml:14` | CONFIRMED |
| **ناموجود** | Supabase Edge Functions، Supabase Storage، Realtime/WebSocket، broker پیام، worker جدا از Vercel، APM یا سرویس هشدار بیرونی | جست‌وجوی مخزن (`storage.from(`، `channel(`، `EventSource`، `WebSocket`) بی‌نتیجه بود | CONFIRMED (نبود در کد) |

---

## ۶. پیکربندی و نام متغیرهای محیطی

نام‌ها از `.env.example` آمده‌اند. `tools/env-example.test.ts` اگر کد نامی بخواند که در این فایل نیست، شکست می‌خورد (`apps/web/AGENTS.md`). **مقدار production هیچ‌کدام در مخزن نیست: UNKNOWN.**

| گروه | نام‌ها |
|---|---|
| دیتابیس و پلتفرم | `DATABASE_URL`، `PLT_SETTINGS_JSON`، `RATE_LIMIT_IP_KEY`، `CRON_SECRET`، `RECALINO_HEALTH_JSON` |
| Auth | `SUPABASE_URL`، `SUPABASE_PUBLISHABLE_KEY`، `SUPABASE_SECRET_KEY`، `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`، `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`، `ACC_SETTINGS_JSON` |
| هوش مصنوعی | `OPENROUTER_API_KEY`، `OPENROUTER_SETTINGS_JSON` |
| صدا | `VOICE_SETTINGS_JSON`، `VOICE_SEGMENTATION_MODEL_PATH`، `VOICE_EMBEDDING_MODEL_PATH`، `RECALINO_PROVISION_VOICE_MODELS` |
| ضبط (kill switch) | `RECALINO_CAPTURE_EARLY_UPLOAD`، `RECALINO_CAPTURE_EARLY_TRANSCRIPTION`، `RECALINO_CAPTURE_DIAGNOSTICS` |
| فایل و خروجی | `BLOB_STORE_ID`، `BLOB_READ_WRITE_TOKEN`، `RECALINO_MEDIA_SETTINGS_JSON`، `RECALINO_EXPORT_SETTINGS_JSON`، `PDF_RENDER_SETTINGS_JSON` |
| پشتیبان | `RECALINO_BACKUP_KEY_ID`، `RECALINO_BACKUP_KEY_BASE64`، `RECALINO_BACKUP_RETENTION_JSON` |
| ایمیل و اعلان | `RECALINO_EMAIL_PROVIDER`، `RECALINO_EMAIL_FROM`، `RECALINO_EMAIL_REPLY_TO`، `RESEND_API_KEY`، `RECALINO_GMAIL_USER`، `RECALINO_GMAIL_APP_PASSWORD`، `RECALINO_WEB_PUSH_PUBLIC_KEY`، `RECALINO_WEB_PUSH_PRIVATE_KEY`، `RECALINO_WEB_PUSH_SUBJECT`، `RECALINO_PUBLIC_APP_URL` |
| پایلوت و UI | `PILOT_OPERATOR_EMAIL`، `PILOT_OPERATOR_NAME`، `RECALINO_UI_PREVIEW`، `RECALINO_DEV_UI`، `RECALINO_ALLOW_DRAFT_LEGAL`، `RECALINO_FUNCTION_SIZE_LIMIT_MB` |

**پیش‌فرض‌های provider در مخزن** (`config/openrouter-defaults.json`، غیرمحرمانه). اینکه production همین‌ها را دارد **UNKNOWN** است:

| کلید | مقدار پیش‌فرض |
|---|---|
| `llmModel` | `google/gemini-3.8-flash`، با override به `maxOutputTokens: 32000`، `timeoutMs: 180000` و `structuredOutputMode: json_schema` |
| `sttModel` | `openai/whisper-large-v3-turbo` |
| `visionModel` و `voiceCorrectionModel` | `anthropic/claude-haiku-4.5` |
| `ttsModel` | `hexgrad/kokoro-82m` |
| `timeoutMs` (عمومی) | `90000` |
| `maxInputCharacters` / `maxOutputTokens` (عمومی) | `120000` / `6144` |
| `lessonQuality` | `lesson-quality-1`، با `sourceCoverage` و `structuredBoard` روشن. `classPartMinutes`، `learnerMarks` و `boardVisionModel` تعریف نشده‌اند |
| `audioUrlSupported` | `false`، یعنی صوت به‌صورت base64 در بدنهٔ درخواست فرستاده می‌شود |

---

## ۷. Schema دیتابیس

- **۵۶ migration** در بازهٔ 2026-09-30 (`20260930175238_baseline`) تا 2026-10-20 (`20261020120000_proc_automatic_session_learner_request`). **CONFIRMED**
- **۱۹ schema** و **۸۵ جدول** که با `create table` ساخته شده‌اند. viewها، مثل `ops.admin_processing`، در این شمارش نیستند. **CONFIRMED**

| schema | جدول‌ها | نقش |
|---|---|---|
| `acc` | `user_account`، `consent`، `preference`، `learning_profile`، `learning_profile_history`، `signup_intent` | حساب، رضایت، پروفایل یادگیری |
| `org` | `course`، `unit`، `class_session`، `deletion_request`، `outbox` | دوره، واحد، جلسه |
| `src` | `asset`، `session_source`، `source_snapshot`، `content_version`، `upload_session`، `upload_part`، `audio_upload`، `audio_upload_part`، `input_contract`، `notice_acceptance`، `outbox` | منبع، آپلود چندبخشی، صوت موقت، قرارداد ورودی |
| `proc` | `processing_run`، `run_step`، `provider_attempt`، `automatic_session`، `temporary_object`، `foreground_gap` | Run پردازش، checkpoint، تلاش‌های پولی، intent «Process this session» |
| `lkm` | `knowledge_version` | مدل دانشی نسخه‌دار (منبع حقیقت جزوه) |
| `note` | `notebook`، `revision`، `outbox` | جزوهٔ منتشرشده و نسخه‌ها |
| `card` | `card`، `learning_item`، `proposal`، `revision`، `session_link` | کارت و پیشنهاد تغییر |
| `srs` | `card_state`، `review_event`، `review_undo`، `settings` | وضعیت FSRS و رخدادهای مرور |
| `voc` | `profile`، `sample_object`، `analysis`، `enrollment_request`، `feedback` | نمونهٔ صدا و تحلیل گوینده |
| `media` | `asset` | صوت TTS تلفظ |
| `quota` | `entitlement`، `reservation`، `ledger`، `cost_hold`، `cost_policy`، `provider_cost`، `allocation_change`، `pilot_revision` | سهمیه و هزینه |
| `plt` | `job`، `job_step`، `idempotency_key`، `storage_object`، `audit_event`، `security_event`، `rate_limit_bucket`، `notification`، `push_subscription`، `push_delivery`، `admin_owner` | زیرساخت مشترک |
| `priv` | `deletion_request`، `cleanup_step` | حذف داده |
| `ops` | `admin_operation`، `admin_preference`، `admin_request`، `database_backup`، `deletion_journal`، `task_preference` | پنل مالک و پشتیبان |
| `support` | `thread`، `message`، `activity`، `email_draft`، `email_outbox`، `reply_draft`، `template_revision` | پشتیبانی و ایمیل |
| `pers` | `item_feedback` | بازخورد آیتم |
| `aip` | `estimate_rate_revision` | نرخ برآورد هزینه |
| `anki`، `html` | `export_artifact` | خروجی Anki و HTML (فقط Export) |

**امنیت دیتابیس:**

- RLS روی جدول‌ها روشن است، ولی **هیچ `create policy`** در migrationها وجود ندارد.
- نقش اپ `recalino_app` با `bypassrls` ساخته می‌شود (`supabase/migrations/20260930175238_baseline.sql:11`). دسترسی `anon` و `authenticated` لغو شده است (`supabase/migrations/20261004044059_lkm_processing.sql:78` و مشابه‌ها).
- پس کنترل دسترسی سطر کاملاً در کد اپ است. **CONFIRMED** (ر.ک. [ADR-0002](../adr/0002-data-access-and-migrations.md) بند ۶).

---

## ۸. سطح API

- **۶۹ route handler** دارد که همه در `apps/web/src/server/routes.ts` ثبت شده‌اند.
- سطح دسترسی: ۶۳ `learner`، ۴ `public`، ۱ `admin`، ۱ `system`. **CONFIRMED**
- Idempotency: ۱ route با `idempotency: "required"` و ۲ route با `"handler"` در متادیتا. ۲۷ فراخوانی `idempotencyKey(request)` در ۱۵ ماژول handler وجود دارد. دست‌کم ۱۲ قید `unique(... operation_key)` در migrationها هست، به‌علاوهٔ قیدهای درون‌خطی مثل `operation_key text not null unique` در `proc.provider_attempt`. **CONFIRMED**

| گروه | routeهای نمونه | نقش |
|---|---|---|
| جلسه و یادگیری | `/api/classes`، `/api/classes/[id]`، `/api/classes/[id]/learning`، `/api/classes/[id]/processing`، `/api/classes/[id]/estimate`، `/api/runs/[id]` | جلسه، «Process this session»، Run، برآورد |
| ضبط | `/api/classes/[id]/capture` (lease)، `/api/recordings`، `/api/recordings/diagnostics`، `/api/sources/[id]/audio/staged` | ضبط داخل اپ و آپلود زودهنگام |
| منبع و آپلود | `/api/sources`، `/api/sources/contract`، `/api/sources/uploads/[id]`، `/api/sources/uploads/[id]/parts/[index]`، `/api/sources/uploads/[id]/complete`، `/api/sources/[id]/audio`، `/api/sources/[id]/read`، `/api/sources/[id]/unlock` | آپلود چندبخشی و دسترسی به منبع |
| جزوه و کارت | `/api/classes/[id]/notes`، `/api/notes/[id]`، `/api/classes/[id]/cards`، `/api/cards/[id]`، `/api/cards/[id]/proposals`، `/api/cards/[id]/media` | جزوه، نسخه‌ها، کارت، پیشنهاد |
| مرور | `/api/review`، `/api/review/events`، `/api/review/events/[id]/undo`، `/api/review/settings` | صف و رخداد FSRS |
| صدا | `/api/me/voice`، `/api/classes/[id]/voice` | نمونهٔ صدا و تأیید گوینده |
| کیفیت درس | `/api/classes/[id]/lesson-review` | بازبینی مشورتی درس به درخواست کاربر |
| سیستم | `/api/jobs/run` (`system`، با Bearer `CRON_SECRET`)، `/api/health` | runner و سلامت |
| دیگر | `/api/quota`، `/api/privacy/*`، `/api/support/*`، `/api/notifications/*`، `/api/exports/*`، `/api/admin`، `/auth/*` | سهمیه، حریم خصوصی، پشتیبانی، اعلان، خروجی، پنل مالک |

---

## ۹. صفحه‌ها

**۵۰ صفحه** (`page.tsx`) دارد. مسیر اصلی زبان‌آموز این‌هاست: `/today`، `/sessions`، `/sessions/new` و زیرصفحه‌های `/sessions/[id]`:

- `record`
- `sources`
- `estimate`
- `processing`
- `voice`
- `notes`
- `notes/versions`
- `cards`
- `export`
- `options`

یعنی ۱۰ زیرصفحه به‌علاوهٔ صفحهٔ اصلی جلسه. صفحه‌های دیگر:

- `/review`
- `/recordings`
- `/courses/**`
- `/me/**`
- `/help/**`
- `/admin`

**CONFIRMED** (`find apps/web/src/app -name page.tsx`).

---

## ۱۰. Jobهای پس‌زمینه

۳۱ نوع Job روی جدول `plt.job` تعریف شده است ([ADR-0003](../adr/0003-job-queue.md)). همه از `jobDefinitions` و `periodicJobs` در `apps/web/src/server/jobs.ts:119` و `:138` ثبت می‌شوند. **CONFIRMED**

| kind | ماهیت | نقش |
|---|---|---|
| `src.verify_upload` | enqueue | ادغام قطعه‌ها و تأیید فایل آپلودی (`packages/core/src/src/jobs.ts:65`) |
| `src.verify_audio` | enqueue | تأیید صوت موقت کلاس (`packages/core/src/src/jobs.ts:35`) |
| `src.verify_staged_audio` | enqueue | تأیید قطعهٔ آپلودشده حین ضبط (D60) |
| `proc.capture_transcription` | enqueue | رونویسی پس‌زمینهٔ قطعه‌ها حین ضبط (D61، `packages/core/src/proc/capture-transcription.ts:227`) |
| `proc.automatic_learning` | enqueue و دوره‌ای | همگام‌سازی intent جلسه و ساخت Run (`apps/web/src/server/automatic-learning.ts:559`) |
| `proc.process` | enqueue (ادامه‌دار) | Run پردازش کلاس (`packages/core/src/proc/contracts.ts:73`) |
| `proc.voice_analysis` | enqueue | تحلیل صدای جلسه |
| `proc.notify_completed` | enqueue | اعلان پایان پردازش |
| `media.tts` | enqueue | ساخت صوت تلفظ |
| `eval.lesson_review` | enqueue | بازبینی مشورتی درس |
| `anki.build_export`، `html.build_export` | enqueue | خروجی |
| `priv.cleanup` | enqueue | حذف داده |
| `plt.deliver_push` | enqueue | ارسال Push |
| `proc.reconcile_ended_jobs`، `proc.automatic_reconcile`، `proc.expire_uploads` | دوره‌ای | بستن Runهای بی‌Job، بازیابی intent، انقضای آپلود |
| `src.maintenance`، `src.expire_audio` | دوره‌ای | آزادسازی hold، حذف صوت موقت (D29) |
| `plt.reconcile_storage`، `plt.purge_*` (۴ نوع)، `acc.purge_signup_intents`، `priv.anonymise_deleted_actors`، `voc.cleanup`، `anki.cleanup_exports`، `html.cleanup_exports` | دوره‌ای | نگهداری و پاک‌سازی |
| `ops.health_check` | دوره‌ای (هر ساعت) | سیگنال‌های سلامت (`packages/core/src/ops/health.ts:173`) |
| `ops.backup_retention` | دوره‌ای | نگهداری پشتیبان |

---

## ۱۱. آزمون و CI

- **۴۷۴ فایل `*.test.ts`** دارد که **۱۶۳ تا** `*.int.test.ts` هستند و Supabase محلی لازم دارند. **۵۵ فایل** هم در `apps/web/e2e` هست. **CONFIRMED** (شمارش فایل، بدون اجرا)
- برای هر route زبان‌آموز یک آزمون cross-account در `apps/web/src/server/cross-account/` لازم است. آزمون پوشش route این را بررسی می‌کند (`apps/web/AGENTS.md`). **CONFIRMED**
- CI از `.github/workflows/ci.yml` اجرا می‌شود:
  - job `verify` (خط ۵۲) این‌ها را اجرا می‌کند: `lint`، `typecheck`، `check:boundaries`، `test:unit`، Supabase محلی، `test:int`، `build` و `check:client-bundle`.
  - job `e2e` (خط ۱۰۴) Playwright را اجرا می‌کند.
  - triggerها: push و PR به `main` و `workflow_dispatch`.

  **CONFIRMED**

---

## ۱۲. اسناد مرجعی که با کد تطبیق داده شدند

- [PRD v0.3](../../PRD_Recalino_FA_v0.3.md)، بخش ۴.۲ (خارج از دامنه) و ۱۰.۳ (گویندگان)
- [PRODUCT_DECISIONS_LOG](../PRODUCT_DECISIONS_LOG.md)، تا D110
- [ADR-0001](../adr/0001-stack-and-hosting.md)، [ADR-0002](../adr/0002-data-access-and-migrations.md)، [ADR-0003](../adr/0003-job-queue.md)
- [بررسی علت پنج مشکل، 2026-10-12](../plans/FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)
- [ممیزی 2026-10-18](../audit/2026-10-18-project-audit.md) و [fix tracker](../audit/2026-10-18-fix-tracker.md)

هر ادعای این اسناد که با کد فعلی تطبیق داده نشد، در ۰۲ تا ۰۵ با برچسب مناسب آمده است.
