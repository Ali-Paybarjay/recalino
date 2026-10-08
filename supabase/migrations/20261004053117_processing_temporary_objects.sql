create table proc.temporary_object (
  run_id uuid not null references proc.processing_run(id),
  object_id uuid not null references plt.storage_object(id),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(run_id,object_id)
);
create index processing_temporary_owner_idx on proc.temporary_object(user_id,run_id) where deleted_at is null;
alter table proc.temporary_object enable row level security;
revoke all on proc.temporary_object from public,anon,authenticated;
grant select,insert,update on proc.temporary_object to recalino_app;
grant delete on src.upload_part,src.audio_upload_part,src.source_snapshot,src.session_source to recalino_app;
