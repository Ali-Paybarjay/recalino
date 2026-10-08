-- A receipt never stores the sample or its voiceprint. Revocation keeps only a key tombstone.
create table voc.enrollment_request (
  user_id uuid not null references acc.user_account(id) on delete cascade,
  request_key text not null check(length(request_key) between 1 and 200),
  request_hash text check(request_hash ~ '^[a-f0-9]{64}$'),
  profile_version integer not null check(profile_version > 0),
  state text not null check(state in ('started','completed','failed','revoked')),
  attempt_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,request_key),
  check((state = 'revoked') = (request_hash is null)),
  check((state = 'started') = (attempt_id is not null and lease_expires_at is not null))
);
alter table voc.enrollment_request enable row level security;
revoke all on voc.enrollment_request from public, anon, authenticated;
grant select,insert,update,delete on voc.enrollment_request to recalino_app;

-- Cleanup claims an obsolete object under the same account lock used to publish it.
alter table voc.sample_object add column retired_at timestamptz;
