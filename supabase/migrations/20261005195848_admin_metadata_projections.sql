-- ADM-I02/I03/I07/I12/I13, ADR-0002: cross-module operational reads are owned by OPS.
-- Every projection is metadata-only, private, and evaluated with the caller's privileges.
-- Learning text, transcript, source blocks/units, storage keys and credentials are never columns.
create view ops.admin_user with (security_invoker = true) as
select a.id,a.created_at,
  exists(select 1 from quota.entitlement e where e.user_id=a.id
    and e.operation_key like 'pilot:%:initial') as pilot,
  case when exists(select 1 from support.email_outbox m where m.user_id=a.id
    and m.template_id='pilot_welcome' and m.state='sent') then 'sent'
  else coalesce((select m.state from support.email_outbox m where m.user_id=a.id
    and m.template_id='pilot_welcome' order by m.created_at desc,m.id desc limit 1),'not_sent')
  end as welcome_state
from acc.user_account a where a.deleted_at is null;

create view ops.admin_entitlement with (security_invoker = true) as
select id,user_id,starts_at,ends_at,created_at,closed_at,
  case when operation_key like 'pilot:%:initial' then split_part(operation_key,':',2)
    else null end as pilot_id
from quota.entitlement;

create view ops.admin_privacy with (security_invoker = true) as
select id,kind,state,requested_at,last_error from priv.deletion_request;

create view ops.admin_backup with (security_invoker = true) as
select b.id,b.state,b.created_at,b.restore_drilled_at,b.last_error,o.verified_at
from ops.database_backup b left join plt.storage_object o on o.id=b.object_id;

create view ops.admin_attempt_outcome with (security_invoker = true) as
select id,state,started_at from proc.provider_attempt;

create view ops.admin_counts with (security_invoker = true) as
select
  (select count(*) from acc.user_account where deleted_at is null) as users,
  (select count(*) from support.thread t join acc.user_account a on a.id=t.user_id
    where a.deleted_at is null and t.status='awaiting_reply') as pending_feedback,
  (select count(*) from proc.processing_run r join acc.user_account a on a.id=r.user_id
    where a.deleted_at is null and r.state in ('queued','awaiting_upload')) as queued_runs,
  (select count(*) from support.email_outbox where state in ('failed','unknown')) as failed_emails;

-- Explicitly approved operational communications, without the delivery body or provider metadata.
create view ops.admin_email with (security_invoker = true) as
select id,user_id,email,subject,state,created_at,last_error from support.email_outbox;

create view ops.admin_thread with (security_invoker = true) as
select t.id,t.user_id,t.subject,t.category,t.status,t.created_at,t.updated_at,t.email_notification
from support.thread t join acc.user_account a on a.id=t.user_id where a.deleted_at is null;

create view ops.admin_task with (security_invoker = true) as
with candidates as (
  select 'welcome:'||a.id as id,'pilot_welcome' as kind,a.id as user_id,a.id::text as resource_id,
    'open' as state,min(e.created_at) as created_at
  from acc.user_account a join quota.entitlement e on e.user_id=a.id
  where a.deleted_at is null and e.operation_key like 'pilot:%:initial'
    and not exists(select 1 from support.email_outbox m where m.user_id=a.id
      and m.template_id='pilot_welcome' and m.state='sent') group by a.id
  union all
  select 'feedback:'||t.id,'feedback',t.user_id,t.id::text,t.status,t.created_at
  from support.thread t join acc.user_account a on a.id=t.user_id
  where a.deleted_at is null and t.status='awaiting_reply'
  union all
  select 'email:'||m.id,'email',m.user_id,m.id::text,m.state,m.created_at
  from support.email_outbox m where m.state in ('failed','unknown')
  union all
  select 'run:'||r.id,'processing',r.user_id,r.id::text,r.state,r.created_at
  from proc.processing_run r join acc.user_account a on a.id=r.user_id
  join org.class_session c on c.id=r.session_id
  where a.deleted_at is null and c.deleted_at is null
    and r.state in ('failed','needs_input','partial_ready')
)
select c.id,c.kind,c.user_id,c.resource_id,c.state,c.created_at,
  p.state as preference_state,p.snoozed_until
from candidates c left join ops.task_preference p on p.task_id=c.id;

-- Source processing eligibility exposes booleans and expiry timestamps, never source content.
-- OCR-required metadata is reduced inside the database, before the application reads it.
create view ops.admin_source_readiness with (security_invoker = true) as
select l.session_id,l.user_id,
  coalesce(a.id is not null and a.tombstoned_at is null and a.user_id=l.user_id,false) as source_live,
  (v.id is not null) as content_available,
  coalesce(a.kind='pdf' and exists(select 1 from jsonb_array_elements(v.units) unit
    where unit->>'reason'='ocr_required'),false) as requires_ocr,
  coalesce(a.kind<>'audio' and a.verified_at is not null and a.original_deleted_at is null
    and o.state='verified' and o.deleted_at is null,false) as original_available,
  o.access_expires_at as original_expires_at,
  (select max(au.expires_at) from src.audio_upload au
    join plt.storage_object ao on ao.id=au.object_id
    where au.asset_id=a.id and au.user_id=l.user_id and au.state='verified'
      and ao.state='verified' and ao.deleted_at is null) as audio_available_until
from src.session_source l
left join src.asset a on a.id=l.asset_id
left join src.content_version v on v.id=l.selected_content_version_id and v.user_id=l.user_id
left join plt.storage_object o on o.id=a.original_object_id
where l.active and l.selected;

create view ops.admin_processing with (security_invoker = true) as
select r.id,r.user_id,r.session_id,r.kind,r.state,r.last_error,r.created_at,p.step,p.model,
  exists(select 1 from proc.provider_attempt pa where pa.run_id=r.id
    and pa.state in ('started','uncertain')) as unresolved_attempt
from proc.processing_run r join acc.user_account a on a.id=r.user_id
join org.class_session c on c.id=r.session_id
left join lateral (select step,model from proc.provider_attempt pa where pa.run_id=r.id
  order by started_at desc,id desc limit 1) p on true
where a.deleted_at is null and c.deleted_at is null;

create view ops.admin_audit with (security_invoker = true) as
select 'platform:'||id as id,action,actor_id,reason,subject_id,occurred_at as created_at
from plt.audit_event
union all
select 'support:'||id,action,actor_id,detail->>'reason',resource_id,created_at
from support.activity;

revoke all on
  ops.admin_user,ops.admin_entitlement,ops.admin_privacy,ops.admin_backup,
  ops.admin_attempt_outcome,ops.admin_counts,ops.admin_email,ops.admin_thread,ops.admin_task,
  ops.admin_source_readiness,ops.admin_processing,ops.admin_audit
from public,anon,authenticated,recalino_app;

grant select on
  ops.admin_user,ops.admin_entitlement,ops.admin_privacy,ops.admin_backup,
  ops.admin_attempt_outcome,ops.admin_counts,ops.admin_email,ops.admin_thread,ops.admin_task,
  ops.admin_source_readiness,ops.admin_processing,ops.admin_audit
to recalino_app;
