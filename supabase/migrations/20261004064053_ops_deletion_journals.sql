-- The payload containing deletion subject IDs is encrypted in private Blob, independently
-- recoverable if database backups predate deletion. Only minimal journal metadata lives here.
create table ops.deletion_journal (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  key_id text not null check (key_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  object_id uuid references plt.storage_object(id),
  encrypted_sha256 text check (encrypted_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending','ready','deleted')),
  requested_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (state <> 'ready' or (object_id is not null and encrypted_sha256 is not null))
);
alter table ops.deletion_journal enable row level security;
revoke all on ops.deletion_journal from public, anon, authenticated;
grant select, insert, update, delete on ops.deletion_journal to recalino_app;
create index deletion_journal_cleanup on ops.deletion_journal(requested_at) where state <> 'deleted';
