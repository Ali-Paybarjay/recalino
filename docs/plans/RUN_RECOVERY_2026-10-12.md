# فهرست بازیابی Runهای ناتمام کلاس — 2026-10-12

وضعیت: **کامل.** دادهٔ Q1 تا Q4 در 2026-10-12 ساعت 22:40 UTC و دادهٔ Q5 و Q6 در 2026-10-13 ساعت 07:01 UTC خوانده شده است. مدیر کار SQL را فقط‌خواندنی اجرا کرد.

## ۱. خلاصه

- ۲۹ Run کلاس وجود دارد: ۲ `ready` و ۲۷ ناتمام. این ۲۷ Run در ۶ جلسه‌اند. ۲ جلسهٔ دیگر (`65915be0` و `e4b052d6`) `ready` هستند.
- **فقط دو جلسه هیچ جزوه‌ای ندارند:** `572dda3f` و `f36401c8`. هر دو به رگرسیون D59 در شروع آپلود صوت خورده‌اند (بخش ۳.۲ [بررسی علت](FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)).
  - پس از هات‌فیکس، Retry کافی است.
  - تا پایان دورهٔ فعلی سهمیه (2026-11-04) از سهمیه چیزی کم نمی‌شود.
  - دستگاهی که فایل روی آن اضافه شده لازم است.
- **چهار جلسه جزوهٔ ناقص (`partial_ready`) از دورهٔ Haiku دارند:** `8db9bfa2`، `b340e478`، `cf0c11ba` و `d038a661`.
  - Retry برای این‌ها لازم نیست، چون جزوه دارند.
  - ساخت دوبارهٔ اختیاری پس از انتشار کامل، برای هر جلسه ۱ واحد `regeneration` می‌گیرد.
- **۲۱ Run قدیمی** در جلسه‌هایی هستند که بعداً Run موفق گرفته‌اند. اقدامی لازم ندارند.
- **غیرقابل بازیابی:** صوتی که در ضبط 2026-10-12 (`e4b052d6`) اصلاً ضبط نشد، حدود ۵۲ دقیقه از ۷۷٫۶ دقیقهٔ اعلام‌شده. هیچ نسخه‌ای از آن، نه روی دستگاه و نه روی سرور، وجود ندارد.

## ۲. هدف و روش

- **هدف:** مالک محصول پس از انتشار اصلاح‌ها (هات‌فیکس D59 و D60 تا D66) بداند کدام جلسه را Retry کند، کی، و هر Retry چه هزینه‌ای از سهمیه و هزینهٔ AI دارد.
- **داده:** فقط `select` فقط‌خواندنی روی پروژهٔ `twowhuzhvyuzjrpraikm`. هیچ متن کلاس، transcript، `blocks` یا نام فایل خوانده نشد؛ فقط پیشوند ۸ نویسه‌ای شناسه‌ها، وضعیت، کد دلیل، تعداد، مدت، مبلغ و زمان.
- **قواعد تصمیم:** از کد خوانده شده‌اند (بخش ۶). شاخه‌های در جریان (`feat/hotfix-d59-audio-start` @ `94c3580`، `feat/upload-reliability` @ `0f2630b`، `feat/session-navigation` @ `10337c3`، `feat/lesson-quality` @ `789296d`) هم فقط برای همین پرسش‌ها بررسی شدند.

## SQL

همهٔ پرس‌وجوها فقط‌خواندنی‌اند. Q1 تا Q4 در نوبت اول اجرا شدند.

