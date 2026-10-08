-- ADR-0001: encrypted daily logical backups, private Blob, maximum 30-day lifecycle.
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;
grant usage on schema ops to recalino_app;
create table ops.database_backup (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null default '1' check (schema_version = '1'),
  operation_key text not null unique check (length(operation_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending','ready','failed','deleted')),
  object_id uuid references plt.storage_object(id),
  key_id text not null check (key_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  archive_format text not null default 'postgres-custom' check (archive_format = 'postgres-custom'),
  encrypted_sha256 text check (encrypted_sha256 ~ '^[a-f0-9]{64}$'),
  encrypted_size_bytes bigint check (encrypted_size_bytes > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  restore_drilled_at timestamptz,
  restore_metadata jsonb,
  deleted_at timestamptz,
  last_error text,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check (state <> 'ready' or (object_id is not null and encrypted_sha256 is not null and encrypted_size_bytes is not null))
);
alter table ops.database_backup enable row level security;
revoke all on ops.database_backup from public, anon, authenticated;
grant select, insert, update, delete on ops.database_backup to recalino_app;
create index database_backup_expiry on ops.database_backup(expires_at) where state <> 'deleted';
