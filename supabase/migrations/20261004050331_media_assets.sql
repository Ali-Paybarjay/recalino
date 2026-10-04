alter table proc.processing_run add column kind text not null default 'class' check(kind in ('class','auxiliary'));
create schema media;
revoke all on schema media from public, anon, authenticated;
grant usage on schema media to recalino_app;
create table media.asset (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  kind text not null check(kind in ('image','tts')),
  state text not null default 'queued' check(state in ('queued','processing','ready','failed','needs_input','deleted')),
  source_id uuid,
  source_sha256 text,
  object_id uuid references plt.storage_object(id),
  mime_type text,
  synthetic boolean not null,
  export_allowed boolean not null default false,
  operation_key text not null,
  request_hash text not null,
  cache_key text not null,
  request jsonb not null,
  generation jsonb not null,
  reservation_id uuid,
  run_id uuid,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  tombstoned_at timestamptz,
  unique(user_id,operation_key),
  check((kind='tts' and synthetic) or (kind='image' and not synthetic))
);
create unique index media_cache_idx on media.asset(user_id,session_id,cache_key) where state in ('queued','processing','ready');
create index media_session_idx on media.asset(user_id,session_id,created_at desc) where tombstoned_at is null;
alter table media.asset enable row level security;
revoke all on all tables in schema media from public,anon,authenticated;
grant select,insert,update on media.asset to recalino_app;
