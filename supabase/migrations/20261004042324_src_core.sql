-- SRC stage 1: private assets, resumable manifests and immutable source history.
create schema src;
revoke all on schema src from public, anon, authenticated;
grant usage on schema src to recalino_app;

create table src.input_contract (
  version text primary key,
  rules jsonb not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index input_contract_active_idx on src.input_contract (active) where active;

-- FR-SRC-002: owner-approved initial limits live in versioned configuration, never code defaults.
insert into src.input_contract(version, rules, active) values ('1', '{
  "version":"1", "noticeVersion":"0.1", "maxSourcesPerSession":30,
  "partBytes":8388608, "uploadTtlSeconds":86400, "maxPartAttempts":3,
  "maxRanges":100, "htmlMaxNodes":100000, "htmlMaxDepth":100,
  "formats":{
    "audio":{"mimeTypes":["audio/mp4","audio/mpeg","audio/wav","audio/webm","audio/ogg"],"maxBytes":300000000,"maxDurationMs":10800000},
    "image":{"mimeTypes":["image/jpeg","image/png","image/webp"],"maxBytes":20000000,"maxPixels":40000000},
    "pdf":{"mimeTypes":["application/pdf"],"maxBytes":50000000,"maxPages":200},
    "html":{"mimeTypes":["text/html"],"maxBytes":5000000},
    "text":{"mimeTypes":["text/plain"],"maxBytes":1000000}
  }
}'::jsonb, true);

create table src.notice_acceptance (
  user_id uuid not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  primary key(user_id, version)
);

create table src.asset (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('audio','image','pdf','html','text')),
  declared_mime text not null,
  verified_mime text,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  display_name text not null check (char_length(display_name) between 1 and 255),
  contract_version text not null references src.input_contract(version),
  retention text not null check (retention in ('persistent','device_only')),
  duration_ms bigint check(duration_ms > 0),
  page_count integer check(page_count > 0),
  width integer check(width > 0),
  height integer check(height > 0),
  original_object_id uuid references plt.storage_object(id),
  verified_at timestamptz,
  original_deleted_at timestamptz,
  tombstoned_at timestamptz,
  deletion_request_id uuid,
  operation_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  unique(user_id, operation_key),
  check ((kind = 'audio' and retention = 'device_only' and original_object_id is null) or (kind <> 'audio' and retention = 'persistent'))
);
create index asset_owner_idx on src.asset(user_id, created_at desc) where tombstoned_at is null;
create index asset_checksum_idx on src.asset(user_id, sha256) where tombstoned_at is null;

create table src.session_source (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  asset_id uuid not null references src.asset(id),
  role text not null check(role in ('class_audio','board_photo','class_material','user_notes')),
  selected boolean not null default false,
  ranges jsonb not null default '[]'::jsonb,
  time_status text not null default 'unknown' check(time_status in ('exact','estimated','user_confirmed','unknown')),
  selected_content_version_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  unique(session_id, asset_id)
);
create index session_source_owner_idx on src.session_source(user_id, session_id) where active;
create index session_source_asset_idx on src.session_source(asset_id) where active;

create table src.source_snapshot (
  session_id uuid not null,
  sources_version integer not null check(sources_version > 0),
  user_id uuid not null,
  sources jsonb not null,
  created_at timestamptz not null default now(),
  primary key(session_id, sources_version)
);
create table src.outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_type text not null check(event_type in ('session_sources_changed','source_deleted','original_deleted')),
  subject_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index src_outbox_pending_idx on src.outbox(created_at) where delivered_at is null;

create table src.upload_session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  asset_id uuid not null references src.asset(id),
  reservation_id uuid not null,
  state text not null default 'pending' check(state in ('pending','verifying','verified','rejected','abandoned','deleted')),
  rejection_reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(asset_id)
);
create index upload_session_expiry_idx on src.upload_session(expires_at) where state = 'pending';
create table src.upload_part (
  upload_id uuid not null references src.upload_session(id),
  part_index integer not null check(part_index >= 0),
  object_id uuid not null references plt.storage_object(id),
  size_bytes bigint not null check(size_bytes > 0),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  attempts integer not null default 0 check(attempts >= 0),
  verified_at timestamptz,
  primary key(upload_id, part_index),
  unique(object_id)
);

create table src.content_version (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references src.asset(id),
  user_id uuid not null,
  origin_key text not null,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  schema_version text not null,
  provenance text not null check(provenance in ('machine_extraction','user_correction')),
  extraction_settings jsonb not null,
  units jsonb not null,
  blocks jsonb not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  unique(asset_id, origin_key)
);
create index content_version_asset_idx on src.content_version(asset_id, created_at desc);
alter table src.session_source add constraint selected_content_version_fk foreign key(selected_content_version_id) references src.content_version(id);

alter table src.input_contract enable row level security;
alter table src.notice_acceptance enable row level security;
alter table src.asset enable row level security;
alter table src.session_source enable row level security;
alter table src.source_snapshot enable row level security;
alter table src.outbox enable row level security;
alter table src.upload_session enable row level security;
alter table src.upload_part enable row level security;
alter table src.content_version enable row level security;
revoke all on all tables in schema src from public, anon, authenticated;
grant select on src.input_contract to recalino_app;
grant select, insert on src.notice_acceptance, src.source_snapshot, src.content_version to recalino_app;
grant select, insert, update on src.asset, src.session_source, src.outbox, src.upload_session, src.upload_part to recalino_app;