```sql
-- Q1: count of class runs by state (count check, step 4)
select state, count(*) as runs
from proc.processing_run
where kind = 'class'
group by state
order by state;

-- Q2: every class run that is not ready, with failure detail and recovery context
with r as (
  select p.*,
         row_number() over (partition by p.session_id order by p.created_at desc, p.id desc) as rn
  from proc.processing_run p
  where p.kind = 'class'
)
select left(r.id::text, 8)          as run,
       left(r.session_id::text, 8)  as session,
       left(r.user_id::text, 8)     as usr,
       r.state, r.last_error,
       r.created_at, r.updated_at, r.finished_at,
       (r.rn = 1)                   as is_latest,
       r.settings->'provider'->>'version'  as settings_version,
       r.settings->'provider'->>'llmModel' as llm_model,
       r.requested_amounts,
       (select string_agg(k || 'x' || n, ',' order by k)
          from (select s->>'kind' as k, count(*) as n
                  from jsonb_array_elements(r.input_snapshot->'sources') s group by 1) x) as source_kinds,
       (select round(sum((s->>'durationMs')::numeric) / 60000, 1)
          from jsonb_array_elements(r.input_snapshot->'sources') s
         where s->>'kind' = 'audio') as audio_min,
       (select count(*)
          from jsonb_array_elements(r.input_snapshot->'sources') s
         where s->>'kind' = 'audio' and s->>'contentVersionId' is null) as audio_untranscribed_in_snapshot,
       fa.step as fail_step, fa.provider as fail_provider, fa.model as fail_model,
       fa.error_code as fail_code, fa.attempts,
       exists (select 1 from proc.processing_run q
                where q.session_id = r.session_id and q.kind = 'class'
                  and q.state in ('ready', 'partial_ready') and q.created_at > r.created_at) as later_success,
       exists (select 1 from proc.processing_run q
                where q.session_id = r.session_id and q.kind = 'class'
                  and q.output_version_id is not null) as session_has_output,
       (cs.deleted_at is not null) as session_deleted,
       a.state as auto_state, a.last_error as auto_error, (a.run_id = r.id) as auto_points_here
from r
join org.class_session cs on cs.id = r.session_id
left join proc.automatic_session a on a.session_id = r.session_id
left join lateral (
  select pa.step, pa.provider, pa.model, pa.error_code, count(*) over () as attempts
  from proc.provider_attempt pa
  where pa.run_id = r.id
  order by (pa.error_code is not null) desc, pa.started_at desc
  limit 1
) fa on true
where r.state <> 'ready'
order by r.session_id, r.created_at;

-- Q3: for each class whose latest run is not ready: current sources, extraction,
--     server copy, last audio upload and D59 paid status (by content, no text)
with latest as (
  select distinct on (session_id) session_id, user_id, id, state
  from proc.processing_run
  where kind = 'class'
  order by session_id, created_at desc, id desc
), ent as (
  select user_id, id from quota.entitlement
  where closed_at is null and now() between starts_at and ends_at
), paid as (
  select rs.output->>'sha256' as sha, rs.output->>'entitlementId' as ent, p.session_id, p.user_id
  from proc.run_step rs
  join proc.processing_run p on p.id = rs.run_id
  where rs.step like 'charge:%'
)
select left(l.session_id::text, 8) as session, l.state as latest_state,
       ss.role, a.kind, left(a.sha256, 8) as sha8,
       round(a.duration_ms / 60000.0, 1) as dur_min, a.page_count,
       ss.selected, ss.selected_content_version_id is not null as has_extraction,
       a.original_object_id is not null as server_original_present, a.original_deleted_at,
       (select au.state from src.audio_upload au
         where au.asset_id = a.id order by au.created_at desc limit 1) as last_audio_upload_state,
       exists (select 1 from paid where paid.session_id = l.session_id and paid.sha = a.sha256) as paid_in_this_class,
       exists (select 1 from paid join ent on ent.user_id = paid.user_id
                where paid.user_id = l.user_id and paid.sha = a.sha256
                  and paid.ent = ent.id::text) as paid_this_period
from latest l
join src.session_source ss on ss.session_id = l.session_id and ss.active
join src.asset a on a.id = ss.asset_id
where l.state <> 'ready'
order by l.session_id, ss.created_at;

-- Q4: active allowance period and ledger totals per dimension (can a Retry be afforded)
select left(e.user_id::text, 8) as usr, left(e.id::text, 8) as ent, e.starts_at, e.ends_at,
       l.dimension, sum(l.amount) as amount, sum(l.balance_delta) as balance_delta
from quota.entitlement e
left join quota.ledger l on l.entitlement_id = e.id
where e.closed_at is null and now() between e.starts_at and e.ends_at
group by 1, 2, 3, 4, 5
order by 1, 5;
```

نوبت دوم، برای سقف هزینهٔ AI. سقف جلسه همهٔ هزینهٔ عمر همان جلسه را می‌شمارد (D56). سقف کاربر/ماه و پروژه/ماه هم از ابتدای ماه UTC شمرده می‌شوند (`packages/core/src/quota/costs.ts:117`).

```sql
-- Q5: AI cost already recorded per class (session cap 2 USD; a Gemini call needs spent+held <= 1.24)
select left(session_id::text, 8) as session, currency, count(*) as cost_rows,
       round(sum(coalesce(amount_micros, estimated_micros)) / 1e6, 3) as usd
from quota.provider_cost
where session_id is not null
group by 1, 2
order by 1;

-- Q6: this month's totals (user cap 8 USD, project 50 USD) and today's (project 5 USD), plus open holds
select currency,
       round(sum(coalesce(amount_micros, estimated_micros))
             filter (where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc') / 1e6, 3) as month_usd,
       round(sum(coalesce(amount_micros, estimated_micros))
             filter (where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') / 1e6, 3) as today_usd
from quota.provider_cost
group by 1;
select currency, count(*) as open_holds, round(sum(maximum_micros) / 1e6, 3) as held_usd
from quota.cost_hold
where closed_at is null
group by 1;
```

پرس‌وجوی اختیاری Q7 اجرا نشده است. حکم بخش ۶.۴ دربارهٔ Runهای پیش از D59 را مستقیم تأیید می‌کند (پرسش ۴).

```sql
-- Q7 (optional, not run): did each published pre-D59 run settle its full reservation
--     (then D59 counts its whole snapshot as paid)?
select left(p.id::text, 8) as run, left(p.session_id::text, 8) as session, p.state,
       p.requested_amounts->'audio' as req_audio, p.requested_amounts->'document' as req_document,
       r.settled_amounts->'audio' as settled_audio, r.settled_amounts->'document' as settled_document,
       r.closed_at
from proc.processing_run p
join quota.reservation r on r.id = p.reservation_id
where p.kind = 'class' and p.state in ('ready', 'partial_ready')
order by p.created_at;
```

## ۳. شمارش و جدول همهٔ Runها

### ۳.۱ بررسی شمارش

| وضعیت | پایگاه داده (Q1) | جدول ۳.۲ و ۴ |
|---|---:|---:|
| `failed` | 17 | 17 |
| `needs_input` | 5 | 5 |
| `partial_ready` | 5 | 5 |
| `ready` | 2 | 2 (فقط در جدول ۴) |
| **جمع** | **29** | **29** |

