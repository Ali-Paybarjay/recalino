-- Only server-generated, trusted export extensions can be part of private object names.
alter table plt.storage_object drop constraint storage_object_key_check;
alter table plt.storage_object add constraint storage_object_key_check
  check (key ~ '^[a-z]+/[a-z0-9-]+/[a-z0-9-]+(\.(apkg|html))?$');

-- Privacy cleanup clears captured source details after the tombstone; browser roles stay revoked.
grant update on src.source_snapshot to recalino_app;

-- Account-locked review transactions assign a stable order even with equal clock timestamps.
alter table srs.review_event add column recorded_order bigint generated always as identity;
create index review_event_owner_order_idx on srs.review_event (user_id, recorded_order desc);
grant usage, select on sequence srs.review_event_recorded_order_seq to recalino_app;
