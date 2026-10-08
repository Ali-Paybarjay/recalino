-- M4: records of stored files (FR-PLT-014, ADR-0001 rule 9). The key is ours and independent of
-- the storage provider; a provider URL is never stored. The server builds every key.

create table plt.storage_object (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z]+/[a-z0-9-]+/[a-z0-9-]+$'),
  owner_module text not null check (owner_module ~ '^[a-z]+$'),
  -- Null for system objects such as backups.
  owner_user_id uuid,
  retention text not null check (retention in ('durable', 'temporary')),
  state text not null default 'pending' check (state in ('pending', 'verified', 'deleted')),
  content_type text not null check (content_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null,
  verified_at timestamptz,
  deleted_at timestamptz
);
create index storage_object_owner_idx on plt.storage_object (owner_user_id);
create index storage_object_state_idx on plt.storage_object (state, created_at);

alter table plt.storage_object enable row level security;

grant select, insert, update on plt.storage_object to recalino_app;