- شمارش مدیر کار در 2026-10-12 «۴ `needs_input` و ۱ `awaiting_upload`» بود. Run `fbc79e72` در 2026-10-12 ساعت 22:30:13 UTC منقضی شد و به `needs_input` / `audio_upload_rejected` رسید. Run `awaiting_upload` دیگری نیست.
- کدهای ۱۷ Run `failed` با بخش ۳.۱ بررسی علت یکی‌اند: ۶ × `provider_http_400`، ۶ × `provider_schema_invalid`، ۲ × `output_study_target_unsupported`، ۱ × `provider_output_truncated`، ۱ × `output_study_sentence_mismatch` و ۱ × `quota_insufficient`.

### ۳.۲ جدول ۲۷ Run ناتمام

همهٔ Runها متعلق به کاربر `f3d033dc` هستند. هیچ جلسه‌ای حذف نشده است.

راهنمای ستون‌ها:

- **منبع:** `a1` یعنی یک فایل صوتی و `i6` یعنی شش عکس.
- **مدل · تنظیمات:** `haiku` همان `anthropic/claude-haiku-4.5` است و `gemini` همان `google/gemini-3.8-flash`. پسوند تنظیمات کوتاه‌شدهٔ `openrouter-2026-10-..` است؛ مثلاً `04-2` یعنی `openrouter-2026-10-04-2`.
- **گام و کد:** آخرین گام provider که خطا داد، و اگر خطایی نبود آخرین گام. عدد داخل پرانتز تعداد تلاش‌های provider در همان Run است.
- **بعداً موفق:** Run بعدی همان جلسه `ready` یا `partial_ready` شده است.

| # | Run | جلسه | وضعیت | کد دلیل | گام و کد provider | مدل · تنظیمات | منبع | ساخت (UTC) | بعداً موفق | گروه (بخش ۵) |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `c8f92d7e` | `572dda3f` | needs_input | `audio_upload_rejected` | — (آپلود شروع نشد) | gemini · 10-1 | a1، 127.9′ | 2026-10-11 15:45 | خیر | الف |
| 2 | `7e7ebae1` | `8db9bfa2` | failed | `provider_schema_invalid` | knowledge:repair، `provider_schema_invalid` (34) | haiku · 07-2 | a1+i6 | 2026-10-07 23:23 | بله | د |
| 3 | `63f2a379` | `8db9bfa2` | failed | `provider_schema_invalid` | knowledge:repair، `provider_schema_invalid` (3) | haiku · 07-2 | a1+i6 | 2026-10-07 23:45 | بله | د |
| 4 | `bf4c156f` | `8db9bfa2` | failed | `output_study_target_unsupported` | knowledge:repair (1) | haiku · 07-2 | a1+i6 | 2026-10-07 23:48 | بله | د |
| 5 | `084e775d` | `8db9bfa2` | failed | `output_study_target_unsupported` | knowledge:repair (1) | haiku · 07-2 | a1+i6 | 2026-10-08 01:38 | بله | د |
| 6 | `97584daf` | `8db9bfa2` | failed | `provider_schema_invalid` | knowledge:repair، `provider_schema_invalid` (1) | haiku · 07-2 | a1+i6 | 2026-10-08 07:37 | بله | د |
| 7 | `e9ae13db` | `8db9bfa2` | failed | `provider_schema_invalid` | knowledge:repair، `provider_schema_invalid` (1) | haiku · 07-2 | a1+i6 | 2026-10-08 08:25 | بله | د |
| 8 | `464f7d63` | `8db9bfa2` | failed | `quota_insufficient` | — (پیش از فراخوان؛ پیش از D59) | haiku · 07-2 | a1+i6 | 2026-10-08 09:07 | بله | د |
| 9 | `1cd9e926` | `8db9bfa2` | partial_ready | — | knowledge:repair (1) | haiku · 07-2 | a1+i6 | 2026-10-08 11:30 | آخرین Run | د |
| 10 | `d63e6de2` | `b340e478` | failed | `output_study_sentence_mismatch` | knowledge:repair (28) | haiku · 08-1 | a1 | 2026-10-10 01:24 | بله | د |
| 11 | `344355cb` | `b340e478` | partial_ready | — | voice:corrections (3) | haiku · 08-1 | a1 | 2026-10-10 10:53 | آخرین Run | د |
| 12 | `7cd5cb19` | `cf0c11ba` | needs_input | `audio_upload_rejected` | — (انقضای زودهنگام، رفع‌شده 2026-10-06) | haiku · 04-2 | a1+i6 | 2026-10-05 22:52 | بله | د |
| 13 | `808049b8` | `cf0c11ba` | needs_input | `audio_upload_rejected` | — (همان) | haiku · 04-2 | a1+i6 | 2026-10-05 22:57 | بله | د |
| 14 | `cc0328f5` | `cf0c11ba` | needs_input | `new_confirmation_required` | — | haiku · 04-2 | a1+i6 | 2026-10-06 00:31 | بله | د |
| 15 | `8f488ea2` | `cf0c11ba` | partial_ready | — | knowledge، `provider_schema_invalid` (38) | haiku · 04-2 | a1+i6 | 2026-10-06 12:30 | بله | د |
| 16 | `16071e1b` | `cf0c11ba` | partial_ready | — | knowledge:repair (2) | haiku · 04-2 | a1+i6 | 2026-10-06 14:52 | آخرین Run | ب (اختیاری) |
| 17 | `65467729` | `d038a661` | failed | `provider_http_400` | knowledge، `provider_http_400` (5) | haiku · 04-2 | a1 | 2026-10-07 02:46 | بله | د |
| 18 | `fb0efb2b` | `d038a661` | failed | `provider_http_400` | knowledge، `provider_http_400` (6) | haiku · 04-2 | a1+i5 | 2026-10-07 02:51 | بله | د |
| 19 | `b646f1bf` | `d038a661` | failed | `provider_http_400` | knowledge، `provider_http_400` (1) | haiku · 04-2 | a1+i5 | 2026-10-07 02:53 | بله | د |
| 20 | `1b30fec6` | `d038a661` | failed | `provider_http_400` | knowledge، `provider_http_400` (1) | haiku · 04-2 | a1+i5 | 2026-10-07 02:53 | بله | د |
| 21 | `c0a66add` | `d038a661` | failed | `provider_http_400` | knowledge، `provider_http_400` (1) | haiku · 04-2 | a1+i5 | 2026-10-07 02:54 | بله | د |
| 22 | `ee0cd7a2` | `d038a661` | failed | `provider_http_400` | knowledge، `provider_http_400` (1) | haiku · 04-2 | a1+i5 | 2026-10-07 10:01 | بله | د |
| 23 | `457e1ee1` | `d038a661` | failed | `provider_schema_invalid` | knowledge، `provider_schema_invalid` (1) | haiku · 04-2 | a1+i5 | 2026-10-07 10:26 | بله | د |
| 24 | `6f29121c` | `d038a661` | failed | `provider_schema_invalid` | knowledge:repair، `provider_schema_invalid` (2) | haiku · 04-2 | a1+i5 | 2026-10-07 10:48 | بله | د |
| 25 | `ffa10c33` | `d038a661` | failed | `provider_output_truncated` | knowledge، `provider_output_truncated` (1) | haiku · 04-2 | a1+i5 | 2026-10-07 11:22 | بله | د |
| 26 | `1bb49275` | `d038a661` | partial_ready | — | knowledge:study-repair (1) | haiku · 04-2 | a1+i5 | 2026-10-07 11:57 | آخرین Run | ب (اختیاری) |
| 27 | `fbc79e72` | `f36401c8` | needs_input | `audio_upload_rejected` | — (آپلود شروع نشد) | gemini · 10-1 | a1، 127.9′ | 2026-10-11 22:28 | خیر | ب |

