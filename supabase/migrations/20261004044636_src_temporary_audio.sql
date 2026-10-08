-- D29 / FR-SRC-007: audio can exist on the server only against a confirmed processing hold.
create table src.audio_upload (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  asset_id uuid not null references src.asset(id),
  reservation_id uuid not null,
  object_id uuid not null references plt.storage_object(id),
  state text not null default 'pending' check(state in ('pending','verified','rejected','deleted')),
  expires_at timestamptz not null,
  verified_at timestamptz,
  transcribed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(asset_id,reservation_id)
);
create index audio_upload_expiry_idx on src.audio_upload(expires_at) where state <> 'deleted';
create table src.audio_upload_part (
  upload_id uuid not null references src.audio_upload(id),
  part_index integer not null check(part_index >= 0),
  object_id uuid not null references plt.storage_object(id),
  size_bytes bigint not null check(size_bytes > 0),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz,
  primary key(upload_id,part_index)
);
alter table src.audio_upload enable row level security;
alter table src.audio_upload_part enable row level security;
revoke all on src.audio_upload,src.audio_upload_part from public,anon,authenticated;
grant select,insert,update on src.audio_upload,src.audio_upload_part to recalino_app;
