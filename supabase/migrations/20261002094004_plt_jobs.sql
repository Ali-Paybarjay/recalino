-- M4: the job queue (FR-PLT-005, ADR-0003). A plain table claimed with FOR UPDATE SKIP LOCKED.
-- Payloads hold identifiers only, never class content (PRD-PRIV-06); errors are short codes.

create table plt.job (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  payload jsonb not null,
  payload_version smallint not null check (payload_version >= 1),
  state text not null default 'queued' check (state in
    ('queued', 'running', 'retry_scheduled', 'succeeded', 'failed', 'cancelled')),
  attempt integer not null default 0,
  max_attempts integer not null check (max_attempts between 1 and 20),
  lease_seconds integer not null check (lease_seconds between 1 and 3600),
  retry_base_seconds integer not null check (retry_base_seconds >= 0),
  retry_max_seconds integer not null check (retry_max_seconds >= retry_base_seconds),
  run_at timestamptz not null,
  -- Each claim gets a new token; only that claim may complete or fail the job.
  lease_token uuid,
  lease_until timestamptz,
  last_error text check (last_error ~ '^[a-z0-9_.]{1,64}$'),
  -- Periodic and one-off jobs that must exist once, e.g. "plt.purge_jobs" for one day.
  singleton_key text check (char_length(singleton_key) between 1 and 200),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  finished_at timestamptz
);
create unique index job_singleton_idx on plt.job (kind, singleton_key) where singleton_key is not null;
create index job_ready_idx on plt.job (run_at) where state in ('queued', 'retry_scheduled');
create index job_lease_idx on plt.job (lease_until) where state = 'running';
create index job_finished_at_idx on plt.job (finished_at) where finished_at is not null;

-- FR-PLT-005 rule 6: a finished step is recorded with its effect, in the same transaction.
create table plt.job_step (
  job_id uuid not null references plt.job (id) on delete cascade,
  step text not null check (step ~ '^[a-z][a-z0-9_]{0,63}$'),
  done_at timestamptz not null,
  primary key (job_id, step)
);

alter table plt.job enable row level security;
alter table plt.job_step enable row level security;

grant select, insert, update, delete on plt.job to recalino_app;
grant select, insert, delete on plt.job_step to recalino_app;