- **گروه‌ها:** الف یعنی پس از هات‌فیکس، ب یعنی پس از انتشار کامل، ج یعنی غیرقابل بازیابی و د یعنی بدون اقدام. شمار: الف ۱، ب ۳ (۱ لازم و ۲ اختیاری) و د ۲۳. گروه ج Runی از این جدول ندارد (بخش ۵.ج). جمع ۲۷ است.
- Retry همیشه برای کل جلسه است. پس «Retry یک Run قدیمی» معنایی جدا از ساخت دوبارهٔ همان جلسه ندارد (بخش ۶.۱).

## ۴. جلسه‌ها: وضعیت، Retry و هزینه

### ۴.۱ هر جلسه

| جلسه | Run | آخرین Run | جزوه | منبع‌های فعلی (همه انتخاب‌شده) | هزینهٔ AI ثبت‌شده (USD) | جای خالی سقف جلسه پیش از فراخوان Gemini (USD) | گروه |
|---|---:|---|---|---|---:|---:|---|
| `572dda3f` | 1 | `c8f92d7e` needs_input | ندارد | صوت `dceda622`، 127.9′؛ رونویسی ندارد و نسخهٔ سرور ندارد | 0 | 1.240 | الف |
| `f36401c8` | 1 | `fbc79e72` needs_input | ندارد | همان صوت `dceda622`، با همان وضعیت | 0 | 1.240 | ب |
| `cf0c11ba` | 5 | `16071e1b` partial_ready | دارد (Haiku) | صوت `dceda622` رونویسی‌شده + ۶ عکس استخراج‌شده | 0.366 | 0.874 | ب (اختیاری) |
| `d038a661` | 10 | `1bb49275` partial_ready | دارد (Haiku) | صوت `c0ca8342`، 18.9′، رونویسی‌شده + ۵ عکس استخراج‌شده | 0.311 | 0.929 | ب (اختیاری) |
| `8db9bfa2` | 8 | `1cd9e926` partial_ready | دارد (Haiku) | صوت `dceda622` + همان ۶ عکس `cf0c11ba` (checksum یکسان) | 0.751 | 0.489 | د |
| `b340e478` | 2 | `344355cb` partial_ready | دارد (Haiku) | صوت `dceda622` | 0.336 | 0.904 | د |
| `65915be0` | 1 | `cd320186` ready | دارد (Gemini) | ۱ عکس | 0.041 | — | د |
| `e4b052d6` | 1 | `199b3ce5` ready | دارد (Gemini) | ۶ قطعهٔ ضبط (25.5′ واقعی) + ۵ عکس | 0.089 | — | ج (بخش ضبط‌نشده) |

