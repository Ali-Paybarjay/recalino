-- ADM-I03/I14/I16: immutable pilot revisions and absolute allocation changes.
-- Existing financial entries, admissions and their idempotency keys remain untouched.
create table quota.pilot_revision (
  revision bigint generated always as identity primary key,
  pilot_id text not null check(pilot_id ~ '^[a-zA-Z0-9-]{1,80}$'),
  version text not null check(length(version) between 1 and 100),
  maximum_participants bigint not null check(maximum_participants between 0 and 9007199254740991),
  period_days integer not null check(period_days between 1 and 366),
  amounts jsonb not null check(jsonb_typeof(amounts) = 'object'),
  operation_key text not null unique,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  actor_id text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  previous_revision bigint references quota.pilot_revision(revision),
  unique(pilot_id, version)
);
create index pilot_revision_active on quota.pilot_revision(pilot_id, revision desc);

create table quota.allocation_change (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references acc.user_account(id) on delete cascade,
  entitlement_id uuid not null references quota.entitlement(id) on delete cascade,
  operation_key text not null,
  requested_amounts jsonb not null check(jsonb_typeof(requested_amounts) = 'object'),
  before_snapshot jsonb not null check(jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot jsonb not null check(jsonb_typeof(after_snapshot) = 'object'),
  actor_id text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(user_id, operation_key)
);
create index allocation_change_entitlement_time on quota.allocation_change(entitlement_id, created_at);
-- Prefix search preserves and counts legacy fingerprint admissions without rewriting them.
create index entitlement_pilot_key on quota.entitlement(operation_key text_pattern_ops)
  where operation_key like 'pilot:%';

alter table quota.pilot_revision enable row level security;
alter table quota.allocation_change enable row level security;
revoke all on quota.pilot_revision, quota.allocation_change from public, anon, authenticated;
grant select, insert on quota.pilot_revision, quota.allocation_change to recalino_app;
grant usage on sequence quota.pilot_revision_revision_seq to recalino_app;
