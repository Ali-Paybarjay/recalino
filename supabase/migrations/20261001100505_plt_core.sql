-- M1: PLT core tables (FR-PLT-004, FR-PLT-006, FR-PLT-007). Owned by the PLT module (ADR-0002).
-- PLT has no module dependencies, so user ids are plain uuids without foreign keys.

create schema plt;
revoke all on schema plt from public;
grant usage on schema plt to recalino_app;

-- FR-PLT-004: one row per (user, key); the stored response is replayed for repeats.
create table plt.idempotency_key (
  user_id uuid not null,
  key text not null check (char_length(key) between 8 and 200),
  route text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, key)
);
create index idempotency_key_expires_at_idx on plt.idempotency_key (expires_at);

-- FR-PLT-006: fixed-window counters. Buckets hold a route class plus a user id or a keyed
-- hash of the IP address, never the raw IP.
create table plt.rate_limit_bucket (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
create index rate_limit_bucket_window_start_idx on plt.rate_limit_bucket (window_start);

-- FR-PLT-007: security events carry identifiers only, never content.
create table plt.security_event (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('auth_failures', 'ownership_denied', 'rate_limited', 'job_tampered')),
  user_id uuid,
  route text,
  request_id text
);
create index security_event_occurred_at_idx on plt.security_event (occurred_at);

-- FR-PLT-007: minimal audit trail for sensitive operations (deletion, exceptional access).
create table plt.audit_event (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('learner', 'system', 'operator')),
  actor_id text not null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  reason text,
  request_id text
);
create index audit_event_occurred_at_idx on plt.audit_event (occurred_at);

-- Row level security with no policies: browser roles get nothing (ADR-0002); recalino_app
-- has BYPASSRLS and only the grants below.
alter table plt.idempotency_key enable row level security;
alter table plt.rate_limit_bucket enable row level security;
alter table plt.security_event enable row level security;
alter table plt.audit_event enable row level security;

grant select, insert, update, delete on plt.idempotency_key to recalino_app;
grant select, insert, update, delete on plt.rate_limit_bucket to recalino_app;
grant select, insert on plt.security_event to recalino_app;
grant select, insert on plt.audit_event to recalino_app;