- **جای خالی سقف:** برابر است با 2 − 0.76 − هزینهٔ ثبت‌شده. در زمان خواندن هیچ hold بازی وجود نداشت (Q6).
- **هزینهٔ ماه:** هزینهٔ اکتبر کاربر 1.894 دلار از سقف ۸ دلار است، پس سقف ماه مانعی نیست.
- نسخهٔ سرور همهٔ صوت‌ها طبق D29 پاک شده است (`last_audio_upload_state = deleted`). نسخهٔ اصلی عکس‌ها روی سرور هست.

### ۴.۲ دو جلسهٔ بدون جزوه: `572dda3f` و `f36401c8`

- **Retry امروز در UI:**
  - دکمه دیده می‌شود: «Retry failed attempt» در کارت وضعیت جلسه، «Review and retry» در صفحهٔ processing، و «Retry saved audio upload» در صف آپلود.
  - پیش از هات‌فیکس همان چرخه تکرار می‌شود: Run تازه با صوت صفر ساخته می‌شود، شروع آپلود پاسخ 400 می‌گیرد، و Run پس از ۲۴ ساعت دوباره `audio_upload_rejected` می‌شود.
  - زدن دکمه ضرری ندارد، چون رزرو بی‌کسر آزاد می‌شود و هیچ فراخوان AI انجام نمی‌شود. فایده‌ای هم ندارد.
- **پس از هات‌فیکس (`94c3580`):**
  - شروع آپلود فقط باز بودن رزرو را می‌سنجد، پس Retry کار می‌کند.
  - پس از `feat/upload-reliability` هم `audio_upload_rejected` قابل Retry می‌ماند (`AUDIO_UPLOAD_RETRY_CODES`).
- **سهمیه:**
  - تا پایان دورهٔ `97bb030f` (2026-11-04)، صفر: ۰ دقیقه صوت، ۰ صفحه و ۰ `regeneration`، چون این جلسه‌ها جزوه ندارند.
  - پس از آن تاریخ، ۷۶۷۶ ثانیه (۱۲۸ دقیقه) صوت از دورهٔ تازه کسر می‌شود، چون این دو کلاس خودشان هرگز این صوت را منتشر نکرده‌اند (بخش ۶.۴).
- **هزینهٔ AI:** تخمین کمتر از ۰٫۳ دلار برای هر جلسه.
  - رونویسی ۱۲۸ دقیقه حدود ۲۶ فراخوان Whisper دارد، با hold حداکثر ۰٫۰۰۵ دلار برای هر کدام.
  - یک درس Gemini حدود ۰٫۰۲۲ تا ۰٫۰۲۴ دلار با بودجهٔ فعلی (D56) هزینه دارد. بررسی صدا هم به آن اضافه می‌شود.
  - مبنای مقایسه: کل پردازش `e4b052d6` با ۲۵٫۵ دقیقه صوت و ۵ عکس 0.089 دلار شد.
- **اصلاح لازم:** فقط هات‌فیکس D59. تنظیمات Gemini از 2026-10-10 در production است.
  - D62 جزوه را کامل‌تر می‌کند.
  - D63، با مقدار ۹۰ برای `classPartMinutes`، این کلاس ۱۲۸ دقیقه‌ای را در دو بخش ۶۴ دقیقه‌ای می‌سازد. هر دو فقط پس از انتشار کامل و تغییر تنظیمات اثر دارند.
  - تنظیمات هنگام ساخت Run در snapshot ثبت می‌شود (بخش ۶.۷).
- **دستگاه:** لازم است. نسخهٔ اصلی در IndexedDB همان دستگاه و مرورگری است که فایل روی آن اضافه شد.
  - اپ باید تا پایان آپلود در پیش‌زمینه بماند (D47). فایل ۱۱۹ مگابایتی قبلاً در ۶۶ تا ۱۲۵ ثانیه رسیده است.
  - اگر نسخهٔ محلی پاک شده باشد، می‌توان همان فایل را با «Change sources» دوباره اضافه کرد. checksum یکسان است، پس در همین دوره رایگان می‌ماند.

### ۴.۳ چهار جلسهٔ دارای جزوهٔ ناقص: `cf0c11ba`، `d038a661`، `8db9bfa2` و `b340e478`

- **Retry امروز در UI:**
  - وضعیت خودکار این جلسه‌ها «ready» است، پس کارت وضعیت دکمهٔ Retry ندارد.
  - صفحهٔ processing فقط وقتی دکمه دارد که انتخاب منبع عوض شده باشد.
  - صفحهٔ Notes ممکن است برای فایلی که در Run ناقص کامل استخراج نشده بود «Retry file N» نشان دهد.
  - در کد دکمهٔ مستقیمی برای «ساخت دوبارهٔ جزوه بدون تغییر منبع» نیست (پرسش ۱). شاخه‌های در جریان هم چنین دکمه‌ای اضافه نمی‌کنند.
