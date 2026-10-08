-- Hide contact and subject metadata immediately at account tombstone, before asynchronous purge.
-- Null-user invitations are legitimate independent operational messages.
create or replace view ops.admin_email with (security_invoker = true) as
select m.id,m.user_id,m.email,m.subject,m.state,m.created_at,m.last_error
from support.email_outbox m
where m.user_id is null or exists(select 1 from acc.user_account a
  where a.id=m.user_id and a.deleted_at is null);

create or replace view ops.admin_counts with (security_invoker = true) as
select
  (select count(*) from acc.user_account where deleted_at is null) as users,
  (select count(*) from support.thread t join acc.user_account a on a.id=t.user_id
    where a.deleted_at is null and t.status='awaiting_reply') as pending_feedback,
  (select count(*) from proc.processing_run r join acc.user_account a on a.id=r.user_id
    where a.deleted_at is null and r.state in ('queued','awaiting_upload')) as queued_runs,
  (select count(*) from ops.admin_email where state in ('failed','unknown')) as failed_emails;

create or replace view ops.admin_task with (security_invoker = true) as
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
  from ops.admin_email m where m.state in ('failed','unknown')
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

-- CREATE OR REPLACE preserves prior privileges; spell out the privacy boundary again.
revoke all on ops.admin_email,ops.admin_counts,ops.admin_task from public,anon,authenticated,recalino_app;
grant select on ops.admin_email,ops.admin_counts,ops.admin_task to recalino_app;
