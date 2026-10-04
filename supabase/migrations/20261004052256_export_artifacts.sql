-- Immutable, private export receipts. Snapshots contain content only, never review scheduling.
create schema html;
create schema anki;
revoke all on schema html, anki from public, anon, authenticated;
grant usage on schema html, anki to recalino_app;

create table html.export_artifact (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  schema_version text not null check(schema_version = '1'),
  operation_key text not null,
  request_hash text not null,
  snapshot jsonb,
  settings jsonb not null,
  state text not null default 'queued' check(state in ('queued','ready','failed','deleted')),
  estimated_bytes bigint not null check(estimated_bytes >= 0),
  actual_bytes bigint check(actual_bytes >= 0),
  sha256 text,
  object_id uuid references plt.storage_object(id),
  last_error text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  tombstoned_at timestamptz,
  cleaned_at timestamptz,
  unique(user_id, operation_key),
  check(expires_at > created_at),
  check(state <> 'ready' or (object_id is not null and sha256 is not null and actual_bytes is not null))
);
create index html_export_owner_idx on html.export_artifact(user_id, session_id, created_at desc);
create index html_export_cleanup_idx on html.export_artifact(expires_at) where cleaned_at is null;
create table anki.export_artifact (like html.export_artifact including all);
create index anki_export_owner_idx on anki.export_artifact(user_id, session_id, created_at desc);
create index anki_export_cleanup_idx on anki.export_artifact(expires_at) where cleaned_at is null;
alter table html.export_artifact enable row level security;
alter table anki.export_artifact enable row level security;
revoke all on all tables in schema html, anki from public, anon, authenticated;
grant select, insert, update, delete on html.export_artifact, anki.export_artifact to recalino_app;
