-- D60 (owner decision 2026-10-12): a sealed in-app recording part may be uploaded during capture,
-- before the class run that will use it holds any allowance. That staged copy is temporary like
-- every class audio copy (D29: deleted within 24 hours of a successful transcription, or when its
-- upload window ends unused) and a run created after Stop adopts it instead of a new transfer.
alter table src.audio_upload alter column reservation_id drop not null;
alter table src.audio_upload add column staged_at timestamptz;
alter table src.audio_upload add constraint audio_upload_hold_or_staged
  check (reservation_id is not null or staged_at is not null);
-- unique(asset_id, reservation_id) does not cover rows without a hold: one staged copy per source.
create unique index audio_upload_one_staged_idx on src.audio_upload(asset_id)
  where reservation_id is null;

-- While a learner is capturing into a class, its parts can already be registered; automatic
-- learning waits until Stop so no lesson is built from part of a class. A lease, not a flag:
-- a closed or frozen page stops renewing it and the class is processed as before.
alter table org.class_session add column capture_open_until timestamptz;