- **سهمیه:** هر نسخهٔ تازه ۱ واحد `regeneration` می‌گیرد؛ ۱۹ واحد مانده است. صوت و صفحه کسر نمی‌شوند، چون Runهای قدیمی همین کلاس‌ها آن‌ها را پرداخت‌شده کرده‌اند (بخش ۶.۴). این پوشش به دوره وابسته نیست.
- **هزینهٔ AI:**
  - با بودجهٔ فعلی یک درس Gemini، حدود ۰٫۰۲ تا ۰٫۰۵ دلار. بودجهٔ D62 خروجی بیشتری دارد و عدد دقیقش در ارزیابی D62 سنجیده می‌شود.
  - برای صوت ۱۲۸ دقیقه‌ای با D63: دو بخش، و برای هر بخش حداکثر یک تولید دوباره. فراخوان‌ها پشت‌سرهم‌اند و هر کدام جدا با سقف جلسه سنجیده می‌شود.
  - جای خالی `cf0c11ba` (0.874) و `d038a661` (0.929) برای هزینهٔ معمول کافی است. `8db9bfa2` (0.489) کمترین جای خالی را دارد.
- **دستگاه:** برای ساخت دوبارهٔ جزوه لازم نیست، چون متن رونویسی و استخراج عکس‌ها روی سرور است.
  - فقط اگر «Retry file N» به یک فایل صوتی برسد، نسخهٔ سرور نیست. پیام `original_unavailable` می‌آید و دستگاه اصلی لازم می‌شود.
- **Haiku دوباره به کار نمی‌رود:** پاسخ‌های پولی Haiku در Retry با Gemini دوباره استفاده نمی‌شوند (بخش ۶.۶).

## ۵. چک‌لیست مالک محصول

### الف) پس از استقرار هات‌فیکس D59 در production

- [ ] **`572dda3f` را Retry کن.**
  - روی همان دستگاه و مرورگری که فایل ۱۲۸ دقیقه‌ای روی آن اضافه شد، جلسه را باز کن. در کارت وضعیت «Retry failed attempt» را بزن، یا در صفحهٔ processing «Review and retry» را.
  - اپ را تا پایان آپلود باز و در پیش‌زمینه نگه دار.
  - انتظار: آپلود، رونویسی، جزوه، بررسی صدا و سپس انتشار.
  - سهمیه: ۰ دقیقه صوت، ۰ صفحه و ۰ regeneration. اگر صفحهٔ processing عددی غیر از صفر نشان داد، تأیید نکن و گزارش بده.
  - هزینهٔ AI: تخمین کمتر از ۰٫۳ دلار.
  - این Retry آزمون پذیرش هات‌فیکس هم هست.
- [ ] **ترتیب را رعایت کن.** پیش از استقرار هات‌فیکس Retry نزن، چون همان چرخه تکرار می‌شود. پیش از Retry دو جلسهٔ بدون جزوه، کلاس‌های `8db9bfa2`، `b340e478` و `cf0c11ba` را حذف نکن. رایگان بودن صوت `dceda622` از Runهای همین کلاس‌ها می‌آید. طبق D59، حذف کلاس سابقهٔ پرداخت را هم پاک می‌کند.

### ب) پس از انتشار کامل (D60 تا D66) و تغییر تنظیمات D62

- [ ] **`f36401c8` را Retry کن،** به همان روش بخش الف.
  - جزوه با بودجهٔ D62 ساخته می‌شود. اگر `classPartMinutes` روشن شده باشد، در دو بخش ساخته می‌شود (D63).
  - سهمیه صفر است، به شرط اینکه Retry پیش از 2026-11-04 باشد.
  - اگر انتشار کامل پیش از 2026-11-04 نرسد، این جلسه را هم پس از هات‌فیکس Retry کن تا رایگان بماند.
- [ ] **اختیاری: برای دیدن اثر D62 روی کلاس واقعی،** `cf0c11ba` (۱۲۸ دقیقه + ۶ عکس) و `d038a661` (۱۹ دقیقه + ۵ عکس) را دوباره بساز. جزوهٔ فعلی `d038a661` از صوت استفاده نکرده است.
  - هزینه: هر کدام ۱ regeneration و هزینهٔ AI کمتر از چند دهم دلار. پیش از هر نسخهٔ تازه، جزوهٔ فعلی Haiku طبق PRD-CORE-05 در تاریخچه می‌ماند.
  - مسیر: «Retry file N» در صفحهٔ Notes، اگر نمایش داده شود. در غیر این صورت پرسش ۱.
- [ ] **زمان Retry:** در بازهٔ استقرار Retry نزن (D66: استقرار وقتی است که پردازشی در جریان نیست). Runی که هنگام تغییر تنظیمات در جریان باشد با `settings_changed` تمام می‌شود و پردازش خودکار دوباره شروعش می‌کند.

### ج) غیرقابل بازیابی

- **`e4b052d6` (ضبط داخل اپ، 2026-10-12):**
  - حدود ۵۲ دقیقه از ۷۷٫۶ دقیقهٔ اعلام‌شده هرگز ضبط نشد: قطعهٔ ۱ (۹۶٪)، قطعهٔ ۳ (۸۹٪)، و ۶۱٪ از قطعه‌های ۲ و ۵.
  - مرورگر در پس‌زمینه داده‌ای نداده است. نسخهٔ روی دستگاه همان داده‌ای است که به سرور رسید.
  - Retry، اپراتور یا دیتابیس آن را برنمی‌گرداند. جزوهٔ فعلی از ۲۵٫۵ دقیقهٔ ضبط‌شده است.
  - سهمیه فقط ۱۵۳۰ ثانیهٔ واقعی را کسر کرد، نه ۴۶۵۷ ثانیهٔ رزرو.
  - اصلاح `feat/recording-capture` (ضبط صادق و D60) فقط از تکرار جلوگیری می‌کند.
