# فهرست بازیابی Runهای ناتمام کلاس — 2026-10-12

وضعیت: **پیش‌نویس؛ منتظر نتیجهٔ SQL.** جدول و چک‌لیست پس از اجرای فقط‌خواندنی SQL زیر پر می‌شوند.

## ۱. هدف

پس از انتشار اصلاح‌ها (هات‌فیکس D59 و شاخه‌های D60 تا D66)، مالک محصول باید بداند کدام جلسه را Retry کند، کی، و هر Retry چه هزینه‌ای از سهمیه و هزینهٔ AI دارد.

## ۲. روش

- داده فقط با `select` فقط‌خواندنی روی پروژهٔ `twowhuzhvyuzjrpraikm` خوانده می‌شود. هیچ متن کلاس، transcript، `blocks` یا نام فایل خوانده نمی‌شود؛ فقط پیشوند ۸ نویسه‌ای شناسه‌ها، وضعیت، کد دلیل، تعداد، مدت و زمان.
- قواعد تصمیم از کد خوانده شده‌اند (بخش ۵).

## SQL

همهٔ پرس‌وجوها فقط‌خواندنی‌اند و می‌توانند در یک نوبت اجرا شوند.

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

## ۳. جدول همهٔ Runها

(پس از نتیجهٔ SQL)

## ۴. چک‌لیست مالک محصول

(پس از نتیجهٔ SQL)

## ۵. قواعد تصمیم از کد

(پس از نتیجهٔ SQL)
