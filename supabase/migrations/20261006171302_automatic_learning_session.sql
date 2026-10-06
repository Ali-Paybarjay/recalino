-- Explicit automatic-learning intent only: existing classes are not backfilled.
create table proc.automatic_session (
  session_id uuid primary key,
  user_id uuid not null references acc.user_account(id) on delete cascade,
  request_version integer not null default 1 check(request_version > 0),
  batch_id uuid,
  last_batch_id uuid,
  batch_started_at timestamptz,
  state text not null default 'waiting_sources'
    check(state in ('waiting_sources','waiting_upload','processing','ready','blocked')),
  last_error text check(last_error ~ '^[a-z0-9_.]{1,64}$'),
  run_id uuid references proc.processing_run(id) on delete set null,
  updated_at timestamptz not null default now(),
  enabled_at timestamptz not null default now(),
  foreign key(session_id,user_id) references org.class_session(id,owner_id) on delete cascade,
  check((batch_id is null) = (batch_started_at is null))
);
create index automatic_session_owner_idx on proc.automatic_session(user_id,session_id);
create index automatic_session_run_idx on proc.automatic_session(run_id) where run_id is not null;
create index automatic_session_pending_idx on proc.automatic_session(updated_at,session_id)
  where state in ('waiting_sources','waiting_upload','processing')
    or (state='blocked' and last_error in ('configuration_unavailable','storage_unavailable','settings_changed'));
alter table proc.automatic_session enable row level security;
revoke all on proc.automatic_session from public,anon,authenticated;
grant select,insert,update,delete on proc.automatic_session to recalino_app;