- **شرطی:** اگر نسخهٔ محلی `dceda622` روی دستگاه پاک شده باشد و خود فایل را هم نداشته باشی، `572dda3f` و `f36401c8` بازیابی نمی‌شوند.

### د) بدون اقدام

- **۲۱ Run قدیمی** (ردیف‌های ۲ تا ۸، ۱۰، ۱۲ تا ۱۵ و ۱۷ تا ۲۵): جلسه‌شان بعداً جزوه گرفته است.
  - علت‌هایشان رفع شده است: Haiku با D56، کسر تکراری با D59، و انقضای زودهنگام آپلود در 2026-10-06.
- **`8db9bfa2` و `b340e478`** (ردیف‌های ۹ و ۱۱): جزوه دارند و همان صوت `cf0c11ba` را دارند. ساخت دوباره فقط regeneration و هزینه مصرف می‌کند.
- **`65915be0` و `e4b052d6`:** `ready` هستند.
- برای هیچ جلسه‌ای نوشتن در دیتابیس لازم نیست.

## ۶. قواعد تصمیم از کد

1. **Retry یعنی Run تازه برای کل جلسه، از منبع‌های فعلی.**
   - `retryRun` ([`runs.ts:575`](../../packages/core/src/proc/runs.ts)) فقط Runهای `failed`، `needs_input`، `partial_ready` یا `cancelled` را می‌پذیرد و `createProcessingRun` (`runs.ts:214`) را برای `prior.sessionId` صدا می‌زند.
   - یک Run فعال (`awaiting_upload`، `queued` یا `processing`) در همان جلسه مانع می‌شود (`runs.ts:307`).
   - Retry صفحهٔ وضعیت از `automaticLearningSync` ([`automatic-learning.ts:348`](../../apps/web/src/server/automatic-learning.ts)) و با `reuseCompletedKnowledge` همین کار را می‌کند. این مسیر برای کلاس قدیمی بدون ردیف `proc.automatic_session` هم ردیف را می‌سازد.
2. **دکمه‌ها:**
   - کارت وضعیت ([`automatic-learning-recovery.ts:71`](../../apps/web/src/ui/workspace/automatic-learning-recovery.ts)): فقط وقتی وضعیت خودکار `blocked` است.
     - برای `provider_http_400` و نتیجهٔ نامطمئن provider دکمه‌ای نیست.
     - برای `audio_upload_rejected` و کدهای `output_*` «Retry failed attempt» نمایش داده می‌شود.
   - صفحهٔ processing ([`ProcessingView.tsx:109`](../../apps/web/src/ui/workspace/ProcessingView.tsx) و `:525`):
     - «Review and retry» برای `audio_upload_rejected`.
     - «Retry processing» برای `failed`.
     - برای جلسهٔ دارای جزوه، فقط وقتی انتخاب منبع عوض شده باشد.
   - صفحهٔ Notes ([`NoteView.tsx:270`](../../apps/web/src/ui/workspace/NoteView.tsx)): «Retry file N» برای فایل ناقص. اگر نسخهٔ سرور فایل نباشد، `original_unavailable` برمی‌گردد.
3. **هات‌فیکس:** `beginTemporaryAudioUpload` ([`audio.ts:88`](../../packages/core/src/src/audio.ts)) به‌جای `hold.audio > 0` فقط باز بودن رزرو را می‌سنجد (`feat/hotfix-d59-audio-start` @ `94c3580`). سند همان شاخه هم فقط Retry همین دو جلسه را لازم می‌داند.
4. **سهمیه (D59):**
   - رزرو در زمان ساخت Run انجام می‌شود و کسر فقط هنگام انتشار. Run شکست‌خورده یا منقضی رزرو را بی‌کسر آزاد می‌کند (`runs.ts:563`).
   - `chargeableRunAmounts` ([`charged-material.ts:338`](../../packages/core/src/proc/charged-material.ts)) پوشش را از `readChargedCoverage` (`:330`) می‌گیرد:
     - مطلبی که در **همین کلاس** به کار رفته، در هر دوره رایگان است.
     - مطلبی که در **کلاس دیگر** پرداخت شده، فقط در همان دورهٔ سهمیه رایگان است.
   - **چرا `dceda622` با صوت صفر رزرو شد، با اینکه نشانگر `charge:` ندارد:** پوشش دو منبع دارد. یکی نشانگرهای `charge:<sourceId>` پس از D59 است. دیگری Runهای پیش از D59 (`legacyEntries`، `charged-material.ts:210`).
     - هر Run `ready` یا `partial_ready` پیش از D59 که رزروش دقیقاً به اندازهٔ صوت و سند درخواستی کسر شده باشد، با کل snapshot خودش و دورهٔ همان رزرو «پرداخت‌شده» شمرده می‌شود.
     - پیش از D59، انتشار هر منبعِ دارای متن را کامل کسر می‌کرد، حتی در `partial_ready`. این در `worker.ts` پیش از commit `d1de06f`، خط ۱۵۲۷ دیده می‌شود. متن عکس‌ها از بخش ۵.۱ بررسی علت می‌آید (هر ۲۳ عکس ۳ تا ۲۳ بلوک دارند). دربارهٔ صوت‌ها، استنتاج از وجود رونویسی است. Q7 این را مستقیم تأیید می‌کند.
     - پس Runهای قدیمی `8db9bfa2`، `b340e478` و `cf0c11ba` در دورهٔ `97bb030f`، صوت `dceda622` را پوشش می‌دهند. Q3 فقط نشانگرها را می‌دید، برای همین `paid_*` در آن false آمد.
   - جلسهٔ دارای جزوه برای هر نسخهٔ تازه ۱ واحد `regeneration` می‌دهد (`runs.ts:342`).
   - مانده در دورهٔ `97bb030f` (2026-10-05 تا 2026-11-04)، به‌صورت جمع `balance_delta` در `quota.ledger`: صوت ۲۵٬۶۶۰ ثانیه (حدود ۴۲۸ دقیقه)، سند ۸۳ و regeneration ۱۹.
