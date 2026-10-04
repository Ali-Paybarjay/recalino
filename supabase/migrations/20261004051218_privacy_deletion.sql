alter table acc.user_account add column deleted_at timestamptz;
grant delete on acc.learning_profile,acc.learning_profile_history,acc.consent to recalino_app;
grant delete on src.content_version,src.source_snapshot to recalino_app;
grant delete on proc.run_step to recalino_app;
grant delete on lkm.knowledge_version to recalino_app;
create schema priv;
revoke all on schema priv from public,anon,authenticated;
grant usage on schema priv to recalino_app;
create table priv.deletion_request (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check(kind in ('session','account')),
  subject_id uuid not null,
  operation_key text not null,
  state text not null default 'pending' check(state in ('pending','completed','needs_operator')),
  job_id uuid references plt.job(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  unique(user_id,operation_key),
  unique(user_id,kind,subject_id)
);
create table priv.cleanup_step (
  request_id uuid not null references priv.deletion_request(id),
  module text not null,
  completed_at timestamptz not null default now(),
  primary key(request_id,module)
);
alter table priv.deletion_request enable row level security;
alter table priv.cleanup_step enable row level security;
revoke all on all tables in schema priv from public,anon,authenticated;
grant select,insert,update on priv.deletion_request to recalino_app;
grant select,insert on priv.cleanup_step to recalino_app;
