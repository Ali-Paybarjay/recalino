-- PRD-DEL-01 / SEC-01: final erasure waits for already-issued private links to expire.
alter table plt.storage_object add column access_expires_at timestamptz;
create index storage_object_owner_access_idx on plt.storage_object(owner_user_id, access_expires_at)
  where access_expires_at is not null;
