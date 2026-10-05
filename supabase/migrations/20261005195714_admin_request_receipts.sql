-- Durable full-request fingerprints bind an owner request key across all commands.
-- No request bodies, recipient addresses or message content are retained here.
create table ops.admin_request (
  actor_id uuid not null references auth.users(id),
  operation_key text not null check(length(operation_key) between 8 and 128),
  request_hash text not null check(length(request_hash)=64),
  created_at timestamptz not null default now(),
  primary key(actor_id,operation_key)
);
alter table ops.admin_request enable row level security;
revoke all on ops.admin_request from public,anon,authenticated;
grant select,insert on ops.admin_request to recalino_app;
