-- FR-QUOTA-001..011: private allowance ledger; values are supplied by an operator.
create schema quota;
revoke all on schema quota from public;
grant usage on schema quota to recalino_app;

create table quota.entitlement (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  closed_at timestamptz,
  operation_key text not null unique,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index entitlement_owner_period on quota.entitlement(user_id, starts_at, ends_at);

create table quota.reservation (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  entitlement_id uuid not null references quota.entitlement(id) on delete cascade,
  operation_key text not null,
  amounts jsonb not null,
  settled_amounts jsonb,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique(user_id, operation_key)
);
create index reservation_open on quota.reservation(user_id, created_at) where closed_at is null;

create table quota.ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  entitlement_id uuid not null references quota.entitlement(id) on delete cascade,
  reservation_id uuid references quota.reservation(id) on delete cascade,
  kind text not null check(kind in ('grant','reserve','settle','release','adjust')),
  dimension text not null check(dimension in ('audio','document','regeneration','tts','storage')),
  amount bigint not null check(amount >= 0),
  balance_delta bigint not null,
  operation_key text not null,
  created_at timestamptz not null default now(),
  unique(user_id, operation_key, dimension)
);
create index ledger_balance on quota.ledger(entitlement_id, dimension);

create table quota.provider_cost (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references acc.user_account(id) on delete cascade,
  session_id uuid,
  operation_key text not null unique,
  provider text not null,
  model text not null,
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  amount_micros bigint not null check(amount_micros >= 0),
  created_at timestamptz not null default now()
);
create index provider_cost_user_time on quota.provider_cost(user_id, created_at);
create index provider_cost_session_time on quota.provider_cost(session_id, created_at);
create index provider_cost_time on quota.provider_cost(created_at);

alter table quota.entitlement enable row level security;
alter table quota.reservation enable row level security;
alter table quota.ledger enable row level security;
alter table quota.provider_cost enable row level security;
revoke all on all tables in schema quota from public, anon, authenticated;
grant select, insert, update, delete on quota.entitlement, quota.reservation to recalino_app;
-- Append only: the application cannot alter or delete consumption or cost entries.
grant select, insert on quota.ledger, quota.provider_cost to recalino_app;
