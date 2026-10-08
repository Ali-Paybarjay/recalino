-- PRD-LKM-01..06 and PRD-PROC-01..05: immutable results and durable processing.
create schema lkm;
create schema proc;
revoke all on schema lkm, proc from public, anon, authenticated;
grant usage on schema lkm, proc to recalino_app;

create table lkm.knowledge_version (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  run_id uuid not null unique,
  version integer not null check(version > 0),
  schema_version text not null,
  sources_version integer not null check(sources_version >= 0),
  source_fingerprint text not null,
  model jsonb not null,
  generation jsonb not null,
  created_at timestamptz not null default now(),
  tombstoned_at timestamptz,
  unique(session_id, version)
);
create index knowledge_session_idx on lkm.knowledge_version(user_id, session_id, version desc) where tombstoned_at is null;

create table proc.processing_run (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  operation_key text not null,
  request_hash text not null,
  sources_version integer not null check(sources_version >= 0),
  source_fingerprint text not null,
  input_snapshot jsonb not null,
  settings jsonb not null,
  requested_amounts jsonb not null,
  reservation_id uuid not null,
  job_id uuid references plt.job(id),
  state text not null default 'queued' check(state in ('awaiting_upload','queued','processing','needs_input','partial_ready','ready','failed','cancelled')),
  last_error text,
  output_version_id uuid references lkm.knowledge_version(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(user_id, operation_key)
);
create index processing_session_idx on proc.processing_run(user_id, session_id, created_at desc);
create unique index one_active_processing_run_idx on proc.processing_run(session_id) where state in ('awaiting_upload','queued','processing');

-- A committed successful step is reused by a retry. Started attempts are never silently replayed.
create table proc.run_step (
  run_id uuid not null references proc.processing_run(id) on delete cascade,
  step text not null,
  output jsonb not null,
  completed_at timestamptz not null default now(),
  primary key(run_id, step)
);
create table proc.provider_attempt (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references proc.processing_run(id) on delete cascade,
  user_id uuid not null,
  step text not null,
  attempt integer not null check(attempt > 0),
  operation_key text not null unique,
  hold_id uuid not null,
  provider text not null,
  model text not null,
  state text not null default 'started' check(state in ('started','succeeded','failed','uncertain')),
  error_code text,
  provider_request_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(run_id, step, attempt)
);
create index attempt_run_idx on proc.provider_attempt(run_id, step, attempt desc);
alter table lkm.knowledge_version enable row level security;
alter table proc.processing_run enable row level security;
alter table proc.run_step enable row level security;
alter table proc.provider_attempt enable row level security;
revoke all on all tables in schema lkm, proc from public, anon, authenticated;
grant select, insert, update on lkm.knowledge_version, proc.processing_run, proc.provider_attempt to recalino_app;
grant select, insert on proc.run_step to recalino_app;