5. **سقف هزینهٔ AI** ([`costs.ts:117`](../../packages/core/src/quota/costs.ts) تا `:151`):
   - پیش از هر فراخوان، جمع هزینهٔ ثبت‌شده، holdهای باز و سقف همان فراخوان نباید از سقف هیچ دامنه بگذرد. سقف‌ها: جلسه ۲ دلار برای کل عمر جلسه، کاربر/ماه ۸، پروژه/روز ۵ و پروژه/ماه ۵۰.
   - hold هر فراخوان: Gemini ۰٫۷۶، Haiku ۰٫۳۰ و Whisper ۰٫۰۰۵ دلار ([`openrouter-defaults.json`](../../config/openrouter-defaults.json)).
   - توقف با کد `processing_budget_session` بدون پرداخت است.
6. **استفادهٔ دوباره از پاسخ پولی** فقط برای همان provider و همان مدل انجام می‌شود ([`knowledge-reuse.ts:61`](../../packages/core/src/proc/knowledge-reuse.ts) تا `:70`).
7. **تنظیمات provider** هنگام ساخت Run در snapshot ذخیره می‌شود (`runs.ts:379`). پس Retry پیش از تغییر تنظیمات D62 همان بودجهٔ ۶۱۴۴ را می‌گیرد. تغییر تنظیمات، Run در جریان را با `settings_changed` تمام می‌کند و پردازش خودکار دوباره آن را شروع می‌کند (`automatic-learning.ts:451`).
8. **D63 در `feat/lesson-quality`:** بخش‌ها پشت‌سرهم ساخته می‌شوند و هر پاسخ پیش از فراخوان بعد checkpoint می‌شود (`docs/plans/LESSON_QUALITY_2026-10-12.md` بخش ۶ در همان شاخه).
9. **D29:** نسخهٔ سرور صوت پس از رونویسی پاک می‌شود. ساخت دوبارهٔ جزوه از متن ذخیره‌شده دستگاه نمی‌خواهد. فقط صوتی که هرگز رونویسی نشده یا استخراج دوبارهٔ صوت، دستگاه را لازم دارد.

## ۷. محدودیت‌ها

- هزینهٔ AI هر Retry تخمین است. عدد واقعی پس از اجرا در پنل مدیر دیده می‌شود.
- حکم «فقط ۱ regeneration» برای چهار جلسهٔ ناقص از کد و داده استنتاج شده است. Q7 آن را مستقیم تأیید می‌کند و اجرا نشده است.
- دلیل ناقص بودن هر جلسهٔ `partial_ready`، یعنی کدام واحد استخراج نشد، پرسیده نشد. صفحهٔ Notes همان را نشان می‌دهد.
- مدل اصلاح گفتاری production (D57: Haiku یا Gemini) بررسی نشد. این مدل فقط hold بررسی صدا را تغییر می‌دهد (۰٫۳۰ یا ۰٫۷۶ دلار)، نه تصمیم‌ها را.
- وجود نسخهٔ محلی `dceda622` روی دستگاه از سرور دیده نمی‌شود.
- شاخه‌های اصلاح هنوز ادغام نشده‌اند. اگر رفتار Retry در آن‌ها پیش از انتشار عوض شود، بخش‌های ۴ و ۵ باید دوباره بررسی شوند.

## ۸. پرسش‌های باز برای مالک محصول

1. برای کلاسی که جزوه دارد و منبعش عوض نشده، دکمهٔ مستقیمی برای ساخت دوباره نیست. برای ساخت دوبارهٔ اختیاری `cf0c11ba` و `d038a661` پس از D62، «Retry file N» (اگر نمایش داده شود) کافی است، یا مسیر دیگری می‌خواهید؟ دکمهٔ تازه کار جدایی است و تصمیم و متن تأییدشده می‌خواهد.
2. `f36401c8` پس از هات‌فیکس Retry شود یا تا انتشار کامل صبر کند؟ پیشنهاد: صبر، مگر انتشار کامل پیش از 2026-11-04 نرسد.
3. پنج کلاس آزمایشی همان فایل ۱۲۸ دقیقه‌ای را دارند. پاک کردن کلاس‌های تکراری را می‌خواهید؟ اگر بله، فقط پس از Retry دو جلسهٔ بدون جزوه و با اجازهٔ صریح انجام شود. این سند چیزی حذف نمی‌کند.
4. برای قطعیت هزینهٔ بخش ۴.۳، Q7 اجرا شود؟
