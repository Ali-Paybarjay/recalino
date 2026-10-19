-- PRD-03 (audit 2026-10-18, decision 9 option A, D96): the owner sees how far each pilot learner
-- got. One row per live account with the first time of each step, read from the existing tables;
-- dates only: no class content, no counts of private material and no third-party analytics.
create view ops.admin_user_progress with (security_invoker = true) as
select a.id as user_id,
  a.created_at as first_sign_in_at,
  (select p.completed_at from acc.learning_profile p where p.user_id=a.id) as setup_completed_at,
  (select min(s.created_at) from src.asset s where s.user_id=a.id and s.kind='audio')
    as first_recording_at,
  (select min(coalesce(r.finished_at,r.updated_at)) from proc.processing_run r
    where r.user_id=a.id and r.kind='class' and r.state in ('ready','partial_ready'))
    as first_processed_at,
  (select min(e.created_at) from srs.review_event e where e.user_id=a.id) as first_review_at
from acc.user_account a where a.deleted_at is null;

revoke all on ops.admin_user_progress from public,anon,authenticated,recalino_app;
grant select on ops.admin_user_progress to recalino_app;

-- PRD-03: a deletion that stopped and only the operator can finish (state needs_operator) is a
-- task. Like ops.admin_privacy it names the request, never the account.
-- OPS-02 follow-up (D96): an open health alert of the hourly check is a task too, one per episode:
-- the newest alert of a condition with no later event for it. The audit events stay as they are.
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
  union all
  select 'privacy:'||d.id,'privacy',null::uuid,d.id::text,d.state,d.requested_at
  from priv.deletion_request d where d.state='needs_operator'
  union all
  select 'health:'||h.id,'health',null::uuid,h.subject_id,'open',h.occurred_at
  from plt.audit_event h
  where h.actor_kind='system' and h.actor_id='ops.health_check'
    and h.subject_type='system_health' and h.action='ops.health_alert'
    and not exists(select 1 from plt.audit_event n
      where n.actor_kind='system' and n.actor_id='ops.health_check'
        and n.subject_type='system_health' and n.subject_id=h.subject_id
        and n.action in ('ops.health_alert','ops.health_recovered')
        and (n.occurred_at,n.id)>(h.occurred_at,h.id))
)
select c.id,c.kind,c.user_id,c.resource_id,c.state,c.created_at,
  p.state as preference_state,p.snoozed_until
from candidates c left join ops.task_preference p on p.task_id=c.id;

-- CREATE OR REPLACE preserves prior privileges; spell out the privacy boundary again.
revoke all on ops.admin_task from public,anon,authenticated,recalino_app;
grant select on ops.admin_task to recalino_app;
