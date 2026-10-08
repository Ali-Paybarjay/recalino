-- Owner identity is provisioned only by a trusted database operator. Browser roles have no access.
create table plt.admin_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table plt.admin_owner enable row level security;
revoke all on plt.admin_owner from public, anon, authenticated;
grant select on plt.admin_owner to recalino_app;

create table ops.admin_preference (
  user_id uuid primary key references auth.users(id) on delete cascade,
  language text not null default 'fa' check (language in ('fa','en')),
  theme text not null default 'system' check (theme in ('system','light','dark')),
  updated_at timestamptz not null default now()
);
create table ops.admin_operation (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation_key text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,operation_key)
);
create table ops.task_preference (
  task_id text primary key,
  state text not null check(state in ('open','dismissed','snoozed')),
  snoozed_until timestamptz,
  reason text not null,
  updated_at timestamptz not null default now()
);
alter table ops.admin_preference enable row level security;
alter table ops.admin_operation enable row level security;
alter table ops.task_preference enable row level security;
revoke all on ops.admin_preference,ops.admin_operation,ops.task_preference from public,anon,authenticated;
grant select,insert,update on ops.admin_preference,ops.task_preference to recalino_app;
grant select,insert on ops.admin_operation to recalino_app;

create schema if not exists aip;
revoke all on schema aip from public,anon,authenticated;
grant usage on schema aip to recalino_app;
create table aip.estimate_rate_revision (
  version text primary key,
  rates jsonb not null,
  actor_id uuid not null references auth.users(id),
  reason text not null,
  operation_key text not null unique,
  created_at timestamptz not null default now()
);
alter table aip.estimate_rate_revision enable row level security;
revoke all on aip.estimate_rate_revision from public,anon,authenticated;
grant select,insert on aip.estimate_rate_revision to recalino_app;
