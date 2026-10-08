-- FR-QUOTA-008..010: immutable measured usage, versioned pricing and atomic cost holds.
alter table quota.provider_cost alter column amount_micros drop not null;
alter table quota.provider_cost add column estimated_micros bigint check(estimated_micros >= 0);
alter table quota.provider_cost add column price_version text;
alter table quota.provider_cost add column usage jsonb not null default '{}';
alter table quota.provider_cost add column run_id uuid;
alter table quota.provider_cost add column attempt_id uuid;

create table quota.cost_policy (
  singleton boolean primary key default true check(singleton),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  limits jsonb not null,
  kill_switch boolean not null default true,
  version text not null,
  updated_at timestamptz not null default now()
);
create table quota.cost_hold (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  session_id uuid not null,
  operation_key text not null unique,
  maximum_micros bigint not null check(maximum_micros >= 0),
  currency text not null,
  reservation_id uuid not null references quota.reservation(id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index cost_hold_open on quota.cost_hold(created_at) where closed_at is null;
alter table quota.cost_policy enable row level security;
alter table quota.cost_hold enable row level security;
revoke all on quota.cost_policy, quota.cost_hold from public, anon, authenticated;
grant select, insert, update on quota.cost_policy, quota.cost_hold to recalino_app;
